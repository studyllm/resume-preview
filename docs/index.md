# Resume Preview — 给任意 MCP 客户端的实时简历预览

**简体中文** | [English](index.en.md)

resume-preview 是一个 MCP server，把简历渲染到你的浏览器里，每次内容更新，页面都会通过 WebSocket 自动重载。一个 A4 页面，你改措辞时原地刷新，改好了再导出成 PDF 或 HTML。

免费开源 · MIT 许可证 · 兼容任何 MCP 客户端。

- 官网：https://studyllm.github.io/resume-preview/
- GitHub：https://github.com/studyllm/resume-preview
- npm：https://www.npmjs.com/package/@studyllm/resume-preview
- 给 agent 的结构化索引：https://studyllm.github.io/resume-preview/llms.txt
- 本页的英文版（Markdown）：https://studyllm.github.io/resume-preview/index.en.md

## 工作原理

一个本地渲染闭环，四个环节：

1. **AI 客户端调用工具。** 当你要一份简历时，AI 客户端调用 `resume_preview`，带上内容和标识这次会话的 `resume_id`。
2. **渲染出页面。** 服务把内容写进工作文件，再填充 HTML 模板，每个值都做转义，所以页面始终是纯文本。
3. **在本地提供这个简历。** 一个小型本地服务把它托管在 `http://localhost:3737/resume/<slug>`，并在第一次时替你打开浏览器。
4. **通过 WebSocket 实时刷新。** 之后每次用同一个 `resume_id` 调用，都会重新渲染文件并推送一次刷新。绿点表示已连接，红点表示正在重连。

## 功能特性

- **实时刷新** —— 内容一改，浏览器自动刷新，状态圆点显示 WebSocket 连接情况。
- **A4 版式** —— 你在浏览器里审阅的那一页，就是 PDF 打印出来的那一页。
- **PDF 与 HTML 导出** —— 可直接打印的 PDF，或可以打开编辑的独立 HTML 文档。
- **始终是纯文本** —— 内容里的每个值都转义后按文本打印，HTML 标签和脚本永远不会被解释。
- **分节模型** —— 只有 `basics.name` 是必填的，任何没写的板块都会被省略。
- **多份简历** —— 给每份简历一个自己的 `resume_id`，同时推进好几份。
- **两套彼此独立的语言** —— 页面框架跟随浏览器语言；简历自身的语言按份设置，决定分节标题和导出的文档。
- **持久化的工作文件** —— 简历存放在 `~/.config/resume-preview/resumes`，跨会话也不丢。
- **独立画廊** —— 运行 `resume-preview --serve` 打开浏览器画廊，列出所有已存简历，不需要 agent。可以按 id 搜索、看到每份简历的最后更新时间，也能删除不再需要的。
- **审阅工具** —— 在预览页里缩放、平移、导出，附带连接状态指示和"最后更新"时间戳。
- **内置简历技能** —— Claude Code 插件自带一个技能，装着内容模型和"预览—迭代—导出"的工作流。

## 安装

> **发布状态**：npm 包 `@studyllm/resume-preview` **尚未发布**（`npm view @studyllm/resume-preview` 返回 404），
> 因此 `npm install -g @studyllm/resume-preview` 与插件的 `npx` 启动方式暂时都不可用。GitHub 仓库
> `studyllm/resume-preview` 已创建，请克隆源码后执行 `npm install && npm run build`，
> 再用 `.mcp.json` 接入。

### Claude Code 插件（推荐）

在 Claude Code 里添加 marketplace 并安装插件，然后重启以激活：

```
/plugin marketplace add studyllm/resume-preview
/plugin install resume-preview@resume-preview
```

重启 Claude Code，然后运行 `/mcp` —— 你应当能在服务列表里看到 `resume-preview`。

### npm

从 npm 全局安装 CLI，并把它注册为用户级 MCP 服务：

```bash
npm install -g @studyllm/resume-preview
claude mcp add --scope user resume-preview resume-preview
```

用 `claude mcp list` 验证 —— 你应当看到 `resume-preview: resume-preview - ✓ Connected`。

### 其他 MCP 客户端

Cursor、Codex、Windsurf、Cline、Gemini CLI，或任何其他 MCP 客户端：先安装这个包，再把下面这段加进客户端的 MCP 配置：

```json
{
  "mcpServers": {
    "resume-preview": {
      "command": "resume-preview"
    }
  }
}
```

有些客户端要的是绝对路径 —— 用 `which resume-preview` 查到路径后填进去即可。

## 工具参考

MCP 服务恰好暴露两个工具。

### resume_preview —— 渲染简历并打开实时预览

| 参数        | 类型             | 默认值    | 说明                                                                                           |
| ----------- | ---------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `resume_id` | string           | 必填      | 给这份简历起名。可以包含中文；落盘的 slug 由它推导。                                           |
| `content`   | object or string | 必填      | 简历内容 —— 见下面的模型。只有 `basics.name` 是必填的。                                        |
| `template`  | string           | `default` | 版式模板。目前只实现了 `default`。                                                             |
| `theme`     | string           | `default` | 配色与字体主题。目前只实现了 `default`。                                                       |
| `locale`    | string           | `zh-CN`   | 简历自身的语言：分节标题和导出的文档。可选 `zh-CN`、`en`。与浏览器语言无关，并随简历一起存储。 |

### resume_export —— 把简历保存到某个路径

| 参数        | 类型    | 默认值  | 说明                                                                     |
| ----------- | ------- | ------- | ------------------------------------------------------------------------ |
| `save_path` | string  | 必填    | 目标路径，例如 `./docs/resume.pdf`。扩展名必须与格式一致。               |
| `resume_id` | string  | 必填    | 必须与 `resume_preview` 中使用的 `resume_id` 一致。                      |
| `format`    | string  | `pdf`   | 可选 `pdf`、`html`。                                                     |
| `refresh`   | boolean | `false` | 即使已有缓存产物也重新渲染。通常没必要：内容有变化时导出本就会重新渲染。 |

## 内容模型

只有 `basics.name` 是必填的。其余板块缺失时都会从页面上省略。

| 板块         | 结构                                                               |
| ------------ | ------------------------------------------------------------------ |
| `basics`     | `{ name, title, email, phone, location, links: [{ label, url }] }` |
| `summary`    | string —— 一段简短的自我评价                                       |
| `experience` | `[{ company, title, start, end, location, highlights: [] }]`       |
| `projects`   | `[{ name, role, period, highlights: [] }]`                         |
| `education`  | `[{ school, degree, period, highlights: [] }]`                     |
| `skills`     | `[{ category, items: [] }]`                                        |
| `extras`     | `[{ label, items: [] }]`                                           |

分节的顺序是固定的：自我评价 → 工作经历 → 项目经历 → 教育经历 → 专业技能 → 其他。标题跟随简历自身的 `locale` —— `en` 对应 Summary → Experience → Projects → Education → Skills → Extras。

## 常见问题

**支持哪些客户端？** 它是为 Claude Code 做的，插件还会一并装上简历技能。因为它讲的是 Model Context Protocol，所以任何 MCP 客户端都能用 —— Cursor、Codex、Windsurf、Cline、Gemini CLI 都在内 —— 用标准的命令配置即可。

**简历能导出成哪些格式？** `pdf` 和 `html`。PDF 是无头 Chromium 打印出的真实 A4 页面；HTML 是可以打开编辑的独立文档。文件扩展名必须与请求的格式一致。

**导出 PDF 需要什么额外条件吗？** 只有当**文档里出现中文**时才需要 —— 机器上装有中文字体，
否则中文字符会变成空心方块，导出失败并给出明确报错，而不是悄悄写出一个坏文件。
`locale` 为 `zh-CN` 的简历一律按「需要中文字体」处理（它的分节标题本身就是中文）；
`locale` 为 `en` 的纯英文简历在没有中文字体的机器上也能正常导出。

**我的简历存放在哪里？** 在 `~/.config/resume-preview/resumes/<slug>/` 下，跨会话也不丢；日志在 `~/.config/resume-preview/logs`。`resume_export` 工具把产物写到你指定的任意路径。

**支持哪些语言？** 两种，而且彼此独立。**页面框架** —— 画廊、工具栏、对话框 —— 跟随请求：`?lang=en` 优先，其次浏览器的 `Accept-Language`，最后 `zh-CN`。**简历本身** —— 分节标题和导出的文档 —— 跟随你传给 `resume_preview` 的 `locale`，它与简历一起存储，默认 `zh-CN`。导出语言永远不依赖浏览器，所以同一份简历每次导出都一样。

**用哪些端口？** 本地预览服务使用 3737–3747 端口，自动挑第一个空闲的。它只绑定 `127.0.0.1`，且没有鉴权 —— 简历含个人数据，绝不要暴露到局域网。

**能同时做多份简历吗？** 可以。给每份一个自己的 `resume_id`，比如 `company-a` 或 `company-b`，每份都有各自独立的实时 URL。修改同一份简历时复用同一个 `resume_id`，刷新的是你已经开着的那个标签页。

**内容里可以放 HTML 吗？** 不可以，而且是刻意的。每个值都转义后按文本打印，标记会原样显示，不会被解释。写纯文本就好。

**免费吗？** 免费。resume-preview 是 MIT 许可证下的开源项目。

---

MIT 许可证 · 由 [Vitalii Elenhaupt](https://github.com/veelenga) 构建 · [GitHub](https://github.com/studyllm/resume-preview) · [npm](https://www.npmjs.com/package/@studyllm/resume-preview) · [Claude Code 文档](https://docs.anthropic.com/en/docs/claude-code)
