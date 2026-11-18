# CLAUDE.md

> 本文件是 resume-preview 的 AI 协作入口。**详细资料在 [`docs/`](docs/)，本文件不重复其内容**。
> 需要细节时请读对应文档，不要凭本文件猜。

## 1. 项目定位

resume-preview 是一个 **MCP server**，把简历内容渲染到本地浏览器并支持 WebSocket 实时刷新。

- **两条对外通道**：MCP 工具（stdio，给 AI 客户端）+ 本地 HTTP/WS 服务（给浏览器）
- **一个存储层**：文件系统，无数据库
- **一个渲染后端**：无头 Chromium（puppeteer），负责 A4 版式渲染与 PDF 导出
- **发布形态**：npm 包 + Claude Code plugin（`.claude-plugin/`）

典型用法是 AI 反复调用 `resume_preview` 调整简历文案，浏览器自动刷新，最后 `resume_export` 落盘。

## 2. 核心架构

五层，依赖方向自上而下：

```
接入层    index.ts (MCP stdio) · live-server.ts (HTTP+WS) · serve.ts (--serve)
应用层    handlers.ts (MCP 工具实现) · routes.ts (路由分发) · resume-service.ts · page-renderer.ts
能力层    file-utils.ts (路径+校验) · logger.ts
基础层    constants.ts (常量) · types.ts (类型)
资源层    src/preview/* (模板/脚本/样式)  +  ~/.config/resume-preview/{resumes,logs}
```

**一条主链路**：

```
MCP 调用 resume_preview
  → handlers.ts 校验并归一内容（对象或 JSON 字符串）
  → file-utils.ts 写 resumes/<slug>/resume.json + options.json
  → resume-renderer.ts 套 HTML 模板（正文转义）→ resume.html
  → live-server.ts 注册 fs.watch，浏览器经 WebSocket 收到 "reload"
```

**两条运行模式**（`src/index.ts` 决定，**互斥**）：

| 模式     | 触发      | 启动什么                                       |
| -------- | --------- | ---------------------------------------------- |
| 默认     | 无参数    | 仅 MCP stdio server                            |
| 独立服务 | `--serve` | 仅 HTTP/WS 服务 + 浏览器画廊（**不启动 MCP**） |

## 3. 关键模块

| 文件                     | 职责                                              | 注意                                                 |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------- |
| `src/index.ts`           | MCP 入口；`TOOL_DEFINITIONS` 是工具的**唯一真源** | 改工具参数必须同时改这里                             |
| `src/handlers.ts`        | `resume_preview` / `resume_export` 的实现         | `args` 类型是 `any`，形状靠 JSON Schema 保证         |
| `src/live-server.ts`     | HTTP+WS 服务、端口探测、文件监听、实时推送        | live session 的增删改都走这里                        |
| `src/routes.ts`          | 路由表 `ROUTE_CONFIG` 与各 HTTP 处理器            | 前缀匹配条目有副作用，注意匹配顺序                   |
| `src/resume-service.ts`  | 简历的列表/删除                                   | 与 `resume-renderer.ts` 平级，不混放                 |
| `src/resume-renderer.ts` | 内容 → HTML / 独立 HTML / PDF（A4）               | 走 puppeteer；仅当导出文档含 CJK 字符时检测 CJK 字体 |
| `src/file-utils.ts`      | 路径解析、全部入参校验、文件读写                  | **安全边界都在这里**                                 |
| `src/page-renderer.ts`   | 模板变量替换（画廊页在用）                        | `escapeHtml` 的实现在 `html-utils.ts`，别再复制一份  |
| `src/i18n.ts`            | 语言解析与取词（界面语言 / 简历语言）             | 字典在 `src/preview/i18n/*.json`，服务端与浏览器共用 |
| `src/constants.ts`       | 全部常量（路由/格式/默认值/CSP/正则）             | 改这里前先看 `docs/api-list.md` 的已知问题一节       |
| `src/types.ts`           | 共享类型                                          | 新增类型必须真的被引用                               |
| `src/preview/`           | `resume-template.html` `resume.css` `resume.js`   | `resume.js` 必须独立同源文件（CSP 限制）             |
| `src/preview/`           | `gallery.html` `gallery.css` `gallery.js`         | 画廊页只列简历，接口是 `/api/resumes`                |
| `src/preview/`           | `i18n.js` `i18n/*.json`                           | 客户端取词模块与语言字典（服务端同源共用）           |

**依赖方向**：`handlers.ts → live-server.ts`（单向）。早期 `live-server.ts` 反向 import 了
`handlers.ts` 的图渲染函数，形成项目唯一的循环依赖；图能力下线后该环已消除。
**不要引入新的环** —— 合并前先看 `assets/module-deps.svg`。

## 4. 关键约定

- **端口**：`3737-3747` 顺序探测，绑定 `127.0.0.1`。**没有鉴权**，绝不能暴露到局域网/公网。
  简历含个人信息，敏感度高，同一约束同样适用。
- **存储**：
  - 简历：`<configDir>/resume-preview/resumes/<slug>/`（`resume.json` / `options.json` /
    `resume.html` / `resume.export.html` / `resume.pdf`）
  - 日志：`<configDir>/resume-preview/logs/`
  - `configDir` 依次取 `$XDG_CONFIG_HOME` → `$HOME/.config` → `$USERPROFILE/.config` → `tmpdir()`。
  - Windows 上是 `C:\Users\<user>\.config\resume-preview\`。
- **启动时的数据目录迁移**：`src/index.ts` 顶层调用 `file-utils.ts` 的
  `migrateLegacyAppDir()`，把旧版本的数据目录合并到 `~/.config/resume-preview/`
  （旧目录不存在就跳过；两边都在则合并，同名文件以新目录为准）。
  Windows 上旧进程仍持有句柄导致 `rename` 被拒时，降级为**复制**。
  迁移逻辑**不得抛异常** —— 失败只告警，服务照常启动。
- **`resume_id` 可以含中文**，但落盘名与 URL 使用它的 **slug**：
  已是 `[a-zA-Z0-9_-]+` 则原样保留，否则剥离 ASCII 骨架 + 6 位哈希后缀。
  slug **恒满足** `PREVIEW_ID_REGEX` —— 支持中文**不等于**放宽正则。
- **格式**：简历的导出格式是 `pdf`/`html`，实时预览对应物是 `resume.html`。
- **模板/主题**：当前白名单**只有 `default`**（`RESUME_TEMPLATES`/`RESUME_THEMES`），扩展点是这两个常量。
- **实时预览只在首次打开浏览器**：后续调用复用同一 slug，靠 WebSocket 刷新，不重复开标签页。
- **文件监听用 `fs.watch` 监听单个文件**（不是目录），事件 `change` 触发 reload。
  导出时**绝不能写被监听的那个文件**，否则会误触发一次 reload。
- **日志**：分级写入 `mcp.log` / `web.log`；级别由 `CLAUDE_MERMAID_LOG_LEVEL`
  （`DEBUG`/`INFO`/`WARN`/`ERROR`/`OFF`，默认 `INFO`）控制。
  环境变量名是历史遗留，**保持不变**。
- **CSP**：`default-src 'none'` + `script-src 'self'`，所有 HTML 响应都要带。
  `script-src` 不含 `unsafe-inline`，前端脚本**必须**是独立同源文件，不能内联。
- **常量集中**：路由、格式、默认值、正则、路径名一律放 `constants.ts`，不要就地硬编码。
- **简历正文一律按纯文本渲染并转义** —— 内容中的 HTML 标签与脚本**不会**被解释。
  这是简历域最大的 XSS 面，不要为了"支持富文本"而放开。
- **简历内容只做结构性校验**（必须是对象、≤1MB），字段级强校验会让 AI 客户端频繁撞墙。
  未知字段忽略，缺失区块在渲染时省略。
- **live server 的会话键带命名空间前缀**：`resume:{slug}`。
- **PDF 导出仅在文档含 CJK 字符时依赖系统 CJK 字体**，缺失时**报错**而不是静默输出豆腐块。
  `zh-CN` 简历**一律**需要中文字体（分节标题本身是中文）；`en` 简历只在正文含
  汉字/假名/谚文/CJK 标点/全角字符时才需要 —— 纯英文简历在没装中文字体的机器上照常导出。
- **国际化（i18n）**：语言分**两轴**，互不干扰 ——
  - **界面语言**：画廊页、工具栏、状态、对话框。按 `?lang=` > `Accept-Language` > `zh-CN` 解析，
    只影响这一次请求，**不落盘**。
  - **简历语言**：分节标题、文档标题、导出 PDF / 独立 HTML。存在 `options.json` 的 `locale` 字段，
    由 `resume_preview` 的 `locale` 参数设置。
  - **导出语言只由简历语言决定**，绝不读请求头 —— 否则同一份简历在不同浏览器下导出结果不一致。
  - 字典是 `src/preview/i18n/<locale>.json` 的**单份 JSON**，服务端与浏览器共用；
    放这里是为了复用 `copy-preview.mjs` 的递归拷贝。**两个字典的 key 集合必须一致**（有测试守着）。
  - 文案取词走服务端渲染（静态文案）+ 客户端 `window.RPI18n`（运行时文案）两层。
    CSP 不允许内联脚本，所以字典走同源接口 `/i18n/:locale.json`，**不放宽 CSP**。
  - 进入文件路径的 locale 一律过白名单（`SUPPORTED_LOCALES`），防路径穿越。
  - 相对时间用 `Intl.RelativeTimeFormat`，别手写复数规则。
  - 详细约定见 [`docs/requirements/refactor-i18n.md`](docs/requirements/refactor-i18n.md)。
- **文档是双语的**，两组都要同步改，漏改一份就是文档过期：
  - [`README.md`](README.md)（中文，GitHub 默认展示）
    - [`README.en.md`](README.en.md)（英文）—— 章节一一对应，顶部有语言切换链接。
  - [`docs/index.html`](docs/index.html) —— **单文件双语**：页面结构只写一份，
    可翻译文本写成 `<span lang="zh-CN">…</span><span lang="en">…</span>`，
    由 CSS 按 `<html lang>` 决定显示哪一个；语言解析顺序与产品一致
    （`?lang=` > `navigator.languages` > `zh-CN`）。
    配套 [`docs/index.md`](docs/index.md)（中文）/ [`docs/index.en.md`](docs/index.en.md)（英文）。
  - 校验方法见 `.claude/skills/docs-auto-sync` 的「第 7 步：核对双语文档」。

## 5. 怎么跑

```bash
npm install          # 安装依赖
npm run build        # tsc + 拷贝 src/preview 到 build/
npm test             # vitest（CI 用 npm test -- --run）
npm run test:e2e     # 端到端：MCP 工具链路 + 官网（需先 build）
npm run dev          # tsc --watch
npm start            # 运行 build/index.js（MCP stdio 模式）
node build/index.js --serve   # 独立画廊模式，打开 http://localhost:3737/
node .claude/dev/call-tool.mjs            # 直接调 MCP 工具（不经过 Claude）
node .claude/dev/verify-live-reload.mjs   # 端到端验证实时刷新链路
node .claude/dev/e2e-mcp.mjs              # 端到端：MCP 工具 + 预览页 + 画廊 + 导出
node .claude/dev/e2e-web.mjs              # 端到端：官网中英双语渲染与交互
npx tsc --noEmit     # 类型检查
npm run format       # prettier --write .
npm run format:check # CI 的格式检查
```

> **端到端脚本**（`.claude/dev/e2e-*.mjs`）用真实 stdio 调 MCP server、真实 Chromium
> 加载页面。它们会**覆盖 `~/.config/resume-preview`** 吗？不会 —— 脚本把 `XDG_CONFIG_HOME`
> 指到临时目录。`e2e-mcp.mjs` 还会用 PATH 替身拦掉「打开默认浏览器」，不会打扰桌面。

**要求**：Node.js >= 22.13。CI 跑在 Node 22/24/25 的 ubuntu 上。

> **MCP server 是常驻进程**：`.mcp.json` 指向 `build/index.js`，改完 `src/` 必须 `npm run build`
> **并重连 MCP server**（`/mcp` 面板），否则 Claude 调到的仍是旧代码。
> 想脱离 Claude 单独调工具，用 `node .claude/dev/call-tool.mjs [工具名] '[JSON参数]'`。

> ⚠️ **Windows 上的已知坑**（不是项目 bug）：
>
> 少数测试断言写死了 POSIX 路径分隔符，已改为平台无关写法；
> 仍有 2 个仅 POSIX 可跑的用例在 Windows 上 `skip`。
>
> 行尾由 `.gitattributes` 统一为 LF（`* text=auto eol=lf`，二进制资源显式 `-text`），
> 存储、检出、CI 三边一致 —— `npm run format:check` 在 Windows 上也能直接用，不需要
> `--end-of-line crlf` 之类的额外参数。

**CI**（`.github/workflows/ci.yml`）：两个 job —— `test`（Node 22/24/25 矩阵，跑测试 + 构建）
与 `lint`（Node 22，跑格式检查 + `tsc --noEmit`）。

**发布**：`npm run prepublishOnly` → `npm run build`；版本号在 `package.json`，
需与 `.claude-plugin/plugin.json` 的 `version` **同步更新**。

## 附：文档索引

| 文档                                                               | 内容                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------- |
| [`assets/architecture.svg`](assets/architecture.svg)               | 分层架构图（各模块一句话职责）                            |
| [`assets/architecture.readme.svg`](assets/architecture.readme.svg) | 架构图的 README 专用横向版（正文宽度内可读）              |
| [`assets/module-deps.svg`](assets/module-deps.svg)                 | 内部模块依赖图（图能力下线后已无循环依赖）                |
| [`assets/external-deps.svg`](assets/external-deps.svg)             | 外部依赖：npm 依赖 / 中间件运行时 / 外部 API              |
| [`docs/api-list.md`](docs/api-list.md)                             | 接口清单：MCP 工具、HTTP、WebSocket、内部函数；含已知问题 |
| [`docs/data-model.md`](docs/data-model.md)                         | 数据模型（以 DB 层为准）；含跨层一致性检查清单            |
| [`assets/data-model-er.svg`](assets/data-model-er.svg)             | 数据模型 ER 图                                            |
| [`README.md`](README.md)                                           | 中文版主文档（**默认展示的那一份**）                      |
| [`README.en.md`](README.en.md)                                     | 英文版主文档（与中文版章节一一对应）                      |
| [`docs/index.html`](docs/index.html)                               | 官网落地页（单文件双语，按浏览器语言切换）                |
| [`docs/index.md`](docs/index.md)                                   | 官网的中文 markdown 版（给 agent 读）                     |
| [`docs/index.en.md`](docs/index.en.md)                             | 官网的英文 markdown 版                                    |

**国际化改造文档**：

| 文档                                                                       | 内容                                                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`docs/requirements/refactor-i18n.md`](docs/requirements/refactor-i18n.md) | 需求定稿：locale 双轴模型、接口契约、改造点清单、边界场景、风险（**已定稿 · 已执行**） |

图的源文件在 `docs/diagrams/`（`architecture.mmd`、`architecture.readme.mmd`、`module-deps.mmd`、
`external-deps.mmd`、`data-model-er.mmd`）—— 改图请改源文件，再用
`.claude/dev/rerender-diagrams.mjs` 重新渲染成 `assets/*.svg`（依赖
`npx @mermaid-js/mermaid-cli`，项目不自带渲染器）。

**改代码后请同步文档** —— 用 `.claude/skills/docs-auto-sync` 检查哪些文档会过期。
