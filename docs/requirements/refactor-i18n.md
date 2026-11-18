# 页面国际化（i18n）改造 — 技术需求文档（refactor-i18n）

> ## 一句话总结
>
> **让页面显示支持中文与英文：界面文案（画廊页 / 预览页工具栏）随请求语言切换，简历正文语言（分节标题、导出 PDF / 独立 HTML）随简历自身存储的 locale 决定。**

> **状态**：需求已定稿（双轴 locale 设计、默认语言、工具参数暴露三项均已确认），**并已实现**（v3.1.0）。
> **版本**：r1.1
> **基线代码**：resume-preview v3.0.0（`package.json`），分支 `main`。
> **依据**：[`docs/api-list.md`](../api-list.md) · [`docs/data-model.md`](../data-model.md) · [`CLAUDE.md`](../../CLAUDE.md) · `src/` 全量源码。
> **文档性质**：本文档是**需求与技术约定**，不是实现设计；文中「约束」条目对实现有强制力。
>
> **实现回填**：能力已全部落地。逐条差异见 §9，其中 3 处与本文表述不同：
> ① 字典接口 `/i18n/:locale.json` 返回的是**合并后**的字典（英文垫底），
> 不是磁盘上的原始文件 —— 浏览器少写一次回退逻辑；
> ② 模板里的文案占位符用 `{{i18n:some.key}}` 这一种语法，
> 而不是给每条文案都加一个模板变量；
> ③ `i18n.js` 由 `renderPage()` 注入 `{{PAGE_SCRIPTS}}`，
> 画廊模板不再硬写 `<script src="gallery.js">`。

### 修订记录

| 版本     | 变更                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------- |
| **r1.0** | **定稿**：locale 双轴设计（界面语言 / 简历语言分离）、默认 `zh-CN`、`resume_preview` 暴露 `locale` 参数 |
| **r1.1** | **实现回填**：能力已全部落地（v3.1.0）；差异记录见 §9                                                   |

> 全文标记：
> **【约束】** 对实现有强制力 · **【决策】** 见 §8 的决策记录 · **【代码】** 已从 `src/` 反推的既有行为。

---

## 0. 文档导航

| 章节                                           | 内容                                       |
| ---------------------------------------------- | ------------------------------------------ |
| [1. 业务目标](#1-业务目标)                     | 范围、验收标准                             |
| [2. locale 双轴模型](#2-locale-双轴模型)       | 两个 locale 的职责边界与来源               |
| [3. 接口契约](#3-接口契约)                     | 字典格式、locale 解析规则、HTTP / MCP 契约 |
| [4. 改造点清单](#4-改造点清单)                 | 按层拆分的改造点                           |
| [5. 边界场景](#5-边界场景)                     | 场景 · 预期行为 · 依据                     |
| [6. 风险与强制约束](#6-风险与强制约束)         | 实现时必须遵守的红线                       |
| [7. 不在这次范围里的事](#7-不在这次范围里的事) | 明确排除的事项                             |
| [8. 决策记录](#8-决策记录)                     | 已确认的全部决策                           |
| [9. 实现回填差异](#9-实现回填差异)             | 实现与本文的出入、验证情况                 |
| [附](#附代码落点)                              | 实现落点提示                               |

---

## 1. 业务目标

### 1.1 要解决的问题

当前页面显示是**中英混杂**的：

| 区域                                               | 现状                                |
| -------------------------------------------------- | ----------------------------------- |
| 画廊页（`gallery.html` / `gallery.js`）            | 英文                                |
| 预览页工具栏（`resume-renderer.ts` / `resume.js`） | 英文                                |
| **简历正文分节标题**（`resume-renderer.ts`）       | **硬编码中文**                      |
| 技能项分隔符                                       | 硬编码中文顿号 `、`                 |
| `<html lang>`                                      | 画廊页写死 `en`，预览页写死 `zh-CN` |

后果：

1. 中文用户看到英文界面；英文用户看到中文界面。
2. **导出的 PDF / 独立 HTML 永远是中文标题** —— 分节标题在服务端硬编码，与浏览器语言无关。
3. `<html lang>` 写死，屏幕阅读器与浏览器翻译功能判断错误。

### 1.2 范围

**做**：

- 界面文案（画廊页、预览页工具栏、状态提示、对话框）支持 `zh-CN` 与 `en`。
- 简历正文语言（分节标题、文档标题、占位姓名、技能分隔符）支持 `zh-CN` 与 `en`。
- 语言切换器（切换界面语言）。
- `resume_preview` 暴露 `locale` 参数，使 AI 客户端可按投递目标语言出简历。
- 导出产物（PDF / 独立 HTML）的语言**只由简历自身的 locale 决定**。

**不做**：见 §7。

### 1.3 验收标准

| #   | 验收项                                                                         | 判定方式                                        |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------- |
| A1  | `?lang=en` 访问画廊页，标题、按钮、空态、导航、页脚全英文                      | 浏览器检查 + 快照                               |
| A2  | `?lang=zh-CN`（或缺省）访问画廊页，同上全中文                                  | 同上                                            |
| A3  | 预览页工具栏（状态、缩放、导出菜单）随 `?lang` 切换                            | 同上                                            |
| A4  | 运行时文案（数量、相对时间、删除确认、加载失败、连接状态、导出报错）随语言切换 | 同上                                            |
| A5  | 简历正文分节标题随简历 locale 变化；导出 PDF / HTML 与之一致                   | 导出 PDF 目视检查 + 断言                        |
| A6  | 导出语言**不受** `Accept-Language` 影响                                        | 用不同 `Accept-Language` 导出两次，产物字节一致 |
| A7  | 语言切换器可切换，且切换后当前路径与查询参数（除 `lang`）保留                  | 浏览器检查                                      |
| A8  | 两个字典的 key 集合完全一致                                                    | 单元测试断言（CI 失败即阻断）                   |
| A9  | 未知 `lang` / 未知 locale 路径参数安全回退，不产生路径穿越                     | 单元测试 + 手工请求 `/i18n/../../etc/passwd`    |

---

## 2. locale 双轴模型

### 2.1 两个 locale

|                | 界面语言（UI locale）              | 简历语言（resume locale）                      |
| -------------- | ---------------------------------- | ---------------------------------------------- |
| **作用域**     | 画廊页、预览页工具栏、状态、对话框 | 简历正文分节标题、文档标题、占位符、技能分隔符 |
| **来源**       | 请求时解析（§3.2）                 | `options.json` 持久化                          |
| **变更方式**   | URL `?lang=` 切换                  | `resume_preview` 的 `locale` 参数              |
| **影响导出吗** | **否**                             | **是**                                         |

### 2.2 【约束】两条轴不得混用

**【约束 R1】导出产物的语言只由简历 locale 决定。**
导出路径（`resume_export` 工具、`/resume/export/:id` HTTP 端点）**不得**读取
`Accept-Language` 或 `?lang`。否则同一份简历在不同浏览器下会导出成不同语言的文档，
失去可复现性。

**【约束 R2】界面 locale 与简历 locale 相互独立。**
界面切到英文，**不改变**简历正文的语言；简历 locale 变了，**不改变**界面文案。
预览页因此允许「中文简历 + 英文工具栏」这种组合。

### 2.3 默认值

| 项                          | 默认值          | 理由                                                           |
| --------------------------- | --------------- | -------------------------------------------------------------- |
| 界面 locale                 | `zh-CN`         | 保持现有正文与主要使用者的语言不变                             |
| 简历 locale                 | `zh-CN`         | 与现有渲染结果一致（现状分节标题就是中文），属于**零行为变更** |
| `htmlLang`（`<html lang>`） | 跟随界面 locale | 只影响浏览器与辅助技术的语言判断                               |

---

## 3. 接口契约

### 3.1 字典

**【约束 R3】字典是单份 JSON，双端共用。**
服务端与浏览器读**同一份文件**，不允许出现两份拷贝（会漂移）。

```
src/preview/i18n/zh-CN.json
src/preview/i18n/en.json
```

放在 `src/preview/` 下是刻意的：`scripts/copy-preview.mjs` 已把 `src/preview/**`
递归拷贝到 `build/preview/**`，**构建脚本不需要改**。

结构（扁平二级命名空间）：

```json
{
  "meta": { "label": "中文", "htmlLang": "zh-CN" },
  "gallery": {
    "title": "简历画廊",
    "subtitle": "浏览并打开你的简历",
    "searchPlaceholder": "按 ID 搜索简历…",
    "loading": "加载中…",
    "count": "{n} 份简历",
    "emptyTitle": "还没有简历",
    "emptyDesc": "用 resume_preview 工具创建一份简历后就会出现在这里",
    "noResultsTitle": "没有匹配的简历",
    "noResultsDesc": "换个搜索词试试",
    "deleteTitle": "删除",
    "deleteConfirm": "确定要删除简历「{id}」吗？",
    "deleteFailed": "删除失败：{message}",
    "loadFailedTitle": "简历列表加载失败",
    "navGallery": "画廊",
    "footerText": "简历预览",
    "pageTitle": "简历画廊 - 简历预览"
  },
  "preview": {
    "statusLive": "实时刷新已开启",
    "statusStatic": "静态视图",
    "statusDisconnected": "连接已断开，正在重连…",
    "statusFailed": "连接失败，刷新页面重试",
    "lastUpdated": "最后更新：{time}",
    "btnBack": "返回",
    "btnZoomIn": "放大",
    "btnZoomOut": "缩小",
    "btnReset": "复位",
    "btnExport": "导出简历",
    "exportPdf": "下载 PDF",
    "exportHtml": "下载 HTML",
    "exportMissingId": "缺少简历标识，请重新渲染简历。",
    "exportFailed": "导出失败：{message}"
  },
  "resume": {
    "sectionSummary": "自我评价",
    "sectionExperience": "工作经历",
    "sectionProjects": "项目经历",
    "sectionEducation": "教育经历",
    "sectionSkills": "专业技能",
    "sectionExtras": "其他",
    "namePlaceholder": "你的名字",
    "docTitle": "简历"
  },
  "common": {
    "switchLanguage": "语言",
    "langZh": "中文",
    "langEn": "English",
    "itemSeparator": "、"
  }
}
```

**【约束 R4】占位符语法固定为 `{name}`**，由取词函数统一替换。
不允许在字典里写 HTML；需要强调的文案用样式，不在文案里塞标签。

**【约束 R5】两个字典的 key 集合必须完全一致**（含嵌套层级）。
不一致由单元测试断言并阻断 CI。

### 3.2 locale 解析规则（界面语言）

**【约束 R6】解析优先级固定为：`?lang=` > `Accept-Language` > 默认 `zh-CN`。**

1. `?lang=` 存在时：必须在白名单内，否则**忽略并继续下探**（不报错、不 400）。
2. `Accept-Language`：按 q 值降序取第一个命中白名单的语言；`en-US` 之类带区域的语言按**前缀**匹配白名单（`en-US` → `en`）。
3. 都没有：默认 `zh-CN`。

**【约束 R7】任何进入文件路径的 locale 字符串必须过白名单。**
`/i18n/:locale.json` 的路径参数**绝不**直接拼进 `join()`。白名单外的值一律 404。

### 3.3 HTTP 契约

#### 3.3.1 新增路由

| 方法 | 路径                 | 说明                                                       |
| ---- | -------------------- | ---------------------------------------------------------- |
| GET  | `/i18n/:locale.json` | 返回该 locale 的字典 JSON。locale 必须在白名单内，否则 404 |

响应头：`Content-Type: application/json`、`Cache-Control: no-store`、
`Content-Security-Policy: <项目统一 CSP>`。

**【约束 R8】该接口只返回字典，不返回任何用户数据。**
字典是服务端常量，无注入面。

#### 3.3.2 既有路由的行为变化

| 路由                      | 变化                                                 |
| ------------------------- | ---------------------------------------------------- |
| `GET /`                   | 按 §3.2 解析界面 locale 渲染；`<html lang>` 随之变化 |
| `GET /resume/:id`（live） | 工具栏按界面 locale；简历正文按简历 locale           |
| `GET /resume/view/:id`    | 同上                                                 |
| `GET /resume/export/:id`  | **不变**（只按简历 locale，见 R1）                   |
| `GET /api/resumes`        | **不变**                                             |

#### 3.3.3 响应头

**【约束 R9】HTML 响应带 `Content-Language: <界面 locale>`。**
`/resume/export/:id` 的响应带的是**简历 locale**（或不带，二选一，但必须与产物语言一致）。

### 3.4 MCP 契约

#### 3.4.1 `resume_preview` 新增参数

```jsonc
"locale": {
  "type": "string",
  "enum": ["zh-CN", "en"],
  "description": "Language of the resume itself — section headings and the exported document (default: zh-CN). Independent of the browser UI language.",
  "default": "zh-CN"
}
```

**【约束 R10】`locale` 是可选参数。**
不传时：沿用该简历已存储的 locale；该简历尚不存在时用默认 `zh-CN`。
**不传 `locale` 不得覆盖**已存储的值 —— 否则每次调用都会把用户设过的语言重置回默认。

**【约束 R11】locale 变更会使已缓存的导出产物失效。**
`resume.html`（live server 监听的对象）会因重渲染而更新 → 触发一次浏览器 reload，属预期行为。
`resume.export.html` / `resume.pdf` 必须被删除并重新渲染，否则导出的还是旧语言。

#### 3.4.2 `resume_export`

**不变。** 导出语言完全由简历 locale 决定，导出工具不接受语言参数。

---

## 4. 改造点清单

### 4.1 新增

| #   | 文件                          | 内容                                                    |
| --- | ----------------------------- | ------------------------------------------------------- |
| N1  | `src/i18n.ts`                 | 服务端取词模块：`resolveLocale` / `getDictionary` / `t` |
| N2  | `src/preview/i18n/zh-CN.json` | 中文字典                                                |
| N3  | `src/preview/i18n/en.json`    | 英文字典                                                |
| N4  | `src/preview/i18n.js`         | 客户端取词模块（暴露 `window.RPI18n`）                  |

### 4.2 修改

| #   | 文件                                     | 改动                                                                                       |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| M1  | `src/constants.ts`                       | `SUPPORTED_LOCALES`、`DEFAULT_UI_LOCALE`、`DEFAULT_RESUME_LOCALE`、`I18N_ROUTES`           |
| M2  | `src/types.ts`                           | `ResumeOptions` 增 `locale`；新增 `Locale` 类型                                            |
| M3  | `src/file-utils.ts`                      | `validateResumeLocale()`；`save/loadResumeOptions` 持久化 locale，缺字段回落默认           |
| M4  | `src/resume-renderer.ts`                 | 分节标题 / 工具栏 / 导出文档取词；技能分隔符按 locale 切换                                 |
| M5  | `src/page-renderer.ts`                   | `renderPage` 接收 locale；`generateNav` / `generateFooter` 取词；新增 `{{LANG}}` 占位符    |
| M6  | `src/routes.ts`                          | `handleGallery` 解析 locale；新增 `/i18n/:locale.json` 路由（白名单校验）                  |
| M7  | `src/live-server.ts`                     | 预览页解析界面 locale；正文 locale 从 `options.json` 读；导出路径不读界面 locale           |
| M8  | `src/preview/gallery.html`               | 静态文案改为服务端注入；`<html lang>` 动态；语言切换器                                     |
| M9  | `src/preview/gallery.js`                 | 数量 / 相对时间 / 删除确认 / 加载失败走 `RPI18n.t`；相对时间改用 `Intl.RelativeTimeFormat` |
| M10 | `src/preview/resume.js`                  | 连接状态 / 导出报错走 `RPI18n.t`                                                           |
| M11 | `src/preview/gallery.css` / `resume.css` | 语言切换器样式                                                                             |
| M12 | `src/index.ts`                           | `TOOL_DEFINITIONS`：`resume_preview` 增 `locale` 参数（**工具定义的唯一真源**）            |
| M13 | `src/handlers.ts`                        | 透传 locale 并落盘；locale 变更时 `invalidateResumeArtifacts`                              |
| M14 | `package.json`                           | `files` 白名单加 `build/**/*.json`；版本号 → 3.1.0                                         |
| M15 | `.claude-plugin/plugin.json`             | 版本号同步 → 3.1.0                                                                         |

### 4.3 文档

| #   | 文件                 | 内容                                                              |
| --- | -------------------- | ----------------------------------------------------------------- |
| D1  | `docs/api-list.md`   | 新增 `/i18n/:locale.json` 路由；`resume_preview` 增 `locale` 参数 |
| D2  | `docs/data-model.md` | `options.json` 增 `locale` 字段                                   |
| D3  | `CLAUDE.md`          | 新增「国际化」约定一节                                            |
| D4  | `README.md`          | 补一句语言支持说明                                                |

---

## 5. 边界场景

| #   | 场景                            | 预期行为                                                         | 依据 |
| --- | ------------------------------- | ---------------------------------------------------------------- | ---- |
| S1  | `?lang=fr`                      | 回落到 `Accept-Language`，再回落到 `zh-CN`；不报错               | R6   |
| S2  | `?lang=../../etc/passwd`        | 忽略该参数；`/i18n/../..` 类路径返回 404                         | R7   |
| S3  | `Accept-Language: en-US`        | 解析为 `en`                                                      | R6   |
| S4  | 浏览器不发 `Accept-Language`    | 用默认 `zh-CN`                                                   | R6   |
| S5  | 旧 `options.json` 无 `locale`   | 读取时回落 `zh-CN`，不报错、不改写文件                           | R10  |
| S6  | `resume_preview` 不传 `locale`  | 沿用已存储值；新简历用 `zh-CN`                                   | R10  |
| S7  | `resume_preview` 传新 `locale`  | `resume.html` 重渲染 + 缓存导出产物失效 + 浏览器 reload          | R11  |
| S8  | 切换界面语言后导出              | 导出语言**不变**（仍为简历 locale）                              | R1   |
| S9  | 字典缺 key                      | 取词函数回落**英文**（en 为兜底语言），不显示原始 key            | R5   |
| S10 | 客户端字典 fetch 失败           | 界面静态文案（服务端已渲染）不受影响；运行时文案回落服务端渲染值 | —    |
| S11 | 简历正文为中文但 locale 为 `en` | 分节标题英文、正文中文；PDF 需 CJK 字体，检测逻辑不变            | —    |

---

## 6. 风险与强制约束

### 6.1 风险

| #   | 风险                    | 缓解                                                          |
| --- | ----------------------- | ------------------------------------------------------------- |
| K1  | 中英字典 key 漂移       | 单元测试断言 key 集合一致，CI 阻断（R5）                      |
| K2  | 导出结果不可复现        | 导出路径不读请求头（R1）                                      |
| K3  | locale 参数引发路径穿越 | 白名单校验（R7）                                              |
| K4  | 内联脚本被 CSP 拦截     | 字典走同源 `fetch` 接口；CSP 不放开 `unsafe-inline`           |
| K5  | 引入 XSS                | 字典是服务端常量；用户内容插值仍走 `escapeHtml`，不借改造破例 |
| K6  | 客户端取词引入闪烁      | 静态文案由服务端渲染，客户端只管运行时文案                    |
| K7  | 英文复数规则手写易错    | 相对时间改用 `Intl.RelativeTimeFormat`，由运行时处理复数      |

### 6.2 与既有项目约束的关系

| 既有约束（`CLAUDE.md`）                        | 本次的关系                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| CSP `default-src 'none'` + `script-src 'self'` | **不放宽**。字典走同源 JSON 接口，不内联脚本                                    |
| 简历正文一律纯文本渲染并转义                   | **不放宽**。i18n 不引入任何富文本通道                                           |
| 简历内容只做结构性校验，不做字段级强校验       | locale 是**渲染参数**不是内容字段，走白名单校验                                 |
| 常量集中                                       | locale 白名单、默认值、路由前缀一律进 `constants.ts`                            |
| 导出时绝不能写被监听的文件                     | locale 变更重写的是 `resume.html`（被监听，本就该重写）；导出产物是另外两个文件 |
| 模板/主题白名单只有 `default`                  | locale 白名单同理，只有 `zh-CN` / `en`                                          |
| 改代码后同步文档                               | 见 §4.3                                                                         |

---

## 7. 不在这次范围里的事

| 事项                               | 原因                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 预览页实时切换**简历正文**语言     | `resume.html` 是预渲染产物，实时换正文语言需 live server 改为从 `resume.json` 现场重渲，改动面大，另议 |
| 引入 i18n 框架（i18next 等）       | 只有两种语言、两处调用点，自建 30 行取词函数足够                                                       |
| 更多语言（ja / ko 等）             | 本期只定 `zh-CN` / `en`；加语言只需加一份字典 + 白名单一项                                             |
| 简历**内容**的翻译（用户写的文案） | 属于内容范畴，工具不碰；见 §1.2                                                                        |
| 前端框架化                         | 现是原生 HTML/CSS/JS，无框架依赖                                                                       |

---

## 8. 决策记录

| #   | 决策                                      | 理由                                                       | 状态   |
| --- | ----------------------------------------- | ---------------------------------------------------------- | ------ |
| D1  | **locale 分双轴**：界面语言与简历语言分离 | 导出确定性（R1）+ 中英自由组合；代价是预览页切语言不换正文 | 已确认 |
| D2  | 默认语言 `zh-CN`                          | 保持现有渲染结果不变，属于零行为变更                       | 已确认 |
| D3  | `resume_preview` 暴露 `locale` 参数       | AI 客户端可按投递目标语言出简历；不传则沿用已存储值（R10） | 已确认 |
| D4  | 字典用单份 JSON、服务端与浏览器共用       | 避免两份拷贝漂移（R3）；用测试守住 key 对齐（R5）          | 已确认 |
| D5  | 字典放 `src/preview/i18n/`                | 复用既有 `copy-preview.mjs` 的递归拷贝，构建脚本零改动     | 已确认 |
| D6  | 语言切换走 `?lang=` + 整页刷新            | 与服务端渲染机制天然一致，零前端状态管理                   | 已确认 |
| D7  | 相对时间用 `Intl.RelativeTimeFormat`      | 复数规则由运行时处理，字典不写「hour(s)」这类文案          | 已确认 |
| D8  | 界面语言白名单外一律忽略并回落            | 不因一个 query 参数让页面 400                              | 已确认 |

---

## 附：代码落点

```
src/
├── constants.ts                 ← M1 locale 白名单 / 默认值 / 路由前缀
├── i18n.ts                      ← N1 服务端取词模块（新增）
├── types.ts                     ← M2 ResumeOptions.locale
├── file-utils.ts                ← M3 validateResumeLocale / options 持久化
├── resume-renderer.ts           ← M4 分节标题 / 工具栏 / 导出取词
├── page-renderer.ts             ← M5 页面壳取词
├── routes.ts                    ← M6 /i18n/:locale.json + 画廊 locale
├── live-server.ts               ← M7 预览页 locale 解析
├── handlers.ts                  ← M13 locale 落盘 + 产物失效
├── index.ts                     ← M12 TOOL_DEFINITIONS
└── preview/
    ├── i18n.js                  ← N4 客户端取词模块（新增）
    ├── i18n/
    │   ├── zh-CN.json           ← N2（新增）
    │   └── en.json              ← N3（新增）
    ├── gallery.html             ← M8
    ├── gallery.js               ← M9
    ├── resume.js                ← M10
    ├── gallery.css / resume.css ← M11
    └── resume-template.html     ← `<html lang>` 由 M5 注入
```

---

## 9. 实现回填差异

实现完成后与本文表述的出入，均为**有意为之**，需求本身未被推翻。

| #   | 本文表述                   | 实现                                                   | 原因                                                       |
| --- | -------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | §3.3.1「该接口只返回字典」 | 返回**合并后**的字典（英文垫底），不是磁盘上的原始文件 | 浏览器少写一次回退逻辑，服务端与浏览器取到的内容完全一致   |
| 2   | §4.1 未规定模板占位符写法  | 模板用 `{{i18n:some.key}}` 取词                        | 给每条文案加一个模板变量会让 `constants.ts` 与类型跟着膨胀 |
| 3   | §4.1 N4 客户端取词模块     | `i18n.js` 由 `renderPage()` 注入 `{{PAGE_SCRIPTS}}`    | 画廊模板不再硬写 `<script src="gallery.js">`，脚本顺序统一 |

### 验证情况

| 验收项                             | 状态                                      |
| ---------------------------------- | ----------------------------------------- |
| A1–A4 界面文案随语言切换           | ✅ 单元测试 + 端到端脚本覆盖              |
| A5 分节标题与导出一致              | ✅ `test/resume-renderer.test.ts`         |
| A6 导出不受 `Accept-Language` 影响 | ✅ 端到端脚本对比两次导出字节一致         |
| A7 切换器保留路径与查询参数        | ✅ 服务端渲染链接 + 客户端补全其余参数    |
| A8 两个字典 key 集合一致           | ✅ `test/i18n.test.ts` 断言               |
| A9 未知 locale 安全回退            | ✅ `test/i18n.test.ts` 断言（含路径穿越） |
