# 数据模型 — resume-preview

> 本文件以 **DB 层（磁盘持久化层）** 为准描述数据模型，并补充内存态与 MCP 层的视图对象。
> 相关图：[数据模型 ER 图](../assets/data-model-er.svg) · [架构图](../assets/architecture.svg) · [模块依赖](../assets/module-deps.svg) · [外部依赖](../assets/external-deps.svg) · [API 清单](./api-list.md)
>
> 响应头约定（如 CSP）与 WebSocket 端点细节见 [API 清单 · 响应头约定](./api-list.md#响应头约定)。
>
> **本项目只保留简历域**：图（Mermaid）能力已于 3.0.0 下线，
> 原 DIAGRAM 聚合与 `live/` 工作区已从代码与磁盘布局中移除。

---

## 一、存储总览

resume-preview **没有关系型数据库**。持久化完全建立在本地文件系统上：

```
<configDir>/
└── resume-preview/                 ← APP_DIR
    ├── resumes/                    ← RESUMES_DIR：简历工作区（DB 层）
    │   └── <slug>/                 ← 一个目录 = 一条 RESUME 记录
    │       ├── resume.json         ← 简历内容（结构化，事实来源）
    │       ├── options.json        ← 渲染选项（template / theme / locale）
    │       ├── resume.html         ← 渲染产物：预览页内容（实时预览用）
    │       ├── resume.export.html  ← 渲染产物：独立 HTML 导出（按需）
    │       └── resume.pdf          ← 渲染产物：PDF（按需）
    └── logs/                       ← LOGS_DIR
        ├── mcp.log                 ← MCP 工具调用日志
        └── web.log                 ← HTTP / WebSocket 日志
```

**`configDir` 的解析顺序**（`src/file-utils.ts` `getConfigDir()`）：

1. `$XDG_CONFIG_HOME`（非空）
2. `$HOME` 或 `$USERPROFILE` → `<home>/.config`
3. `os.tmpdir()` 兜底

即 `<resumeDir> = $XDG_CONFIG_HOME/resume-preview/resumes`（已设置时），
否则为 `<home>/.config/resume-preview/resumes`。

Windows 上实际路径为 `C:\Users\<user>\.config\resume-preview\`
（Windows 无 `$XDG_CONFIG_HOME` 概念，因此回落到 `$USERPROFILE/.config`）。

> **注意**：Windows 上 `.config` 目录名直接沿用 POSIX 惯例，
> 与 `%APPDATA%` 无关 —— 这是刻意保持跨平台一致，不是 bug。

> **历史遗留**：项目原名 `claude-mermaid`，旧的 `~/.config/claude-mermaid/` 目录在启动时
> 由 `migrateLegacyAppDir()` 改名或合并到新目录（同名文件以新目录为准）。
> 迁移逻辑**不抛异常**，失败只告警。
> 其中旧的 `live/` 子目录（图工作区）随图能力下线后**不再被读取**，也不会被清理。

---

## 二、DB 层：RESUME 聚合

### 2.1 聚合根：RESUME

一个 `resume_id` 对应 `resumes/` 下的一个目录，是本模型的**聚合根**。

| 属性          | 类型   | 约束                                              | 来源 / 说明                  |
| ------------- | ------ | ------------------------------------------------- | ---------------------------- |
| `resume_id`   | string | **业务主键**，非空、≤200 字符，**可含中文**       | 由调用方提供；可读、可展示   |
| `slug`        | string | **存储主键**，`/^[a-zA-Z0-9_-]+$/`，目录名 = slug | `slugifyResumeId(resume_id)` |
| `template`    | string | `RESUME_TEMPLATES` 白名单（当前仅 `default`）     | `options.json` 的 `template` |
| `theme`       | string | `RESUME_THEMES` 白名单（当前仅 `default`）        | `options.json` 的 `theme`    |
| `locale`      | string | `SUPPORTED_LOCALES` 白名单（`zh-CN` / `en`）      | `options.json` 的 `locale`   |
| `modified_at` | Date   | —                                                 | 渲染产物的 `fs.stat().mtime` |
| `size_bytes`  | number | —                                                 | 渲染产物的字节数             |

**双主键的关系**：`resume_id` 是**业务主键**（用户识别与展示用），
`slug` 是**存储主键**（目录名与 URL 路径段）。两者解耦带来的好处是：
`resume_id` 可以是任意可读文本（含中文），而落盘路径仍然严格受
`PREVIEW_ID_REGEX` 约束 —— **不需要放宽路径穿越防线**。

**slug 算法**（`slugifyResumeId()`）：

```
若 resume_id 已匹配 /^[a-zA-Z0-9_-]+$/  →  原样返回
否则  →  剥离非 ASCII 骨架（连续 "-" 折叠、限长 32）+ "-" + sha256 前 6 位
```

例：`frontend-senior` → `frontend-senior`；`小王的简历` → `r-3f9a2b`。

> 哈希后缀保证不同的中文 id 不会因 ASCII 骨架相同而碰撞。
> `slugifyResumeId()` 是**幂等**的 —— 对一个已生成的 slug 再调用一次结果不变，
> 因此"用 `resume_id` 查目录"和"用 URL 里的 slug 查目录"落到同一个目录。

### 2.2 实体：RESUME_CONTENT（1:1）

| 属性        | 类型   | 说明                       |
| ----------- | ------ | -------------------------- |
| `file_name` | string | 固定为 `resume.json`       |
| `version`   | number | 内容模型版本号，当前为 `1` |
| `content`   | object | 简历内容（见下）           |

**内容模型**（`src/types.ts` 的 `ResumeContent`）：

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
  "summary": "8 年前端经验…",
  "experience": [
    {
      "company": "…",
      "title": "…",
      "start": "…",
      "end": "…",
      "location": "…",
      "highlights": ["…"],
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

> 简历的内容是**结构化对象**。这带来两条建模要求：
> ① `version` 字段用于未来内容模型演进（当前 `RESUME_CONTENT_VERSION = 1`）；
> ② 校验只做**结构性**的（必须是对象、≤1MB），字段级强校验会让 AI 客户端频繁撞墙。

### 2.3 实体：RESUME_OPTIONS（1:1）

| 属性       | 类型   | 默认值    | 约束                      |
| ---------- | ------ | --------- | ------------------------- |
| `template` | string | `default` | `RESUME_TEMPLATES` 白名单 |
| `theme`    | string | `default` | `RESUME_THEMES` 白名单    |

```json
{
  "template": "default",
  "theme": "default"
}
```

> **不持久化 `format`** —— 导出格式是每次调用 `resume_export` 的参数，不是简历的属性。
> 列表 API 也不暴露 `format`，因此不存在「按顺序探测文件」的建模缺口。

### 2.4 实体：RESUME_ARTIFACT（1:N）

| 属性          | 类型   | 说明                                                  |
| ------------- | ------ | ----------------------------------------------------- |
| `file_name`   | string | `resume.html` \| `resume.export.html` \| `resume.pdf` |
| `kind`        | string | `html` \| `exportHtml` \| `pdf`                       |
| `modified_at` | Date   | 文件 `mtime`                                          |
| `size_bytes`  | number | 文件字节数                                            |

**产生方式**（`src/resume-renderer.ts`）：

1. 内容模型 → 套简历模板 → HTML；
2. 预览模式 → 写 `resume.html`；导出模式 → 写 `resume.export.html`；
3. PDF 模式 → Chromium 打印 → 写 `resume.pdf`。

**格式与实时预览的关系**：

| kind         | 何时产生                     | 实时预览                           |
| ------------ | ---------------------------- | ---------------------------------- |
| `html`       | 每次 `resume_preview`        | ✅ 监听该文件，变化即推送 `reload` |
| `exportHtml` | `resume_export(format=html)` | ❌                                 |
| `pdf`        | `resume_export(format=pdf)`  | ❌                                 |

> ⚠️ **`resume.html` 与 `resume.export.html` 不可混用**：
> 前者是预览页的**内嵌内容**（没有 `<head>`/`<style>`），
> 后者是**独立文件**（可直接双击打开）。两者由同一套模板的两种模式产出，不是两份独立模板。

> ⚠️ **导出绝不能写 `resume.html`** —— 那个文件正被 `fs.watch` 监听，
> 改动它会误触发一次浏览器 reload。

### 2.5 生命周期与不变量

```
resume_preview(id, content)
   ├─ validate + normalize content          （对象或 JSON 字符串，≤1MB）
   ├─ slug = slugifyResumeId(id)
   ├─ mkdir  resumes/<slug>/                （递归创建，幂等）
   ├─ write  resumes/<slug>/resume.json     （含 version）
   ├─ write  resumes/<slug>/options.json    （template / theme / locale）
   ├─ invalidateResumeArtifacts()           （丢弃旧的导出产物）
   ├─ render → resumes/<slug>/resume.html
   └─ ensureLiveServer()
        ├─ addLiveSession(slug, <html 路径>, "resume")   （fs.watch + 内存登记）
        └─ if !hasActiveConnections(slug, "resume"): 打开浏览器
```

**不变量**

1. `resumes/<slug>/` 下的 `resume.json` 与 `options.json` 总是**成对存在**。
2. `resume.html` 是**派生物**，可随时由 `resume.json` + `options.json` 重建。
3. 目录名 == slug；**slug ↔ resume_id 是多对一可能的**（两个 id 若 slug 相同会共用目录，
   但由于 slug 带 id 的哈希，同一 slug 必然对应同一个 id）。
4. 删除是**整目录删除**，用 `rm(dir, {recursive:true, force:true})` ——
   不会因子目录抛错。

---

## 三、内存态：LIVE_SESSION

不属于 DB 层，但与 DB 层强耦合，需一并理解。

| 属性          | 类型             | 说明                              |
| ------------- | ---------------- | --------------------------------- |
| `session_key` | string           | 内存 Map 的键，**带命名空间前缀** |
| `file_path`   | string           | 被 `fs.watch` 监听的文件路径      |
| `watcher`     | `fs.FSWatcher`   | 文件监听句柄                      |
| `clients`     | `Set<WebSocket>` | 已连接的浏览器客户端              |

**存储位置**：`src/live-server.ts` 的模块级 `const liveSessions = new Map<string, LiveSessionState>()`。

**会话键的命名空间**：

```
resume:{slug}            简历的实时预览会话
```

> 命名空间前缀由 `SESSION_NAMESPACES.RESUME`（`src/constants.ts`）定义。
> 图能力下线后 `diagram:` 命名空间已随之移除，当前只有简历一种会话。

**生命周期**

| 事件                           | 行为                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `resume_preview`               | `addLiveSession()` —— 若已存在则**复用** `clients` 集合、关闭旧 watcher、装新 watcher |
| 文件 `change` 事件             | `notifyClients()` —— 向所有 `readyState === OPEN` 的客户端发送 `"reload"`             |
| 文件 `rename` 事件且文件已消失 | `removeLiveSession()` —— 关闭 watcher、断开客户端、从 Map 移除                        |
| watcher `error` 事件           | 记 `warn` 日志；文件已消失时同样 `removeLiveSession()`                                |
| `DELETE /api/resumes/:id`      | 删除目录 → 文件消失 → 触发上面的 `rename`/`error` 路径 → 会话结束                     |
| `closeLiveServer()`            | 关闭全部 watcher 与 WS 服务                                                           |

**与 DB 层的关系**：`LIVE_SESSION` 是**可丢失**的。
进程重启后 Map 为空，但 `resumes/` 目录仍在 ——
`--serve` 模式（`registerExistingResumes()` 扫描 `resumes/` 并重新注册已有 `resume.html` 的简历）
存在的原因就是补上这段会话。

> ⚠️ **内存态与磁盘态可能不一致**：`removeLiveSession()` 只清内存，
> 不删磁盘文件；反之 `DELETE` 删了磁盘文件，内存清理要**异步**依赖 fs 事件回调。
> 在事件到达前，`hasActiveConnections()` 仍可能返回 `true`，
> 导致下一次 `resume_preview` 误判"浏览器已打开"而不新开标签页。

> ⚠️ **历史上这里有一个高危缺陷（已修复）**：
> `fs.watch` 返回的 `FSWatcher` 原本**没有 `error` 监听器**。
> 被监听的文件被删除时，Node 会抛出 `EPERM: operation not permitted, watch`，
> 由于没有监听器，这个 `error` 事件被视为未处理事件，**直接终止整个 Node 进程**。
> 修复见 `src/live-server.ts` 的 `addLiveSession()`（加 `error` 监听 + `removeLiveSession()`），
> 回归测试见 `test/live-server/regressions.test.ts`。

---

## 四、视图与传输对象

这些类型**不持久化**，只在内存与网络边界上存在。

### 4.1 DB 层 → API 层

| 类型         | 定义位置       | 字段                                                 | 用途                      |
| ------------ | -------------- | ---------------------------------------------------- | ------------------------- |
| `ResumeInfo` | `src/types.ts` | `id`, `template`, `theme`, `modifiedAt`, `sizeBytes` | `GET /api/resumes` 的元素 |

`GET /api/resumes` 的响应体手写为 `{ resumes: ResumeInfo[], count: number }`，
`types.ts` 中没有对应的包装类型 —— 新增类型**必须真的被引用**，不要制造死类型。

### 4.2 命令对象

| 类型                  | 定义位置            | 字段                                                                | 用途                              |
| --------------------- | ------------------- | ------------------------------------------------------------------- | --------------------------------- |
| `ResumeContent`       | `src/types.ts`      | 见 §2.2                                                             | 简历内容模型                      |
| `ResumeOptions`       | `src/types.ts`      | `template`, `theme`, `locale`                                       | `options.json` 的内容             |
| `ResumeRenderOptions` | `src/types.ts`      | `ResumeOptions` + `content`, `resumeId`                             | 传给 `resume-renderer` 的渲染参数 |
| `ResumeFormat`        | `src/constants.ts`  | `"pdf"` \| `"html"`                                                 | 由 `RESUME_FORMATS` 推导的类型    |
| `ResumeFileKind`      | `src/file-utils.ts` | `"content"` \| `"options"` \| `"html"` \| `"exportHtml"` \| `"pdf"` | 工作区内的文件类别                |

### 4.3 MCP 工具入参

MCP 工具的入参在 `src/index.ts` 中以 **JSON Schema** 声明（`TOOL_DEFINITIONS`），
**不是** TypeScript interface。因此 `handlers.ts` 中：

```ts
export async function handleResumePreview(args: any); // ← 无类型约束
export async function handleResumeExport(args: any); // ← 无类型约束
```

`args` 的形状由 JSON Schema 在运行时保证，而非编译期。

`resume_preview` 的 `content` 参数在 Schema 中声明为 `object | string`（两种形态都收），
由 `normalizeResumeContent()` 在运行时归一为 `ResumeContent`。

---

## 五、关系汇总

| 关系                     | 基数   | 实现方式                             | 删除级联                                             |
| ------------------------ | ------ | ------------------------------------ | ---------------------------------------------------- |
| RESUME → RESUME_CONTENT  | 1:1    | 同目录下的 `resume.json`             | 目录删除时一并删除                                   |
| RESUME → RESUME_OPTIONS  | 1:1    | 同目录下的 `options.json`            | 同上                                                 |
| RESUME → RESUME_ARTIFACT | 1:N    | 同目录下的 `resume.*`                | 同上                                                 |
| RESUME → LIVE_SESSION    | 1:0..1 | 内存 Map，键为 `resume:{slug}`       | **无级联**：磁盘删除不自动清内存，靠 fs 事件异步清理 |
| MCP_TOOL_CALL → RESUME   | N:1    | 通过 `resume_id` 关联（落盘用 slug） | 无                                                   |

---

## 六、跨层一致性检查清单

修改数据模型相关代码时，逐条核对：

- [ ] 新增/修改 HTTP 路由 → 同步 `src/constants.ts` 的 `ROUTES` / `RESUME_ROUTES` 与 `src/routes.ts` 的 `ROUTE_CONFIG`
- [ ] 新增模板变量 → 同步 `TEMPLATE_VARS`（`src/constants.ts`）与对应 `.html` 模板
- [ ] 新增静态资源 → 同步 `ASSET_FILES`（`src/constants.ts`）与 `ROUTE_CONFIG`
- [ ] 修改 slug 校验规则 → 同步 `PREVIEW_ID_REGEX`（`src/constants.ts`）与相关测试
- [ ] 修改目录布局 → 同步 `FILE_NAMES` / `DIR_NAMES`（`src/constants.ts`）与 `file-utils.ts` 的路径函数
- [ ] 新增简历产物格式 → 同步 `RESUME_FORMATS`（`src/constants.ts`）与 `ResumeFileKind`（`src/file-utils.ts`）
- [ ] 新增简历内容字段 → 同步 `ResumeContent`（`src/types.ts`）与渲染器的字段处理
- [ ] 修改 `resume_id` 校验或 slug 规则 → 同步 `slugifyResumeId()`（`src/file-utils.ts`）与相关测试
- [ ] 新增简历会话 → 同步 `SESSION_NAMESPACES`（`src/constants.ts`）与 live server 的键构造
- [ ] 修改内容模型结构 → 评估是否需要提升 `RESUME_CONTENT_VERSION` 并写迁移
