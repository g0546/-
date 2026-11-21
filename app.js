/* skii · 争论终结者 — 引擎
 * 流程：拆骨架 → 反重构 → 出弹药 → 连环追问 → 高姿态回复
 * 引擎：离线规则（默认，无需 Key） / 任意 OpenAI 兼容接口（可选）
 */
(function () {
  'use strict';

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  var LLM_KEY = 'skii.llm';
  var MODE_KEY = 'skii.mode';

  var EXAMPLE = '拼多多提现一百块是真的，我身边好几个朋友都提现成功了。那些说提现不了的人就是自己不会玩，或者就是眼红。专家都说过这种活动是有概率的，你运气不行怪谁？网上那么多黑拼多多的，还不是被带节奏了。总之，拼多多提现是真的，不服你来提一个试试。';

  var state = {
    mode: 'analytical',
    llm: null,
    round: 0,
    history: [],
    last: null,
    lastText: '',
    engine: '离线引擎'
  };

  /* ---------- 小工具 ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2200);
  }

  function copyText(text) {
    if (!text) return;
    function done() { toast('已复制'); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function splitSentences(text) {
    return String(text).split(/[。！？!?；;\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function short(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /* ---------- 离线规则引擎 ---------- */

  var CONCLUSION_RE = /(所以|因此|总之|可见|由此|综上|归根到底|这说明|也就是说|结论是)/;
  var PREMISE_RE = /(因为|由于|毕竟|鉴于|根据|数据显示|研究表明|统计|调查|举个例子|例如|比如|事实上|更何况|再说|众所周知)/;
  var ABS_RE = /(所有|全部|任何|一定|必然|肯定|绝对|人人|大家都|从来|永远|只要)/;

  var FALLACIES = [
    { re: /(专家|教授|科学家|名人|明星|大佬|权威|院士|官方)[^。！？!?]{0,12}(说|认为|表示|指出|声称)/, name: '诉诸权威', why: '权威的意见不是证据本身。让对方给出：具体哪项研究、方法、样本、发表时间。' },
    { re: /(你行你上|你懂什么|你算老几|你是什么东西|你也不是|你又不是|你这种人)/, name: '诉诸人身', why: '对方在攻击「你是谁」，而不是「你的论据」。这通常意味着他手里没有论据。' },
    { re: /(大家都|众所周知|人人都|所有人都知道|谁不知道|地球人都|是个正常人都)/, name: '诉诸群众', why: '普遍相信不等于为真。让对方给出可验证的分布证据。' },
    { re: /(要么[^。！？!?]{1,12}要么|不是[^。！？!?]{1,12}就是)/, name: '二元对立', why: '对方把连续谱剪成了两个端点，忽略了中间选项。' },
    { re: /(一旦[^。！？!?]{1,12}(就会|就得|就是)|如果[^。！？!?]{1,12}就会[^。！？!?]{0,20}最终)/, name: '滑坡谬误', why: '因果链的每一环都没有被证明。让对方逐环举证。' },
    { re: /(我身边|我认识|我朋友|我同事|我们村|我们这儿的人|我同学|我亲戚)/, name: '以偏概全', why: '个案不能推出总体。让对方给出总体分布数据或大样本研究。' },
    { re: /(难道不是|不也|凭什么|难道你|你凭什么|你怎么不)/, name: '反问代替论证', why: '反问不是论证。让对方把反问展开成可检验的命题。' },
    { re: /(想想|看看吧|太可怕|良心|道德|难道忍心|你要是有点)/, name: '诉诸情感', why: '情绪不能替代证据。对方绕开了举证责任。' },
    { re: /(反正|说到底|不多说了|懂的都懂|说多了没用)/, name: '诉诸不屑', why: '用轻蔑代替回答，通常说明对方拿不出论据。' }
  ];

  function classifyPremise(text) {
    if (/(数据|统计|调查|百分比|抽样|样本|报告|财报)/.test(text)) return '数据';
    if (/(专家|教授|研究|论文|文献|院士)/.test(text)) return '权威引用';
    if (/(我身边|我朋友|我同事|我认识|我们村|我同学|我亲戚)/.test(text)) return '个案';
    if (/(常识|都知道|显然|明摆着|不用想)/.test(text)) return '常识断言';
    return '断言';
  }

  function weaknessOf(type) {
    if (type === '数据') return '数据来源、样本、口径均未给出，无法验证。';
    if (type === '权威引用') return '引用不等于论证，具体研究的方法与结论待核实。';
    if (type === '个案') return '个案不能推出总体，需要分布数据。';
    if (type === '常识断言') return '把待证明的当成常识，举证责任被逃避。';
    return '这只是重复主张，不是理由。';
  }

  function counterFor(p, i) {
    var t = 'P' + (i + 1) + '（' + p.type + '）';
    if (p.type === '数据') return { target: t, strategy: '数据三连问：谁统计的？样本多大、怎么抽的？时间与口径是什么？拿不出就当没有。' };
    if (p.type === '个案') return { target: t, strategy: '一个个案推不出总体。请对方给出分布数据；给不出，这条直接作废。' };
    if (p.type === '权威引用') return { target: t, strategy: '请对方给出具体文献出处、方法、样本与结论原文。二手转述不算。' };
    if (p.type === '常识断言') return { target: t, strategy: '「常识」也要举证。让对方把话展开：什么条件下成立、边界在哪、反例怎么解释。' };
    return { target: t, strategy: '这是重复主张，不是理由。问它：去掉这句，结论还成立吗？' };
  }

  function buildFollowups(claim, premises) {
    var fu = [
      '先定义：「' + short(claim, 24) + '」里的关键词，判定标准是什么？'
    ];
    if (premises[0]) fu.push('举证责任在你：请给出「' + short(premises[0].text, 24) + '」的可验证来源（时间、样本、方法）。');
    fu.push('你的样本量是多少？怎么抽的？代表性如何？');
    fu.push('把它写成可证伪的形式：什么情况下你会承认自己错了？');
    fu.push('因果还是相关？你证明的是哪一个？');
    fu.push('如果是 X 导致 Y，那没有 X 的时候 Y 为什么还在？');
    fu.push('你引用的数据是哪一年的？现在还成立吗？');
    fu.push('反例检验：如果存在一个反例，你的结论要缩水到什么程度？');
    fu.push('把你的论证压缩成三句话：前提一、前提二、结论。写不出来就是没论证。');
    fu.push('这条论据拿掉之后，结论还站得住吗？站不住的话它就不是论据。');
    return fu;
  }

  function buildReplies(result) {
    var claim = result.claims.join(' / ');
    var p = result.premises;
    var f = result.fallacies;
    var fu = result.followups;
    var q0 = fu[0] || '你的依据是什么？';

    var analytical = [
      '先摆结构，再说结论。',
      '',
      '你的结论：' + claim,
      '你给的理由：' + (p.length ? p.map(function (x, i) { return 'P' + (i + 1) + '「' + x.text + '」'; }).join('；') : '（没有）'),
      '',
      '问题在这里：' + (f.length ? f.map(function (x) { return x.name + '——' + x.why; }).join('；') : '结论与理由之间缺失推理步骤。'),
      '',
      '所以先回答：' + q0
    ].join('\n');

    var scorn = [
      '别绕。你的论点就一句：' + claim + '。',
      '你给它配的理由是：' + (p.length ? '「' + p[0].text + '」' : '没有。'),
      (f.length ? '而且这是典型的' + f[0].name + '——' + f[0].why : '而且这条理由连个出处都没有。'),
      '',
      '说人话：你只是把结论换了个说法，又重复了一遍。',
      '补一步就行：' + q0
    ].join('\n');

    var marathon = [
      '开个头：你的主张是「' + claim + '」。',
      '我不吵，只按顺序来：',
      '1. ' + q0,
      '2. ' + (fu[1] || '你的依据是什么？'),
      '3. ' + (fu[2] || '样本和来源呢？'),
      '每条答完再进下一条。答不出来也没关系，承认就行。'
    ].join('\n');

    return { analytical: analytical, scorn: scorn, marathon: marathon };
  }

  function analyzeOffline(text) {
    var sents = splitSentences(text);
    var claims = [];
    var premiseSents = [];
    sents.forEach(function (s) {
      if (CONCLUSION_RE.test(s)) claims.push(s);
      else premiseSents.push(s);
    });
    if (!claims.length) {
      if (premiseSents.length) claims.push(premiseSents.pop());
      else claims.push('（没有识别出明确结论——这本身就是一个可以攻击的点）');
    }
    var premises = premiseSents.map(function (s) {
      var type = classifyPremise(s);
      return { text: s, type: type, weakness: weaknessOf(type) };
    });

    var assumptions = [];
    premises.forEach(function (p) {
      if (ABS_RE.test(p.text)) {
        assumptions.push('默认「' + p.text + '」无条件成立——对方没有给出任何限定条件。');
      }
    });
    if (!assumptions.length) {
      assumptions.push('默认前提与结论之间无缝衔接——但对方没有展示这一步推理。');
    }
    if (premises.length && claims.length) {
      assumptions.push('默认「对方说的」就等于「证据」——但论证不等于事实。');
    }

    var fallacies = [];
    FALLACIES.forEach(function (f) {
      var hit = sents.filter(function (s) { return f.re.test(s); })[0];
      if (hit) fallacies.push({ name: f.name, evidence: hit, why: f.why });
    });

    var claim = claims.join(' / ');
    var score = 72;
    score -= fallacies.length * 9;
    score -= premises.filter(function (p) { return p.type !== '数据'; }).length * 4;
    score = Math.max(8, Math.min(88, score));

    var skeletonLines = [];
    premises.forEach(function (p, i) { skeletonLines.push('P' + (i + 1) + '：' + p.text); });
    assumptions.forEach(function (a, i) { skeletonLines.push('（隐含）A' + (i + 1) + '：' + a); });
    skeletonLines.push('C：' + claim);
    var skeleton = skeletonLines.join('\n');

    var tags = premises.map(function (p, i) { return 'P' + (i + 1); });
    var compress = '把这段话压缩到最小，只剩一句：如果 ' + (tags.length ? tags.join('、') + ' 同时成立' : '什么前提都不需要') + '，那么「' + claim + '」成立。其余 90% 是修辞。';

    var counters = premises.map(function (p, i) { return counterFor(p, i); });
    counters.push({ target: '反例', strategy: '构造一个反例：把结论推到极端——如果按你的说法成立，那么 [极端情形] 也成立，你同意吗？' });
    counters.push({ target: '定义', strategy: '让对方先定义关键词。定义不清的人，是被问住的第一个人。' });

    var followups = buildFollowups(claim, premises);

    var result = {
      claims: claims,
      premises: premises,
      assumptions: assumptions,
      fallacies: fallacies,
      skeleton: skeleton,
      compress: compress,
      counters: counters,
      followups: followups,
      score: score
    };
    result.replies = buildReplies(result);
    return result;
  }

  /* ---------- 黑图反击 ---------- */

  var BLACK_QUAL = /(缺你了|关你什么事|关你屁事|跟你有|有你什么事|你是谁|你算老几|轮得到你|你配|也配|什么身份|哪根葱)/;
  var BLACK_PROV = /(不服.*咬|咬我|来啊|急了|破防|笑死|哈哈哈|怕了|急眼|跳脚)/;

  function analyzeBlackImage(text, round) {
    var t = String(text || '').trim();
    var hasQual = BLACK_QUAL.test(t);
    var hasProv = BLACK_PROV.test(t);
    var n = round && round > 0 ? round : 1;

    var verdict = '这段内容没有一句在回应争议本身。它不是证据，是对方在这一轮交白卷。';
    var pin = '他回避的是这个问题：他反对我方什么？依据是什么？答不上，那就把图当成他全部的回答记录。';
    var lines = [
      '图我收了。论点呢？',
      '每收一张图，记一次：第 ' + n + ' 次拒答。',
      '我不需要这张图证明什么，对方需要它——因为除了它他没有别的。'
    ];
    var timeline = '时间线：① 我方提出质疑 → ② 对方答非所问 → ③ 我方追问 → ④ 对方做图。谁在谈事、谁在做图，记录都在。';

    if (hasQual && hasProv) {
      verdict = '对方把「缺你了」做成梗图，再配一句「不服咬我呀」——这两句合在一起，不是在回应论点，是在问「你配不配说话」。';
      pin = '先回这一问：论资格，先插嘴的是他，先转移话题的是他，先做图的是他；论观点，他到这一轮为止一句立场都没说过。';
      lines = [
        '图我收了，论点呢？',
        '「缺你了」翻译成白话：这跟你有关系吗？',
        '「不服咬我呀」翻译成白话：我答不上来。',
        '论资格：先插嘴的是你，先转移话题的是你，先做图的是你。',
        '第 ' + n + ' 次拒答，已记录。'
      ];
    } else if (hasProv) {
      verdict = '「不服咬我呀」翻译过来只有一句：我答不上来。这是他自己的话，不是我们编的。';
      pin = '那我们把「不服」的部分留下：他反对什么？依据是什么？答不上，图就先替他存着，标题叫《论据缺考》。';
      lines = [
        '你可以一直发图，我每收一张记一次：第 ' + n + ' 次拒答。',
        '「不服咬我呀」翻译一下：我答不上来。',
        '急的是做图的人，不是提问的人。'
      ];
    } else if (hasQual) {
      verdict = '「缺你了」翻译成白话：这跟你有关系吗？对方的回答是一张图——等于承认没关系，也等于承认先插嘴的是他。';
      pin = '他可以说有关系、然后拿依据；也可以承认没关系。他两条路都没走，选了做图。做图不算回答。';
      lines = [
        '「缺你了」翻译成白话：这跟你有关系吗？',
        '我方问的是关系，你答的是图。这叫答非所问。',
        '第 ' + n + ' 次拒答，已记录。'
      ];
    }

    return {
      verdict: verdict,
      pin: pin,
      count: '记录：这是对方第 ' + n + ' 次用图代替回答。继续发，我每次都记。',
      lines: lines,
      timeline: timeline
    };
  }

  function buildBlackHtml(res) {
    var b = res.black;
    if (!b) {
      return '<p class="placeholder">切到「黑图反击」模式，把对方梗图/黑图里的文字贴进来，点「拆解并开火」。</p>';
    }
    var h = ['<p class="tip">第一发三段全发：定性 → 钉题 → 计数。之后他再发图，只回计数句。</p><div class="cards">'];
    h.push('<div class="card"><div class="card-head"><h3>① 定性</h3><button class="mini js-copy" data-copy="black:verdict">复制</button></div><p class="reply-block">' + esc(b.verdict) + '</p></div>');
    h.push('<div class="card"><div class="card-head"><h3>② 钉题</h3><button class="mini js-copy" data-copy="black:pin">复制</button></div><p class="reply-block">' + esc(b.pin) + '</p></div>');
    h.push('<div class="card"><div class="card-head"><h3>③ 计数</h3><button class="mini js-copy" data-copy="black:count">复制</button></div><p class="reply-block">' + esc(b.count) + '</p></div>');
    h.push('<div class="card"><div class="card-head"><h3>短句弹药</h3><button class="mini js-copy" data-copy="black:all">复制整套</button></div><ul class="black-lines">' + b.lines.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>');
    h.push('<div class="card"><div class="card-head"><h3>给围观者的时间线</h3><button class="mini js-copy" data-copy="black:timeline">复制</button></div><p class="reply-block">' + esc(b.timeline) + '</p></div>');
    h.push('</div>');
    return h.join('');
  }

  /* ---------- LLM 引擎 ---------- */

  var SYSTEM_PROMPT = [
    '你是「争论终结者」引擎：一个冷酷、严谨、居高临下的辩论拆解器。',
    '用户会给你一段论据文本。你要：',
    '1) 拆出结论与前提；2) 指出隐含假设；3) 识别谬误；4) 把论证反向重构为骨架；',
    '5) 针对每条前提给出反驳策略；6) 写出三种风格的回复；7) 生成连环追问。',
    '要求：只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释。',
    '语气：尖锐、讥讽、居高临下，但只嘲讽论据与逻辑，不进行人身攻击、不使用脏话。',
    'JSON 结构：',
    '{"claims":["结论句"],"premises":[{"text":"原句","type":"数据|权威引用|个案|常识断言|断言","weakness":"一句话弱点"}],',
    '"assumptions":["隐含假设"],"fallacies":[{"name":"谬误名","evidence":"原文片段","why":"为什么是谬误"}],',
    '"skeleton":"P1：... / P2：... / C：...","compress":"一句话压缩摘要",',
    '"counters":[{"target":"P1（类型）","strategy":"怎么打"}],',
    '"replies":{"analytical":"理性拆解风格","scorn":"高姿态蔑视风格","marathon":"无限马拉松风格"},',
    '"followups":["追问1","追问2"]}'
  ].join('\n');

  function parseJSONLoose(content) {
    var s = String(content).trim();
    var a = s.indexOf('{');
    var b = s.lastIndexOf('}');
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    return JSON.parse(s);
  }

  function normalizeLLM(data, text) {
    var result = {};
    result.claims = Array.isArray(data.claims) ? data.claims.filter(Boolean).map(String) : ['（LLM 未给出结论）'];
    result.premises = Array.isArray(data.premises) ? data.premises.map(function (p) {
      if (typeof p === 'string') return { text: p, type: '断言', weakness: weaknessOf('断言') };
      return { text: String(p.text || ''), type: String(p.type || '断言'), weakness: String(p.weakness || '') };
    }).filter(function (p) { return p.text; }) : [];
    result.assumptions = Array.isArray(data.assumptions) ? data.assumptions.map(String) : [];
    result.fallacies = Array.isArray(data.fallacies) ? data.fallacies.map(function (f) {
      if (typeof f === 'string') return { name: f, evidence: '', why: '' };
      return { name: String(f.name || ''), evidence: String(f.evidence || ''), why: String(f.why || '') };
    }) : [];
    result.skeleton = data.skeleton ? String(data.skeleton) : '';
    result.compress = data.compress ? String(data.compress) : '';
    result.counters = Array.isArray(data.counters) ? data.counters.map(function (c) {
      if (typeof c === 'string') return { target: '反驳', strategy: c };
      return { target: String(c.target || '反驳'), strategy: String(c.strategy || '') };
    }) : [];
    result.followups = Array.isArray(data.followups) ? data.followups.map(String) : [];
    var score = Number(data.score);
    result.score = isFinite(score) && score > 0 ? Math.max(8, Math.min(95, score)) : 55;
    var replies = data.replies || {};
    var fb = buildReplies(result);
    result.replies = {
      analytical: String(replies.analytical || fb.analytical),
      scorn: String(replies.scorn || fb.scorn),
      marathon: String(replies.marathon || fb.marathon)
    };
    if (!result.followups.length) result.followups = buildFollowups(result.claims[0], result.premises);
    if (!result.skeleton) {
      var lines = [];
      result.premises.forEach(function (p, i) { lines.push('P' + (i + 1) + '：' + p.text); });
      result.assumptions.forEach(function (a, i) { lines.push('（隐含）A' + (i + 1) + '：' + a); });
      lines.push('C：' + result.claims[0]);
      result.skeleton = lines.join('\n');
    }
    if (data.black && typeof data.black === 'object') {
      var bl = data.black;
      result.black = {
        verdict: String(bl.verdict || ''),
        pin: String(bl.pin || ''),
        count: String(bl.count || ''),
        lines: Array.isArray(bl.lines) ? bl.lines.map(String) : [],
        timeline: String(bl.timeline || '')
      };
    }
    if (!result.compress) result.compress = '压缩后：结论需要前提支撑，前提需要证据支撑——对方两者都没有。';
    return result;
  }

  function callLLM(text) {
    var llm = state.llm || {};
    var base = String(llm.baseUrl || '').replace(/\/+$/, '');
    if (!base || !llm.apiKey) return Promise.reject(new Error('未配置 LLM'));
    var url = base + '/chat/completions';
    var modeName = { analytical: '理性拆解', scorn: '高姿态蔑视', marathon: '无限马拉松', blackimage: '黑图反击' }[state.mode] || '理性拆解';
    var sys = SYSTEM_PROMPT;
    if (state.mode === 'blackimage') {
      sys += '\n\n黑图反击模式：如果输入是对方用来嘲讽的梗图文字（表情包文案、挑衅短句、反问），额外输出 black 字段：{"verdict":"定性句","pin":"钉题句","count":"计数句","lines":["短句弹药"],"timeline":"给围观者的时间线"}。语气：冷静、精准、居高临下，只针对论据与回避行为。';
    }
    var body = {
      model: llm.model || 'deepseek-chat',
      temperature: 0.85,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: '当前模式：' + modeName + '\n\n对方论据：\n' + text }
      ]
    };
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + llm.apiKey },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!content) throw new Error('响应为空');
      return normalizeLLM(parseJSONLoose(content), text);
    });
  }

  /* ---------- 渲染 ---------- */

  function switchTab(name) {
    $$('.tabs button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === name); });
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab-' + name); });
  }

  function render(res, engineLabel) {
    state.last = res;
    state.engine = engineLabel;
    if (state.mode === 'blackimage' && !res.black) {
      res.black = analyzeBlackImage(state.lastText || '', state.round);
    }
    var badge = $('#engineBadge');
    if (badge) {
      badge.textContent = engineLabel;
      badge.className = 'badge' + (engineLabel.indexOf('LLM') === 0 ? ' llm' : '');
    }

    var claim = res.claims.join(' / ');

    var h = ['<div class="cards">'];
    h.push('<div class="card"><h3>结论 C</h3><p class="claim">' + esc(claim) + '</p></div>');
    h.push('<div class="card"><h3>前提 P</h3>');
    if (res.premises.length) {
      h.push('<ul class="premises">');
      res.premises.forEach(function (p, i) {
        h.push('<li><div class="p-head"><span class="tag">P' + (i + 1) + '</span><span class="type">' + esc(p.type) + '</span></div><p>' + esc(p.text) + '</p><small class="weak">' + esc(p.weakness) + '</small></li>');
      });
      h.push('</ul>');
    } else {
      h.push('<p class="muted">没有提取到前提——这本身就是最大的漏洞。</p>');
    }
    h.push('</div>');
    h.push('<div class="card"><h3>隐含假设 A</h3>');
    h.push(res.assumptions.length ? '<ol class="plist">' + res.assumptions.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ol>' : '<p class="muted">暂未识别。</p>');
    h.push('</div>');
    h.push('<div class="card"><h3>漏洞清单</h3>');
    h.push(res.fallacies.length
      ? '<ul class="fallacies">' + res.fallacies.map(function (f) {
          return '<li><span class="badge warn">' + esc(f.name) + '</span>' + (f.evidence ? '<p class="ev">' + esc(f.evidence) + '</p>' : '') + '<small>' + esc(f.why) + '</small></li>';
        }).join('') + '</ul>'
      : '<p class="muted">未匹配到典型谬误模式（不代表论证成立）。</p>');
    h.push('</div>');
    h.push('</div>');
    h.push('<div class="score"><div class="score-head"><span>论证强度</span><b>' + res.score + '</b><span class="muted">/100</span></div><div class="bar"><i style="width:' + res.score + '%"></i></div></div>');
    $('#tab-structure').innerHTML = h.join('');

    $('#tab-reconstruct').innerHTML = [
      '<div class="card"><h3>骨架（把他的逻辑剥到只剩骨头）</h3><pre class="skeleton">' + esc(res.skeleton) + '</pre></div>',
      '<div class="card"><h3>压缩成一句话</h3><blockquote>' + esc(res.compress) + '</blockquote></div>',
      '<p class="tip">把上面这段发出去：对方会发现自己的「长篇大论」其实只有三行。</p>'
    ].join('');

    var c = ['<div class="cards">'];
    res.counters.forEach(function (x, i) {
      c.push('<div class="card"><div class="card-head"><span class="tag">' + esc(x.target) + '</span><button class="mini js-copy" data-copy="counter:' + i + '">复制</button></div><p>' + esc(x.strategy) + '</p></div>');
    });
    c.push('</div>');
    $('#tab-counter').innerHTML = c.join('');

    var modes = [['analytical', '理性拆解'], ['scorn', '高姿态蔑视'], ['marathon', '无限马拉松']];
    var rep = ['<p class="tip">挑一个风格，直接复制发出去。</p><div class="cards">'];
    modes.forEach(function (m) {
      var active = m[0] === state.mode ? ' active' : '';
      rep.push('<div class="card reply' + active + '"><div class="card-head"><h3>' + m[1] + '</h3><button class="mini js-copy" data-copy="reply:' + m[0] + '">复制这段</button></div><pre class="reply-text">' + esc(res.replies[m[0]]) + '</pre></div>');
    });
    rep.push('</div>');
    $('#tab-reply').innerHTML = rep.join('');

    var f = ['<div class="card"><h3>追问队列（按顺序发）</h3><ol class="followups">'];
    res.followups.forEach(function (q) { f.push('<li>' + esc(q) + '</li>'); });
    f.push('</ol></div>');
    f.push('<div class="card continue"><h3>马拉松 · 下一轮</h3><p class="muted">对方回复后，把他的话粘进来，再拆一轮。</p><textarea id="nextInput" placeholder="粘贴对方的回复"></textarea><div class="row end"><button id="btnNext" class="primary-btn small">再拆一轮</button></div></div>');
    if (state.history.length) {
      f.push('<div class="card"><h3>记录</h3><ul class="history">');
      state.history.forEach(function (h2) {
        f.push('<li><b>第 ' + h2.round + ' 轮</b><span class="muted">' + esc(short(h2.opponent, 46)) + '</span></li>');
      });
      f.push('</ul></div>');
    }
    $('#tab-followups').innerHTML = f.join('');

    $('#tab-blackimage').innerHTML = buildBlackHtml(res);

    bindCopy(res);
    bindNext();
  }

  function bindCopy(res) {
    $$('.js-copy').forEach(function (b) {
      b.onclick = function () {
        var key = b.getAttribute('data-copy') || '';
        var parts = key.split(':');
        var text = '';
        if (parts[0] === 'counter') {
          var x = res.counters[Number(parts[1])];
          text = x ? x.target + '：' + x.strategy : '';
        } else if (parts[0] === 'reply') {
          text = res.replies[parts[1]] || '';
        } else if (parts[0] === 'black' && res.black) {
          var b = res.black;
          if (parts[1] === 'all') {
            text = [b.verdict, b.pin, b.count].join('\n\n') + '\n\n' + (b.lines || []).join('\n') + '\n\n' + b.timeline;
          } else {
            text = b[parts[1]] || '';
          }
        }
        copyText(text);
      };
    });
  }

  function bindNext() {
    var btn = $('#btnNext');
    if (!btn) return;
    btn.onclick = function () {
      var ta = $('#nextInput');
      var text = (ta && ta.value || '').trim();
      if (!text) { toast('先把对方的回复粘进来'); return; }
      state.round += 1;
      state.history.push({ round: state.round, opponent: text });
      runAnalysis(text);
    };
  }

  /* ---------- 流程 ---------- */

  function analyzeFromInput() {
    var text = (($('#input') || {}).value || '').trim();
    if (!text) { toast('先输入对方的论据'); return; }
    state.round = state.mode === 'blackimage' ? state.round + 1 : 1;
    state.history = [];
    runAnalysis(text);
  }

  function runAnalysis(text) {
    var btn = $('#btnAnalyze');
    btn.disabled = true;
    btn.textContent = '拆解中…';
    var badge = $('#roundBadge');
    if (badge) {
      badge.textContent = '第 ' + state.round + ' 轮';
      badge.classList.remove('hidden');
    }

    function finish(res, engine) {
      state.lastText = text;
      render(res, engine);
      btn.disabled = false;
      btn.textContent = '拆解并开火';
      switchTab(state.mode === 'blackimage' ? 'blackimage' : state.mode === 'marathon' ? 'followups' : state.mode === 'scorn' ? 'reply' : 'structure');
    }

    function offline(reason) {
      var res = analyzeOffline(text);
      if (reason) toast(reason);
      finish(res, '离线引擎');
    }

    if (state.llm && state.llm.apiKey && state.llm.baseUrl) {
      callLLM(text).then(function (res) {
        finish(res, 'LLM · ' + (state.llm.model || 'default'));
      }).catch(function (e) {
        offline('LLM 调用失败（' + e.message + '），已回退离线引擎');
      });
    } else {
      offline();
    }
  }

  /* ---------- 设置 ---------- */

  function updateEngineBadge() {
    var llm = state.llm || {};
    var badge = $('#engineBadge');
    if (!badge) return;
    if (llm.baseUrl && llm.apiKey) {
      badge.textContent = 'LLM · ' + (llm.model || 'default');
      badge.className = 'badge llm';
    } else {
      badge.textContent = '离线引擎';
      badge.className = 'badge';
    }
  }

  function loadSettings() {
    try { state.llm = JSON.parse(localStorage.getItem(LLM_KEY) || 'null'); } catch (e) { state.llm = null; }
    try { state.mode = localStorage.getItem(MODE_KEY) || 'analytical'; } catch (e) { state.mode = 'analytical'; }
    var modeEl = $('#mode');
    if (modeEl) modeEl.value = state.mode;
    var llm = state.llm || {};
    var b = $('#cfgBase');
    var k = $('#cfgKey');
    var m = $('#cfgModel');
    if (b) b.value = llm.baseUrl || '';
    if (k) k.value = llm.apiKey || '';
    if (m) m.value = llm.model || '';
    updateEngineBadge();
  }

  function bindEvents() {
    $('#btnAnalyze').addEventListener('click', analyzeFromInput);
    $('#btnClear').addEventListener('click', function () {
      $('#input').value = '';
      $('#input').focus();
    });
    $('#btnExample').addEventListener('click', function () {
      $('#input').value = EXAMPLE;
      $('#input').focus();
    });
    $('#mode').addEventListener('change', function () {
      state.mode = $('#mode').value;
      try { localStorage.setItem(MODE_KEY, state.mode); } catch (e) {}
      if (state.last) {
        render(state.last, state.engine);
        switchTab('reply');
      }
    });
    $$('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
    });
    $('#btnSettings').addEventListener('click', function () { $('#settingsModal').classList.remove('hidden'); });
    $('#cfgClose').addEventListener('click', function () { $('#settingsModal').classList.add('hidden'); });
    $('#settingsModal').addEventListener('click', function (e) {
      if (e.target === $('#settingsModal')) $('#settingsModal').classList.add('hidden');
    });
    $('#cfgSave').addEventListener('click', function () {
      var base = ($('#cfgBase').value || '').trim();
      var key = ($('#cfgKey').value || '').trim();
      var model = ($('#cfgModel').value || '').trim();
      if (base && !/^https?:\/\//i.test(base)) { toast('Base URL 需要以 http(s):// 开头'); return; }
      state.llm = (base && key) ? { baseUrl: base, apiKey: key, model: model } : null;
      try {
        if (state.llm) localStorage.setItem(LLM_KEY, JSON.stringify(state.llm));
        else localStorage.removeItem(LLM_KEY);
      } catch (e) {}
      updateEngineBadge();
      $('#settingsModal').classList.add('hidden');
      toast(state.llm ? '已保存 LLM 配置' : '已切换为离线引擎');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') $('#settingsModal').classList.add('hidden');
    });
    $('#input').addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') analyzeFromInput();
    });
  }

  function init() {
    loadSettings();
    bindEvents();
  }

  if (typeof window !== 'undefined') {
    window.skii = { analyze: analyzeOffline, analyzeBlack: analyzeBlackImage };
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
