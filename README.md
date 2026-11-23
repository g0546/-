# skii · 争论终结者

> 以战止战。把每一场网络争论还原成骨架、反重构、再追问——直到对方发现自己在打一场体力仗。

## 这是什么

输入一段对方论据（比如「拼多多提现到底是不是真的」这类烂账），skii 自动完成：

1. **拆骨架** — 剥离修辞，提取 结论 / 前提 / 隐含假设 / 逻辑漏洞
2. **反重构** — 用几行字重写他的全部推理：「P1 + P2 ⇒ C」，其余 90% 是修辞
3. **出弹药** — 对每条前提给出反驳角度与举证要求
4. **连环追问** — 生成追问队列，进入无限马拉松模式
5. **高姿态回复** — 一键生成三种风格的可复制回复

两种引擎：**离线规则引擎**（开箱即用，无需 API Key）和 **LLM 引擎**（任意 OpenAI 兼容接口）。

## 快速开始

零构建、零依赖，直接打开即可用：

    # 方式一：浏览器直接打开
    index.html

    # 方式二：本地起服务（推荐）
    python -m http.server 8000
    # 然后打开 http://localhost:8000

## 配置 LLM 引擎

右上角 ⚙ → 填写 Base URL / API Key / Model，例如：

| 字段 | 示例 |
|---|---|
| Base URL | https://api.deepseek.com/v1 |
| API Key | sk-... |
| Model | deepseek-chat |

配置只保存在浏览器 localStorage，不会上传到任何服务器。未配置时自动使用离线引擎。

## 四种模式

| 模式 | 说明 |
|---|---|
| 理性拆解 | 只讲逻辑，不带情绪 |
| 高姿态蔑视 | 居高临下，只嘲讽论据不攻击人 |
| 无限马拉松 | 连环追问，把讨论拖成体力赛 |
| 黑图反击 | 对方贴梗图/黑图嘲讽时，输出「定性 → 钉题 → 计数」三段式反击 |

## 黑图反击怎么用

对方不回应论点、改用梗图或表情包嘲讽时，切到「黑图反击」模式，把梗图里的文字（或他挑衅的原话）贴进来：

1. **定性** — 把图定性为「拒答声明」：它证明不了任何论点
2. **钉题** — 把靶子钉回原命题：他回避了什么、他该回答什么
3. **计数** — 每收一张图记一次「第 N 次拒答」，让围观者看到规律
4. **短句弹药 + 时间线** — 围观者只记得规律与时间线，不记得表情包

## 目录结构

    skii/
    ├── index.html      # 单页应用
    ├── styles.css      # 样式
    ├── app.js          # 引擎：离线规则 + 黑图反击 + LLM 接口
    ├── favicon.svg     # 站点图标
    ├── .github/workflows/pages.yml  # Pages 自动部署
    ├── README.md
    ├── LICENSE         # MIT
    └── .gitignore

## 上线（GitHub Pages）

推荐用仓库里配好的 GitHub Actions：push 到 `main` 后自动部署。

1. 在 GitHub 新建空仓库，例如 `skii`（不要初始化 README）
2. 本地：

       git remote add origin https://github.com/<用户名>/skii.git
       git push -u origin main

3. 打开仓库 → Settings → Pages → Source 选 **GitHub Actions**
4. 等 Actions 跑完（约 1 分钟），访问 https://<用户名>.github.io/skii/

不想用 Actions 也可以用分支部署：Settings → Pages → Source 选 **Deploy from a branch** → `main` / `/ (root)`（仓库已带 `.nojekyll`，无需额外配置）。

## 仓库设置建议

- Description：`把对方论据拆成骨架的争论终结器 · 以战止战`
- Topics：`debate` `argument-analysis` `ai-tools` `github-pages` `javascript`

## 声明

本项目用于逻辑分析与辩论演练。请勿用于骚扰、人身攻击或传播不实信息。嘲讽对事不对人。

## 许可证

MIT
