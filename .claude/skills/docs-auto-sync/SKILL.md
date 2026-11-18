---
name: docs-auto-sync
description: 检查代码改动是否让 docs/ 下的技术文档过期，并报告需要更新的地方。当用户修改了 src/ 或 test/ 下的代码、修改了 MCP 工具定义、HTTP 路由、常量、数据模型或对外接口后，希望确认文档是否仍然准确时使用。只读检查并报告，不自动修改任何文件。
allowed-tools: Read, Grep
---

# 文档自动同步检查

在代码改动后，找出 `docs/` 下**已经过期**的技术文档，并给出精确到行的修改建议。

**核心原则：只报告，不修改。** 本技能是只读的 —— 它使用 `Read` 和 `Grep`，不使用 `Edit`/`Write`/`Bash`。
发现问题后，把结论告诉用户，由用户决定是否修改。

---

## 何时使用

- 刚改完 `src/` 下的代码，想确认文档是否还准确
- 修改了 MCP 工具的入参、HTTP 路由、常量、校验规则或数据模型
- 合并 PR 前，想确认没有留下过期的文档
- 定期巡检文档与代码的一致性

---

## 受检文档

| 文档                             | 覆盖的内容                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `docs/api-list.md`               | MCP 工具、HTTP 接口、WebSocket、内部函数、已知问题                           |
| `docs/data-model.md`             | 存储布局、数据实体、内存态、类型、关系                                       |
| `assets/architecture.svg`        | 分层架构图（源文件 `docs/diagrams/architecture.mmd`）                        |
| `assets/architecture.readme.svg` | 架构图的 README 专用横向版（源文件 `docs/diagrams/architecture.readme.mmd`） |
| `assets/module-deps.svg`         | 模块依赖与循环依赖（源文件 `docs/diagrams/module-deps.mmd`）                 |
| `assets/external-deps.svg`       | 外部依赖（源文件 `docs/diagrams/external-deps.mmd`）                         |
| `assets/data-model-er.svg`       | ER 图（源文件 `docs/diagrams/data-model-er.mmd`）                            |
| `CLAUDE.md`                      | 项目速查（定位/架构/模块/约定/怎么跑）                                       |
| `README.md`                      | 中文版主文档（**默认展示的那一份**）                                         |
| `README.en.md`                   | 英文版主文档                                                                 |
| `docs/index.html`                | 官网落地页（**单文件双语**，按浏览器语言切换）                               |
| `docs/index.md`                  | 官网的中文 markdown 版（给 agent 读）                                        |
| `docs/index.en.md`               | 官网的英文 markdown 版                                                       |

---

## 步骤

### 第 1 步：确定改动范围

先问清（或从上下文推断）本次改了哪些文件。用 `Grep` 确认改动落在哪些区域：

- `src/constants.ts` → 影响面最大（路由、格式、默认值、正则、文件名）
- `src/index.ts` → MCP 工具定义（**工具契约**）
- `src/handlers.ts` → 工具行为与副作用
- `src/routes.ts` / `src/live-server.ts` → HTTP 路由与响应
- `src/file-utils.ts` → 校验规则与路径布局
- `src/types.ts` → 数据模型
- `src/resume-service.ts` → 业务查询与删除语义
- `src/preview/` → 前端行为（WebSocket、导出、画廊页）
- `package.json` → 依赖变化（影响 external-deps 图）

若不确定，就按全量检查（把所有检查项跑一遍）。

### 第 2 步：逐项核对 MCP 工具契约

改动涉及 `src/index.ts` 或 `src/handlers.ts` 时执行。

1. `Read` `src/index.ts`，找到 `TOOL_DEFINITIONS`。
2. 对每个工具，列出：**名称、必填参数、参数类型、默认值、枚举取值**。
3. `Read` `docs/api-list.md` 的「一、MCP 工具接口（对外）」一节。
4. 逐字段对比。**任何一项对不上就是一处过期**。

同时核对**副作用描述**：

- 是否仍写入 `resume.json` + `options.json`
- 是否仍写入 `resume.html`，导出产物是否仍走 `resume.export.html` / `resume.pdf` 缓存
- 首次渲染开浏览器、后续复用标签页的行为是否还在
- 导出产物是否仍按内容变更自动失效（`isResumeArtifactStale`）

### 第 3 步：逐项核对 HTTP 接口

改动涉及 `src/routes.ts`、`src/live-server.ts`、`src/constants.ts` 时执行。

1. `Grep` 出所有路由常量：`ROUTES`、`ROUTE_CONFIG`、`matchRoute`。
2. 同时找出 `src/live-server.ts` 里**内联实现**的遗留路由
   （它们不在路由表里，容易漏掉 —— 重点查 `url ===` 与 `url.startsWith(` 的分支）。
3. `Read` `docs/api-list.md` 的「二、HTTP 接口（对外）」，核对：
   - 路径、方法、状态码、内容类型
   - 响应体字段名
   - 错误响应的格式与文案
4. **特别注意两套并存的错误体格式**：路由表里的 JSON `{error, message}`
   与内联路由的纯文本。改了一处要确认另一处的描述是否还准确。

### 第 4 步：核对数据模型

改动涉及 `src/types.ts`、`src/file-utils.ts`、`src/resume-service.ts` 时执行。

1. `Read` `src/types.ts`，列出所有接口及其字段。
2. `Read` `src/file-utils.ts`，确认路径布局与文件名常量。
3. `Read` `docs/data-model.md`，核对：
   - 存储目录树与实际路径解析顺序
   - 每个实体的字段、类型、默认值
   - `ResumeOptions` 是否仍只有 `template` + `theme`
   - 实体间基数（1:1 / 1:N / 1:0..1）
   - 「跨层一致性检查清单」里的每一条是否仍成立
4. 若实体或字段有增减，同步检查 `assets/data-model-er.svg`
   的源文件 `docs/diagrams/data-model-er.mmd` 是否需要改。

### 第 5 步：核对图与代码是否还一致

图不会自动更新，必须显式检查。

1. **模块依赖图**（`docs/diagrams/module-deps.mmd`）：
   用 `Grep` 扫 `src/*.ts` 里的 `from "./..."` import 语句，
   得到真实依赖图，与图中的连线比对。**新增的循环依赖必须标红**。
   图能力下线后项目已无循环依赖，`handlers.ts → live-server.ts` 是单向的。
2. **架构图**（`docs/diagrams/architecture.mmd`）：
   新增/删除/改名模块时，节点与一句话职责要同步。
3. **外部依赖图**（`docs/diagrams/external-deps.mmd`）：
   `package.json` 的 `dependencies` / `devDependencies` / `overrides` 变化时同步。
   注意 `overrides` 块里的传递依赖（如 `puppeteer`）也画在图上。
4. **ER 图**（`docs/diagrams/data-model-er.mmd`）：
   实体或字段变化时同步。

### 第 6 步：核对 CLAUDE.md

`CLAUDE.md` 里的速查信息是否还成立：

- 端口范围、绑定地址
- `resume_id` 正则与 slug 派生规则
- 支持的导出格式、模板与主题列表
- 存储路径解析顺序
- 模块职责一句话
- 命令清单与 CI 配置
- 「关键约定」里的每一条断言

### 第 7 步：核对双语文档

项目里有两组双语文档，改功能说明时**都要同步**，漏改一份就是一处过期。

#### 7.1 README

`README.md`（中文，默认展示）与 `README.en.md`（英文）是**同一份文档的两种语言**，
章节一一对应。

1. `Grep` 出两份文件的标题结构（`^#{1,3} `），确认章节一一对应、顺序一致。
2. 比对两份文件里的**行内代码、链接、URL**：这些是技术标识，不该因翻译而缺失或改名。
   用 `Grep` 抽出 `` `...` ``、`](...)`、`https?://...` 三类，分别对照。
3. 比对**围栏代码块**：JSON、bash、配置片段必须逐字节一致；
   只有块内的**注释与示例文案**允许因语言不同而不同。
4. 确认两份顶部的语言切换链接都存在且指向对方
   （`README.md` → `README.en.md`，`README.en.md` → `README.md`）。

#### 7.2 官网（docs/）

`docs/index.html` 是**单文件双语**：页面结构只写一份，可翻译的文本写成
`<span lang="zh-CN">…</span><span lang="en">…</span>` 两个兄弟 span，
由 CSS 按 `<html lang>` 决定显示哪一个。语言解析顺序与产品一致：
`?lang=` > `navigator.languages` > 默认 `zh-CN`。

1. 抽出所有 `lang` span，确认 **zh 与 en 数量相等，且严格成对**
   （每个 zh span 后面紧跟 en span，每个 en span 前面紧跟 zh span）。
   数量不等或次序错乱，就是漏翻译或多翻译。
2. 确认文本类改动**两种语言都写了** —— 常见漏法是只改了英文那一半。
3. 确认 `docs/index.md`（中文）与 `docs/index.en.md`（英文）同步更新，
   且顶部语言切换链接互相指向。
4. 确认 `docs/llms.txt`、`docs/sitemap.xml` 里指向 README 与 markdown 页的链接
   同时给出中英两个。
5. `docs/index.html` 的 JSON-LD（`FAQPage`）里，中英两套问答都要在，
   且 `name` 互不重复（中文问题名与英文问题名天然不同，因此不冲突）。

### 第 8 步：核对"已知问题"清单

`docs/api-list.md` 的「六、已知问题与注意事项」分两类，要分开处理：

- **已修复** —— 代码已改但记录没删 → 属于**文档过期**，应删除该条
- **仍然存在** —— 代码还没改但描述不准 → 属于**描述失真**，应更新描述

被修复的常见项：

- 死常量（定义了但无调用方）
- 从未被引用的类型
- 重复实现的函数
- 缺失的响应头
- 路由前缀匹配的副作用

### 第 9 步：输出报告

按下面的格式输出。**只报告，不改文件。**

```markdown
## 文档同步检查报告

**检查范围**：<改动涉及的文件>
**结论**：<无需更新 / 发现 N 处需更新>

### 需要更新（按严重程度排序）

#### 1. <一句话概括> — 严重/一般/轻微

- **文件**：`docs/api-list.md:120`
- **现状**：文档写的是「...」
- **实际**：代码是「...」（`src/index.ts:75`）
- **建议**：把「...」改成「...」

### 已确认仍然准确

- `docs/data-model.md` 的实体定义与 `src/types.ts` 一致
- ...
```

**严重程度**：

| 级别 | 判据                                                                |
| ---- | ------------------------------------------------------------------- |
| 严重 | 对外契约变了（工具参数、路由、响应体、错误码）—— 会让调用方直接踩坑 |
| 一般 | 内部实现细节变了（模块职责、实体字段、依赖关系）—— 影响维护者的理解 |
| 轻微 | 措辞、顺序、遗漏的"已知问题"条目                                    |

**没有发现问题时**，也要说明检查了哪些项 —— 让用户知道覆盖范围，而不是只看到一个空报告。

---

## 注意事项

- **只读**。不要用 `Edit`/`Write` 修改文档，也不要用 `Bash` 跑脚本。
  本技能的 `allowed-tools` 只有 `Read` 和 `Grep`，请严格遵守。
- **给出准确的行号**，让用户能直接跳转。
- **区分"文档错了"和"代码该改"**。发现问题时优先判断：
  文档描述的是**有意为之**的行为，还是**代码漂移**？
  如果是代码漂移，报告里要写明"文档与代码不符，需确认哪边是对的"。
- **不要臆测**。每条结论都要有 `Read`/`Grep` 的实际输出作为依据。
- **图不可省略**。图与代码脱节往往比文字更容易被忽略。
- 若发现代码本身有 bug（而不只是文档过期），单独列一节"顺带发现的代码问题"，
  但**仍然不要直接改代码**。
