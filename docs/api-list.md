# API 清单 — resume-preview

> 本文件由代码与运行时探测（`src/` + 实际 HTTP 请求）核对得出。
> 相关图：[架构图](../assets/architecture.svg) · [模块依赖](../assets/module-deps.svg) · [外部依赖](../assets/external-deps.svg) · [数据模型 ER](../assets/data-model-er.svg)
>
> **简历域（resume）** —— 本项目**只保留**简历链路：输入简历内容 → 浏览器渲染 → 导出 PDF/HTML。

resume-preview 对外暴露两类接口：

| 类型                      | 协议                | 面向                                       | 绑定地址              |
| ------------------------- | ------------------- | ------------------------------------------ | --------------------- |
| **MCP 工具接口**          | JSON-RPC over stdio | AI 客户端（Claude Code / Codex / Cursor…） | 进程 stdin/stdout     |
| **HTTP + WebSocket 接口** | HTTP/1.1            | 本地浏览器（预览页 / 简历库页）            | `127.0.0.1:3737-3747` |

### 路径速查

本文件中的 `<resumeDir>` 指简历工作区（DB 层）。

```
<resumeDir> = <configDir>/resume-preview/resumes
            = $XDG_CONFIG_HOME/resume-preview/resumes   （已设置时）
            = $HOME/.config/resume-preview/resumes      （Linux/macOS 默认）
            = $USERPROFILE/.config/resume-preview/resumes（Windows 默认）
```

`<resumeDir>` 下每个 `<slug>/` 目录包含（`<slug>` 是 `resume_id` 的 slug，见 §1.1）：

| 文件                 | 内容                                               |
| -------------------- | -------------------------------------------------- |
| `resume.json`        | 简历内容（结构化，**事实来源**）                   |
| `options.json`       | 渲染选项（`template`/`theme`/`locale`）            |
| `resume.html`        | 预览页内嵌内容（**实时预览监听此文件**）           |
| `resume.export.html` | 独立 HTML 导出产物（含 `<style>`，可直接双击打开） |
| `resume.pdf`         | PDF 导出产物（按需生成）                           |

日志写在 `<configDir>/resume-preview/logs/`（`mcp.log` / `web.log`）。

> ⚠️ **重要**：HTTP 服务只监听回环地址 `127.0.0.1`（`SERVER_HOST`，见 `src/constants.ts`），
> 且**没有任何鉴权**。任何能访问本机 3737-3747 端口的进程都可以读取全部简历，
> 并执行 `DELETE /api/resumes/:id`。
> 这是刻意的设计取舍（本地开发者工具），但**绝对不能**把端口暴露到局域网或公网。
> 简历含姓名、电话、邮箱等个人信息，**绝对不能**把端口暴露到局域网或公网。

---

## 目录

- [一、MCP 工具接口（对外）](#一mcp-工具接口对外)
  - [1.1 `resume_preview`](#11-resume_preview)
  - [1.2 `resume_export`](#12-resume_export)
- [二、HTTP 接口（对外）](#二http-接口对外)
  - [2.1 简历库与静态资源](#21-简历库与静态资源)
  - [2.2 简历 REST API](#22-简历-rest-api)
  - [2.3 预览页与导出](#23-预览页与导出)
- [三、WebSocket 接口（对外）](#三websocket-接口对外)
- [四、内部接口（不对外暴露）](#四内部接口不对外暴露)
- [五、状态码与错误约定](#五状态码与错误约定)
- [六、已知问题与注意事项](#六已知问题与注意事项)

---

## 一、MCP 工具接口（对外）

服务入口 `src/index.ts`，通过 `StdioServerTransport` 传输。
工具定义见 `src/index.ts` 的 `TOOL_DEFINITIONS`，实现见 `src/handlers.ts`。

MCP 只暴露 **2 个**工具：

| 工具             | 作用                                |
| ---------------- | ----------------------------------- |
| `resume_preview` | 渲染简历并在浏览器打开（实时预览）  |
| `resume_export`  | 把简历导出为 PDF 或 HTML 到指定路径 |

### 1.1 `resume_preview`

输入简历内容，渲染到本地浏览器并支持 WebSocket 实时刷新。

**入参**（JSON Schema，声明在 `src/index.ts` 的 `TOOL_DEFINITIONS`）

| 参数        | 类型             | 必填 | 默认      | 约束                                                                                                                      |
| ----------- | ---------------- | ---- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `resume_id` | string           | ✅   | —         | 非空字符串，≤200 字符；**可含中文**。落盘名与 URL 使用其 slug（见下）                                                     |
| `content`   | object \| string | ✅   | —         | 简历内容。**对象** = §1.1 内容模型；**字符串** = JSON 文本（server 自行 `JSON.parse`）。≤1MB                              |
| `template`  | string           | ❌   | `default` | `default`（`RESUME_TEMPLATES` 白名单）；省略则沿用 `options.json` 已存值                                                  |
| `theme`     | string           | ❌   | `default` | `default`（`RESUME_THEMES` 白名单）；省略则沿用已存值                                                                     |
| `locale`    | string           | ❌   | `zh-CN`   | `zh-CN` \| `en`（`SUPPORTED_LOCALES` 白名单）；**简历本身的语言**（分节标题、导出产物）。省略则沿用 `options.json` 已存值 |

> **slug 规则**：为在**不放宽** `PREVIEW_ID_REGEX`（路径穿越的唯一防线）的前提下支持中文 id，
> `resume_id` 会被转换为 slug：
>
> - 已是 `[a-zA-Z0-9_-]+` → 原样保留（`frontend-senior` → `frontend-senior`）；
> - 否则 → 剥离 ASCII 骨架 + 6 位 sha256 哈希后缀（`小王的简历` → `r-3f9a2b`）。
>
> slug 同时用作**目录名**与 **URL 路径**，因此 `resume_id` 与落盘名解耦。

**内容模型**（`resume.json` 的结构，字段均可选）

```jsonc
{
  "version": 1,
  "basics": {
    "name": "王小明",
    "title": "高级前端工程师",
    "email": "wang@example.com",
    "phone": "138-0000-0000",
    "location": "上海",
    "links": [{ "label": "GitHub", "url": "https://github.com/..." }],
  },
  "summary": "8 年前端经验，主导过 3 个亿级 DAU 项目…",
  "experience": [
    {
      "company": "某某科技",
      "title": "高级前端工程师",
      "start": "2021-03",
      "end": "至今",
      "location": "上海",
      "highlights": ["主导 X 重构，首屏从 4.2s 降到 1.1s"],
    },
  ],
  "projects": [{ "name": "…", "role": "…", "period": "…", "highlights": ["…"] }],
  "education": [{ "school": "…", "degree": "…", "period": "…", "highlights": ["…"] }],
  "skills": [{ "category": "前端", "items": ["TypeScript", "React"] }],
  "extras": [{ "label": "证书", "items": ["…"] }],
}
```

**字段规则**

| 字段          | 必填 | 说明                                         |
| ------------- | ---- | -------------------------------------------- |
| `basics.name` | ❌   | 缺失时渲染标题为占位符，**不报错**           |
| 其余          | ❌   | 缺失的区块在渲染时**整块省略**，不显示空标题 |

> **正文一律按纯文本渲染**并做 HTML 转义 —— 内容中的 HTML 标签、`<script>`、事件属性**不会**被解释。
> 未知的顶层字段被忽略；不做 JSON Schema 全量校验。

**副作用**

1. 写入 `<resumeDir>/<slug>/resume.json`（内容，含 `version`）与 `options.json`（`template`/`theme`）。
2. 渲染 → `<resumeDir>/<slug>/resume.html`（PDF 按需生成）。
3. **删除缓存的导出产物**（`resume.pdf` / `resume.export.html`）——内容变了，旧产物就是旧版本。
4. 启动/复用 live server，注册文件监听（监听 `resume.html`），**首次**渲染时自动打开浏览器。

**返回**（MCP content 数组；分「首次渲染」与「已连接客户端」两支）

```jsonc
// 首次渲染（无已连接客户端）
{ "content": [{ "type": "text", "text": "Resume rendered successfully and opened in browser.\nWorking file: <resumeDir>/frontend-senior/resume.json\n\nLive reload URL: http://localhost:3737/resume/frontend-senior\nThe resume will auto-refresh when you update it." }] }

// 再次渲染（已有客户端）
{ "content": [{ "type": "text", "text": "Resume updated successfully.\nWorking file: ...\n\nResume updated. Browser will refresh automatically." }] }
```

**错误**（返回 `isError: true` 的 content）

- `resume_id parameter is required`
- `content parameter is required`
- `Invalid resume ID: must be at most 200 characters`
- `Invalid content: <原始错误>`（JSON 解析失败，或不是对象）
- `Invalid content: Resume content exceeds 1024KB limit`
- `Invalid template: "x". Allowed values: default.`
- `Invalid theme: "x". Allowed values: default.`
- `Error rendering resume: <原始错误>`

### 1.2 `resume_export`

把已渲染的简历导出到指定路径。

**入参**

| 参数        | 类型    | 必填 | 默认    | 约束                                                         |
| ----------- | ------- | ---- | ------- | ------------------------------------------------------------ |
| `resume_id` | string  | ✅   | —       | 同 §1.1                                                      |
| `save_path` | string  | ✅   | —       | 目标路径；经 `validateSavePath` 校验（禁空字节、禁系统目录） |
| `format`    | string  | ❌   | `pdf`   | `pdf` \| `html`（`RESUME_FORMATS`）                          |
| `refresh`   | boolean | ❌   | `false` | `true` = 强制重新渲染，忽略缓存产物                          |

**返回**

```jsonc
{ "content": [{ "type": "text", "text": "Resume saved to: ./docs/小王-简历.pdf (PDF)" }] }
```

**行为**

- 产物缓存失效判定：比较产物与 `resume.json` 的 mtime，**产物不严格新于内容**即视为过期；
- 过期（或 `refresh: true`）→ 重新渲染后拷贝；未过期 → 直接拷贝缓存产物。
  每次 `resume_preview` 写新内容时也会主动删除缓存产物，因此「改内容 → 导出」不会拿到旧版本。

| `format` | 产物文件             | 说明                                 |
| -------- | -------------------- | ------------------------------------ |
| `pdf`    | `resume.pdf`         | Chromium 打印 A4 PDF                 |
| `html`   | `resume.export.html` | 独立 HTML（含 `<style>`，决策 D15′） |

**独立 HTML 的版式**：`<body class="resume-export">` 下，A4 纸张（`210mm` 宽、`15mm` 内边距）
水平居中放在灰色底衬上并带投影（`src/preview/resume.css`）。
`@media print` 内回退为 `180mm` 内容宽、无内边距、无阴影 —— **PDF 产物与浏览器打印结果不受影响**，
页边距一律由 `@page { margin: 15mm }` 提供。

> ⚠️ `resume.html` 是**预览页内嵌内容**，不是导出产物，两者不可混用。
>
> ⚠️ **两条导出路径行为不同**：MCP 工具会缓存产物（按上面的规则失效），
> 浏览器里的 ⬇ 按钮走 `GET /resume/export/{slug}`，每次现渲染、不落盘。

**错误**

- `save_path parameter is required` / `resume_id parameter is required`
- `Invalid save path: Path contains null bytes` / `Invalid save path: Cannot write to system directories`
- `Invalid save path: Extension ".pdf" does not match format "html"`
- `Invalid format: "x". Allowed values: pdf, html.`
- `Error saving resume: <原始错误>`

> ⚠️ **导出路径的扩展名必须与 `format` 一致**，否则直接报错。
> 简历文件投不出去，扩展名错了必然是错的。

---

## 二、HTTP 接口（对外）

服务由 `src/live-server.ts` 的 `ensureLiveServer()` 启动，端口在 `3737-3747`（`SERVER_PORT_START`/`END`）中顺序探测第一个可用端口。

**路由分发顺序**（`src/live-server.ts`）：

```
matchRoute(url)              → 新路由表（routes.ts）
  ↓ 未命中
/resume/export/              → 简历导出
  ↓ 未命中
/resume/view/                → 简历静态预览页
  ↓ 未命中
/resume/                     → 简历实时预览页
  ↓ 未命中
/favicon.svg、/favicon.ico   → 图标（内联分支）
  ↓ 未命中
默认                          → 404 Not found
```

> ⚠️ `/resume/export/` 与 `/resume/view/` **必须**排在 `/resume/` 之前判定 ——
> 匹配是顺序敏感的前缀匹配，否则会被当成 `resume_id = "export/xxx"`（含 `/`）而落到 400。

**路由匹配规则**：`ROUTE_CONFIG` 中 `exact: true` 的条目要求路径**完全相等**；
未设置 `exact` 的条目（仅 `RESUME_ROUTES.API_ITEM`，即 `/api/resumes/`）使用 **前缀匹配**。

**查询字符串处理**：路由匹配与路径参数解析均基于 **pathname**（已剥离 `?query` 与 `#fragment`）。
例如 `/gallery.css?v=2`、`/resume/frontend-senior?x=1` 均能正确命中路由。

**已下线的路由**（图能力下线后不再存在）：
`GET /view/:id`、`GET /export/:id`、`GET /mermaid-live/:id`、`GET /style.css`、`GET /script.js`、
`GET /api/diagrams`、`DELETE /api/diagrams/:id`。

---

### 2.1 简历库与静态资源

| 方法 | 路径                 | 处理函数               | 返回          | 响应头                                                     |
| ---- | -------------------- | ---------------------- | ------------- | ---------------------------------------------------------- |
| GET  | `/`                  | `handleGallery`        | 简历库页 HTML | `Content-Security-Policy`, `Content-Language`, `text/html` |
| GET  | `/shared.css`        | `handleSharedCss`      | 共享样式      | `text/css`, `Cache-Control: no-store`                      |
| GET  | `/gallery.css`       | `handleGalleryCss`     | 简历库样式    | `text/css`, `Cache-Control: no-store`                      |
| GET  | `/gallery.js`        | `handleGalleryJs`      | 简历库脚本    | `application/javascript`, `Cache-Control: no-store`        |
| GET  | `/i18n.js`           | `handleI18nScript`     | 取词模块      | `application/javascript`, `Cache-Control: no-store`        |
| GET  | `/i18n/:locale.json` | `handleI18nDictionary` | 字典 JSON     | `application/json`, `Cache-Control: no-store`              |

**简历库页 HTML**：由 `renderPage()`（`src/page-renderer.ts`）把 `src/preview/gallery.html` 与变量
`{{PAGE_TITLE}}` `{{NAV}}` `{{FOOTER}}` `{{PORT}}` `{{LANG}}` `{{LANG_SWITCH}}` 替换后输出，
其中的 `{{i18n:gallery.title}}` 一类占位符按当前 locale 取词。
简历库页自身不带导航与页脚（`includeNav: false, includeFooter: false`）。

**界面语言（locale）解析**：`?lang=` > `Accept-Language` > 默认 `zh-CN`。
`?lang=` 命中白名单才生效，不命中则忽略并继续下探，不返回错误。
`/i18n/:locale.json` 的 locale 必须在白名单内，否则 404（取值绝不拼进文件路径）。

**简历库前端行为**（`src/preview/gallery.js`）：

- 页面加载时 `GET /api/resumes` 拉取简历列表；
- 搜索框对 `id` 做大小写不敏感的包含匹配（300ms 防抖，纯前端过滤，不发请求）；
- 卡片链接指向 `/resume/view/<id>`（静态预览页）；
- 删除按钮 → `confirm()` → `DELETE /api/resumes/<id>`。

### 2.2 简历 REST API

| 方法   | 路径               | 处理函数                | 返回 | 说明                     |
| ------ | ------------------ | ----------------------- | ---- | ------------------------ |
| GET    | `/api/resumes`     | `handleApiResumes`      | JSON | 列出全部简历             |
| DELETE | `/api/resumes/:id` | `handleApiResumeDelete` | JSON | 删除单个简历及其全部文件 |

> `/api/resumes` 集合路由使用**精确匹配**，不会像前缀匹配那样把 `/api/resumesXYZ` 误吞进来。
> `GET /api/resumes/:id`（详情）**不做**。

#### GET `/api/resumes`

**200 响应**

```json
{
  "resumes": [
    {
      "id": "frontend-senior",
      "template": "default",
      "theme": "default",
      "modifiedAt": "2026-11-17T01:22:20.558Z",
      "sizeBytes": 42449
    }
  ],
  "count": 1
}
```

| 字段         | 类型            | 来源                              |
| ------------ | --------------- | --------------------------------- |
| `id`         | string          | 目录名（`resume_id` 的 slug）     |
| `template`   | string          | `options.json` 的 `template` 字段 |
| `theme`      | string          | `options.json` 的 `theme` 字段    |
| `modifiedAt` | ISO 8601 string | 渲染产物的 `fs.stat().mtime`      |
| `sizeBytes`  | number          | 渲染产物的字节数                  |

> **不暴露 `format`** —— 导出格式是每次调用的参数，不是简历的属性。

**排序**：`modifiedAt` **倒序**（最新在前）。
**容错**：目录名不合法或不可访问时**跳过**该条目而非报错；`resumes` 目录不存在时返回空数组。

**500 响应**：`{"error": "Failed to list resumes", "message": "<原始错误>"}`

#### DELETE `/api/resumes/:id`

**前置校验**：`id` 必须匹配 `/^[a-zA-Z0-9_-]+$/`（即必须是 slug），否则返回 400。

**200 响应**：`{"success": true}`

**副作用**：删除 `<resumeDir>/<slug>/` 整个目录（`resume.json`、`options.json`、各格式渲染产物），
并结束该简历的实时预览会话（关闭文件监听、断开 WebSocket 客户端）。

**错误响应**

| 状态 | 响应体                                                                      | 触发条件                  |
| ---- | --------------------------------------------------------------------------- | ------------------------- |
| 400  | `{"error": "Invalid resume ID"}`                                            | `id` 格式非法             |
| 404  | `{"error": "Not found"}`                                                    | URL 不匹配任何 API 模式   |
| 405  | `{"error": "Method not allowed"}`                                           | 路径匹配但方法不是 DELETE |
| 500  | `{"error": "Failed to delete resume", "message": "Resume not found: <id>"}` | 简历不存在                |

### 2.3 预览页与导出

| 方法 | 路径                    | 处理函数                    | 返回            | 说明                                   |
| ---- | ----------------------- | --------------------------- | --------------- | -------------------------------------- |
| GET  | `/resume/{slug}`        | `handleResumeLiveRequest`   | HTML            | **实时预览页**（WebSocket）            |
| GET  | `/resume/view/{slug}`   | `handleResumeViewRequest`   | HTML            | **静态预览页**（无 WS）                |
| GET  | `/resume/export/{slug}` | `handleResumeExportRequest` | 二进制/文件     | 导出（`?format=pdf\|html`）            |
| GET  | `/resume.css`           | `handleResumeCss`           | `text/css`      | 简历预览页样式                         |
| GET  | `/resume.js`            | `handleResumeJs`            | JS              | 简历预览页脚本                         |
| GET  | `/favicon.svg`          | 内联                        | `image/svg+xml` | `Cache-Control: public, max-age=86400` |
| GET  | `/favicon.ico`          | 内联                        | 302             | 重定向到 `/favicon.svg`                |

**GET `/resume/{slug}` — 简历实时预览页**

- **200**：HTML（`text/html` + CSP + `Content-Language`）。内嵌简历 HTML + 工具栏（缩放/平移/导出）。
  页面通过 `data-port`、`data-resume-id`、`data-live-enabled` 三个 `data-*` 属性接收配置。
- **404**：`Resume not found`（`slug` 未注册到 live server 的内存表）
- **500**：`Error reading resume: <原始错误>`

**GET `/resume/view/{slug}` — 简历静态预览页**

- **200**：HTML。渲染**已保存到磁盘的** `resume.html`，`liveEnabled=false`。
- **400**：`Invalid resume ID`
- **404**：`Resume not found: <原始错误>`

> 静态页**不要求**简历已注册到 live server —— 直接读磁盘，
> 因此进程重启后仍能访问历史简历。

**预览页的双语言**：工具栏与状态提示跟随**界面语言**（`?lang=` > `Accept-Language` > `zh-CN`），
简历正文跟随**简历语言**（`options.json` 的 `locale`）。两者独立，互不影响。

**GET `/resume/export/{slug}` — 简历导出**

- **入参**：query `format`，取值 `pdf` \| `html`，默认 `pdf`。
- **200**：二进制，`Content-Disposition: attachment; filename="<slug>.<format>"`，`Cache-Control: no-store`。
- **400**：`Resume ID is required` / `Invalid resume ID` / `Invalid format: ...`
- **404**：`Resume not found`
- **500**：`Failed to export resume`

> **导出语言只由简历的 locale 决定**，与请求的语言无关 —— 同一份简历在任何浏览器下导出结果一致。

---

## 三、WebSocket 接口（对外）

| 项         | 值                                         |
| ---------- | ------------------------------------------ |
| 端点       | `ws://localhost:{port}/resume/{slug}`      |
| 协议       | 纯文本单向推送，服务端 → 客户端            |
| 消息       | `"reload"`（常量 `WS_MESSAGES.RELOAD`）    |
| 触发       | 被监听文件发生 `change` 事件（`fs.watch`） |
| 客户端行为 | 收到 `"reload"` → `location.reload()`      |

**连接校验**：`slug` 必须已注册到 live server 的内存表，否则服务端立即 `ws.close()`。

**重连策略**（`src/preview/resume.js`）：断线后每 2 秒重连一次，最多 30 次；
超出后状态栏显示 `Connection failed - Reload page to retry`。

> **会话键带命名空间**：live server 的内存 Map 以 `resume:{slug}` 为键。
> 简历的 WS 端点以 `resume/` 前缀分流 —— 实现把去掉首个 `/` 的整段 URL 当作 id，
> 不加前缀分流的话 `/resume/abc` 会被当成 `resume_id = "resume/abc"` 而连不上。

> ⚠️ **CSP 与绑定地址不一致**：`CSP_HEADER` 声明 `connect-src 'self' ws://localhost:*`，
> 而服务实际绑定 `127.0.0.1`。浏览器访问 `http://localhost:{port}` 时能通过 CSP；
> 若直接访问 `http://127.0.0.1:{port}`，`'self'` 仍匹配，但 `ws://localhost:*` 与
> 页面脚本里硬编码的 `ws://localhost:${port}` 组合要求用户也用 `localhost` 访问。

---

## 四、内部接口（不对外暴露）

以下是 TypeScript 模块之间通过 ES import 调用的内部函数，**不构成网络协议**。

### `src/index.ts`（入口层）

| 函数   | 签名                  | 说明                                                                         |
| ------ | --------------------- | ---------------------------------------------------------------------------- |
| `main` | `() => Promise<void>` | 连接 stdio transport                                                         |
| —      | `--serve` 参数        | 动态 import `./serve.js` 并调用 `startServeMode()`；**此时不启动 MCP stdio** |

### `src/handlers.ts`（应用层）

| 函数                     | 签名                                                                 | 说明                           |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------ |
| `handleResumePreview`    | `(args: any) => Promise<any>`                                        | `resume_preview` 的实现        |
| `handleResumeExport`     | `(args: any) => Promise<any>`                                        | `resume_export` 的实现         |
| `setupResumeLivePreview` | `(resumeId, slug, htmlPath) => Promise<{serverUrl, hasConnections}>` | 注册简历实时会话并按需开浏览器 |

### `src/live-server.ts`（接入层）

| 函数                        | 签名                                         | 说明                                             |
| --------------------------- | -------------------------------------------- | ------------------------------------------------ |
| `ensureLiveServer`          | `() => Promise<number>`                      | 启动（或复用）HTTP+WS 服务，返回端口             |
| `addLiveSession`            | `(id, filePath, namespace) => Promise<void>` | 注册会话并建立文件监听                           |
| `removeLiveSession`         | `(id: string, namespace: string) => void`    | 结束实时会话：关监听、断客户端                   |
| `hasActiveConnections`      | `(id: string, namespace: string) => boolean` | 该简历是否有已连接的浏览器                       |
| `closeLiveServer`           | `() => Promise<void>`                        | 优雅关闭，清理所有监听与连接                     |
| `getPathname`               | `(rawUrl?: string) => string`                | 剥离 query/fragment，得到用于路由的 pathname     |
| `resumeSessionKey`          | `(id: string) => string`                     | 构造带命名空间的会话键                           |
| `resolveSessionFromPath`    | `(path: string) => LiveSession \| null`      | 从路径解析会话（仅 `/resume/` 前缀）             |
| `escapeHtml`                | `(unsafe: string) => string`                 | HTML 转义（从 `html-utils.ts` 再导出）           |
| `handleResumeLiveRequest`   | `(url, req, res, port) => Promise<void>`     | 简历实时预览页（界面语言按请求解析）             |
| `handleResumeViewRequest`   | `(url, req, res) => Promise<void>`           | 简历静态预览页                                   |
| `handleResumeExportRequest` | `(url, res) => Promise<void>`                | 简历导出（PDF / HTML），语言只由简历 locale 决定 |

### `src/routes.ts`（应用层）

| 函数                                                       | 签名                                       | 说明                       |
| ---------------------------------------------------------- | ------------------------------------------ | -------------------------- |
| `matchRoute`                                               | `(url: string) => Route \| null`           | 按 `ROUTE_CONFIG` 匹配路由 |
| `handleGallery`                                            | `(context: RouteContext) => Promise<void>` | 简历库页                   |
| `handleApiResumes`                                         | `(context: RouteContext) => Promise<void>` | 简历列表 API               |
| `handleApiResumeDelete`                                    | `(context: RouteContext) => Promise<void>` | 简历删除 API               |
| `handleSharedCss` / `handleGalleryCss` / `handleGalleryJs` | `(context) => Promise<void>`               | 静态资源                   |
| `handleResumeCss` / `handleResumeJs`                       | `(context) => Promise<void>`               | 简历静态资源               |

### `src/resume-service.ts`（业务层）

| 函数            | 签名                                                | 说明                           |
| --------------- | --------------------------------------------------- | ------------------------------ |
| `listResumes`   | `() => Promise<ResumeInfo[]>`                       | 列出简历，按 mtime 倒序        |
| `getResumeInfo` | `(resumeId: string) => Promise<ResumeInfo \| null>` | 单个简历元信息                 |
| `deleteResume`  | `(resumeId: string) => Promise<void>`               | 删除简历（校验存在性后删目录） |

### `src/file-utils.ts`（能力层）

| 函数                                                                                           | 签名                                                  | 说明                                                       |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| `getConfigDir` / `getAppDir` / `getResumesDir` / `getLogsDir`                                  | `() => string`                                        | 路径解析：`$XDG_CONFIG_HOME` → `$HOME/.config` → `tmpdir`  |
| `migrateLegacyAppDir`                                                                          | `() => Promise<void>`                                 | 改名迁移：旧 `claude-mermaid/` 目录合并进新目录            |
| `validatePreviewId`                                                                            | `(previewId: string) => void`                         | slug 校验（`PREVIEW_ID_REGEX`）                            |
| `validateResumeId` / `validateResumeTemplate` / `validateResumeTheme` / `validateResumeFormat` | —                                                     | 简历入参校验                                               |
| `validateResumeLocale`                                                                         | `(locale: string) => Locale`                          | locale 白名单校验（`SUPPORTED_LOCALES`），返回收窄后的类型 |
| `validateSavePath`                                                                             | `(savePath: string, expectedFormat?: string) => void` | 路径穿越与系统目录防护；给定格式时校验扩展名一致           |
| `getOpenCommand`                                                                               | `(url: string) => OpenCommand`                        | 跨平台打开浏览器：`open` / `cmd.exe /c start` / `xdg-open` |
| `slugifyResumeId`                                                                              | `(resumeId: string) => string`                        | id → 安全 slug（非 ASCII 剥离 + 哈希后缀）                 |
| `getResumeDir` / `getResumeFilePath`                                                           | `(resumeId, kind) => string`                          | 简历工作区与产物路径                                       |
| `saveResumeContent` / `loadResumeContent` / `saveResumeOptions` / `loadResumeOptions`          | —                                                     | 读写简历内容与选项                                         |
| `normalizeResumeContent`                                                                       | `(input: unknown) => ResumeContent`                   | 接受对象或 JSON 字符串，输出内容模型                       |
| `invalidateResumeArtifacts` / `isResumeArtifactStale`                                          | —                                                     | 导出产物的缓存失效与过期判定                               |
| `deleteResumeDirectory`                                                                        | `(resumeId: string) => Promise<void>`                 | 删除简历目录（`rm` + `recursive`）                         |

### `src/resume-renderer.ts`（能力层）

| 函数                                       | 签名                                                                          | 说明                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `renderResumeHtml`                         | `(content: ResumeContent, locale: Locale) => Promise<string>`                 | 内容 → 预览页内嵌 HTML（正文全部转义，分节标题按 locale 取词）                             |
| `createResumeHtmlWrapper`                  | `(bodyHtml: string, options: ResumePageOptions) => Promise<string>`           | 内嵌 HTML → 完整预览页（替换 `{{CONTENT}}` `{{RESUME_ID}}` `{{PORT}}` `{{LIVE_ENABLED}}`） |
| `renderResumeExportHtml`                   | `(content: ResumeContent, locale: Locale) => Promise<string>`                 | 内容 → 独立 HTML 导出文件                                                                  |
| `renderResumePdf`                          | `(content: ResumeContent, locale: Locale, options?) => Promise<Buffer>`       | 内容 → Chromium 打印 A4 PDF（文档含 CJK 字符时检测 CJK 字体；zh-CN 一律检测）              |
| `loadResumeTemplate` / `loadResumeStyles`  | `() => Promise<string>`                                                       | 加载简历模板与样式（导出时内联）                                                           |
| `clearResumeTemplateCache`                 | `() => void`                                                                  | 清模板缓存                                                                                 |
| `ensureBrowser` / `closeBrowser`           | `() => Promise<Browser>` / `() => Promise<void>`                              | 常驻 Chromium 单例与进程退出清理                                                           |
| `detectCjkFont` / `assertCjkFontAvailable` | `() => Promise<boolean \| null>` / `(detect?: FontDetector) => Promise<void>` | CJK 字体检测与「缺失即报错」                                                               |
| `resumeNeedsCjkFont`                       | `(content: ResumeContent, locale: Locale) => boolean`                         | 判断导出文档是否含 CJK 字符；`zh-CN` 一律为 true                                           |
| `assertPdfFontAvailable`                   | `(content, locale, detect?) => Promise<void>`                                 | PDF 导出的字体门禁；不需要 CJK 字体时完全不查检测器                                        |

### `src/page-renderer.ts`

| 函数                 | 签名                                                   | 说明                                   |
| -------------------- | ------------------------------------------------------ | -------------------------------------- |
| `renderPage`         | `(contentTemplate, data, options?) => Promise<string>` | 模板变量替换 + 页面拼装                |
| `escapeHtml`         | `(unsafe: string) => string`                           | HTML 转义（从 `html-utils.ts` 再导出） |
| `clearTemplateCache` | `() => void`                                           | 清模板缓存（**当前无调用方**）         |

### `src/i18n.ts`（基础层）

| 函数                     | 签名                                             | 说明                                                 |
| ------------------------ | ------------------------------------------------ | ---------------------------------------------------- |
| `resolveLocale`          | `(hints: { query?, acceptLanguage? }) => Locale` | 界面语言解析：`?lang=` > `Accept-Language` > 默认    |
| `matchLocale`            | `(tag: string) => Locale \| null`                | 语言标签匹配白名单（`en-US` → `en`，`zh` → `zh-CN`） |
| `parseAcceptLanguage`    | `(header?: string) => Locale \| null`            | 按 q 值解析 `Accept-Language`                        |
| `getDictionary`          | `(locale: Locale) => Promise<Dictionary>`        | 取字典，缺失的 key 回落到英文                        |
| `t`                      | `(dictionary, key, vars?) => string`             | 按点分 key 取词并替换 `{placeholder}`                |
| `getHtmlLang`            | `(dictionary, locale) => string`                 | `<html lang>` 的取值                                 |
| `renderLanguageSwitcher` | `(dictionary, locale, path) => string`           | 语言切换器 HTML（`?lang=` 链接）                     |
| `isSupportedLocale`      | `(value: unknown) => value is Locale`            | 白名单判定                                           |

### `src/html-utils.ts`

| 函数         | 签名                         | 说明                                  |
| ------------ | ---------------------------- | ------------------------------------- |
| `escapeHtml` | `(unsafe: string) => string` | HTML 转义（唯一实现，被上两者再导出） |

### `src/logger.ts`

| 导出                      | 说明                                                           |
| ------------------------- | -------------------------------------------------------------- |
| `mcpLogger` / `webLogger` | 两个 `Logger` 实例，分别写 `mcp.log` / `web.log`               |
| `LogLevel`                | `DEBUG`(0) \| `INFO`(1) \| `WARN`(2) \| `ERROR`(3) \| `OFF`(4) |
| `createTestLoggers`       | `(baseDir) => {mcpLogger, webLogger}`                          | 测试用自定义目录 |

### `src/serve.ts`

| 函数             | 签名                  | 说明                                                   |
| ---------------- | --------------------- | ------------------------------------------------------ |
| `startServeMode` | `() => Promise<void>` | `--serve` 模式入口：注册存量简历、启动服务、打开简历库 |

> `--serve` 模式会扫描 `resumes/` 并把已有 `resume.html` 的简历注册为实时会话，
> 因此重启后历史简历的预览页依然能自动刷新。

---

## 五、状态码与错误约定

### HTTP 状态码

| 码  | 含义       | 典型场景                           |
| --- | ---------- | ---------------------------------- |
| 200 | 成功       | 页面、静态资源、API 列表、删除成功 |
| 302 | 重定向     | `/favicon.ico` → `/favicon.svg`    |
| 400 | 参数非法   | id 格式错误、id 为空               |
| 404 | 资源不存在 | 简历未注册、文件不存在、路由不匹配 |
| 405 | 方法不允许 | 非 DELETE 调用 `/api/resumes/:id`  |
| 500 | 服务端错误 | 渲染失败、读取失败、Chromium 崩溃  |

### 错误响应体格式

项目**存在两套不统一的错误体格式**：

```
# API 路由（routes.ts）—— JSON
{ "error": "<简短描述>", "message": "<原始错误>" }   // 500
{ "error": "<简短描述>" }                            // 400 / 404 / 405

# 简历路由（live-server.ts）—— 纯文本
"Invalid resume ID"
"Resume not found"
"Failed to export resume"
"Error reading resume: <原始错误>"
```

### MCP 错误

工具内部错误**不抛异常**，而是返回 `isError: true` 的 content 数组。
但 `src/index.ts` 的 `CallTool` 处理器仍会捕获并**重新抛出**未处理的异常。

### 响应头约定

| 头                                     | 值                                                                                                                                         | 适用范围                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `Content-Security-Policy`              | `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://localhost:*` | 所有 HTML 响应                                   |
| `Content-Language`                     | 当前语言（`zh-CN` \| `en`）                                                                                                                | 简历库页、预览页（界面语言）；导出端点为简历语言 |
| `Cache-Control: no-store`              | —                                                                                                                                          | 静态资源与 API                                   |
| `Cache-Control: public, max-age=86400` | —                                                                                                                                          | `/favicon.svg`                                   |

> `script-src 'self'` 不含 `unsafe-inline`，因此简历预览页的脚本**必须**是独立同源文件
> （`/resume.js`、`/i18n.js`），不能内联进 HTML。翻译字典因此走同源 JSON 接口
> （`/i18n/:locale.json`）而不是内联脚本。

---

## 六、已知问题与注意事项

### 已修复

1. **删除被监听文件导致进程崩溃**（高危）——
   `fs.watch` 的 `FSWatcher` 没有 `error` 监听器，被监听文件被删除时 Node 抛出
   `EPERM: operation not permitted, watch`，作为未处理的 `error` 事件**直接终止整个进程**，
   MCP 服务随之崩溃。修复：加 `error` 监听 + 移除会话清理。
   见 `src/live-server.ts` 的 `addLiveSession()`，回归测试 `test/live-server/regressions.test.ts`。
   简历侧的 watch 走同一条路径，同样带 `error` 监听。

2. **查询字符串破坏路由** ——
   原实现直接用 `req.url`（含 `?query`）做路由匹配与路径参数解析，
   导致 `/gallery.css?v=2`、`/resume/frontend-senior?x=1` 全部 404/400。
   修复：新增 `getPathname()`，路由与路径解析统一基于 pathname。

### 仍然存在（未修改代码，仅记录）

3. **`ASSET_FILES.FAVICON` 定义但未使用** ——
   `ASSET_FILES` 中 `FAVICON` 定义了 `favicon.svg` 文件名，
   但 `live-server.ts` 用的是硬编码常量 `FAVICON_PATH`。
   （`SHARED_STYLE` / `GALLERY_STYLE` / `GALLERY_SCRIPT` / `RESUME_STYLE` / `RESUME_SCRIPT`
   已由 `routes.ts` 正常使用。）

4. **`escapeHtml` 已收敛到一处** ——
   实现原本在 `src/live-server.ts` 与 `src/page-renderer.ts` 各有一份，现已统一到
   `src/html-utils.ts`；两个旧模块改为再导出以保持对现有调用方的兼容。

5. **API 响应体未使用类型定义** ——
   `handleApiResumes` 手写 `{resumes, count}`，`handleApiResumeDelete` 手写 `{success: true}`，
   均未复用 `types.ts` 中的类型。

6. **`GET /api/resumes/:id` 返回 405 而非 404** ——
   `/api/resumes/` 是前缀匹配条目，路径能命中，但该路径只实现了 DELETE。

7. **CSP 的 `ws://localhost:*` 与绑定的 `127.0.0.1` 不一致** ——
   用户需以 `localhost` 访问才能保证 WebSocket 连通。

8. **`ROUTES.ROOT` 与 `ROUTES.GALLERY` 值完全相同** ——
   两者都是 `"/"`（`src/constants.ts`）。
   `ROUTES.ROOT` 用于路由表，`ROUTES.GALLERY` 只在 `page-renderer.ts` 生成导航链接时使用。

9. **PDF 导出的字体依赖是有条件的** ——
   Chromium 打印 PDF 时若系统没有中文字体，中文会渲染成豆腐块。
   现在**只在导出文档含 CJK 字符时才检测**：`zh-CN` 简历一律检测（分节标题、
   文档标题、名字占位符本身就是中文），`en` 简历按正文实际字符判定 ——
   纯英文简历在没装中文字体的机器上照常导出。
   （此前导出路径**无条件**调用 `assertCjkFontAvailable()`，纯英文简历也会被拦下；
   英文正文其实渲染正常，字体栈末尾兜底 `sans-serif`。）
   另注：`detectCjkFont()` 在非 Windows 平台依赖 `fc-list :lang=zh`；若系统没装 fontconfig
   （返回 `null`），导出**只告警不拦截** —— 即"缺失即报错"仅在检测手段可用时成立。

10. **`resume.json` 不做字段级校验** ——
    只做结构性校验（必须是对象、≤1MB）；未知字段被忽略，缺失区块在渲染时省略。
    这是刻意的取舍：字段级强校验会让 AI 客户端频繁撞墙。

11. **简历的实时预览会话在进程重启后不会自动恢复** ——
    live server 的内存 Map 是可丢失的：
    重启后 `resume.html` 仍在磁盘上，但 `/resume/{slug}` 会返回 404，
    需要重新调用一次 `resume_preview` 才能恢复。`/resume/view/{slug}` 不受影响（直接读磁盘）。
    （`--serve` 模式会在启动时扫描 `resumes/` 重新注册已有 `resume.html` 的简历。）

12. **改名迁移是历史遗留** ——
    `~/.config/claude-mermaid/` 在启动时由 `migrateLegacyAppDir()` 改名或合并到
    `~/.config/resume-preview/`。迁移逻辑**不抛异常**，失败只告警。
    图能力下线后，旧目录中的 `live/` 子目录不再被读取。

13. **预览页的语言切换只改界面语言，不改简历正文语言** ——
    `?lang=` 切换的是工具栏与状态提示的语言；简历正文的语言由简历的 `locale` 决定。
    预览页的正文是**预渲染产物**（`resume.html`），要在预览中换正文语言，
    需要用新的 `locale` 重新调用一次 `resume_preview`。
    （导出不受此限：导出总是按简历的 `locale` 渲染，与请求语言无关。）
