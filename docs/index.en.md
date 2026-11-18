# Resume Preview — Live resume previews for any MCP client

[简体中文](index.md) | **English**

resume-preview is an MCP server that renders a resume in your browser and reloads it over a WebSocket every time the content changes. One A4 page, refreshed in place while you rewrite the wording, exported to PDF or HTML when it is ready.

Free and open source · MIT license · works with any MCP client.

- Website: https://studyllm.github.io/resume-preview/
- GitHub: https://github.com/studyllm/resume-preview
- npm: https://www.npmjs.com/package/@studyllm/resume-preview
- Structured index for agents: https://studyllm.github.io/resume-preview/llms.txt
- The Chinese markdown version of this page: https://studyllm.github.io/resume-preview/index.md

## How it works

A local render loop with four moving parts:

1. **The AI client calls a tool.** When you ask for a resume, the AI client calls `resume_preview` with the content and a `resume_id` that names the session.
2. **It renders the page.** The server writes the content to a working file and fills the HTML template, escaping every value so the page is plain text.
3. **It serves the resume locally.** A small local server hosts the result at `http://localhost:3737/resume/<slug>` and opens it in your browser the first time.
4. **It reloads live over WebSocket.** Every later call with the same `resume_id` re-renders the file and pushes a reload down a WebSocket. A green dot means the tab is connected; red means it is reconnecting.

## Features

- **Live reload** — the browser refreshes automatically as the content changes, with a status dot showing the WebSocket connection.
- **A4 layout** — the page you review in the browser is the page the PDF prints.
- **PDF and HTML export** — a print-ready PDF, or a standalone HTML document you can open and edit.
- **Plain text, always** — every value in the content is escaped; HTML tags and scripts are never interpreted.
- **Section model** — only `basics.name` is required, and any section you leave out is omitted from the page.
- **Multiple resumes** — give each resume its own `resume_id` and work on several at once.
- **Two independent languages** — the page chrome follows the browser's language; the resume's own language is set per resume and decides the section headings and the exported document.
- **Persistent working files** — resumes are kept under `~/.config/resume-preview/resumes`, so they survive between sessions.
- **Standalone gallery** — run `resume-preview --serve` to open a browser gallery of every stored resume, no agent required. Search by id, see when each one was last updated, delete the ones you no longer need.
- **Review tools** — zoom, pan and export straight from the preview page, with a live connection indicator and a "last updated" stamp.
- **Built-in resume skill** — the Claude Code plugin ships a skill with the content model and the preview-iterate-export workflow.

## Installation

> **Release status**: The npm package `@studyllm/resume-preview` is published.
> Install it globally with `npm install -g @studyllm/resume-preview`; the plugin's `npx`
> launcher is `npx -y @studyllm/resume-preview`. You can also clone the repository
> `studyllm/resume-preview`, run `npm install && npm run build`, and wire it up with `.mcp.json`.

### Claude Code plugin (recommended)

Add the marketplace and install the plugin from inside Claude Code, then restart to activate it:

```
/plugin marketplace add studyllm/resume-preview
/plugin install resume-preview@resume-preview
```

Restart Claude Code, then run `/mcp` — you should see `resume-preview` in the server list.

### npm

Install the CLI globally and register it as a user-scoped MCP server:

```bash
npm install -g @studyllm/resume-preview
claude mcp add --scope user resume-preview resume-preview
```

Verify with `claude mcp list` — you should see `resume-preview: resume-preview - ✓ Connected`.

### Other MCP clients

For Cursor, Codex, Windsurf, Cline, Gemini CLI, or any other MCP client, install the package and add this to the client's MCP configuration:

```json
{
  "mcpServers": {
    "resume-preview": {
      "command": "resume-preview"
    }
  }
}
```

Some clients want an absolute path — find it with `which resume-preview` and use that as the command.

## Tools reference

The server exposes exactly two tools.

### resume_preview — render the resume and open a live preview

| Parameter   | Type             | Default   | Description                                                                                                                                                              |
| ----------- | ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `resume_id` | string           | required  | Names the resume. May contain Chinese characters; the slug is derived from it.                                                                                           |
| `content`   | object or string | required  | The resume content — see the model below. Only `basics.name` is required.                                                                                                |
| `template`  | string           | `default` | Layout template. `default` is the only one implemented today.                                                                                                            |
| `theme`     | string           | `default` | Color and font theme. `default` is the only one implemented today.                                                                                                       |
| `locale`    | string           | `zh-CN`   | Language of the resume itself — the section headings and the exported document. One of `zh-CN`, `en`. Independent of the browser's language, and stored with the resume. |

### resume_export — save the resume to a path

| Parameter   | Type    | Default  | Description                                                                      |
| ----------- | ------- | -------- | -------------------------------------------------------------------------------- |
| `save_path` | string  | required | Destination path, e.g. `./docs/resume.pdf`. The extension must match the format. |
| `resume_id` | string  | required | Must match the `resume_id` used in `resume_preview`.                             |
| `format`    | string  | `pdf`    | One of `pdf`, `html`.                                                            |
| `refresh`   | boolean | `false`  | Re-render even when a cached artifact exists.                                    |

## Content model

Only `basics.name` is required. Everything else is optional and omitted from the page when missing.

| Section      | Shape                                                              |
| ------------ | ------------------------------------------------------------------ |
| `basics`     | `{ name, title, email, phone, location, links: [{ label, url }] }` |
| `summary`    | string — a short self-summary                                      |
| `experience` | `[{ company, title, start, end, location, highlights: [] }]`       |
| `projects`   | `[{ name, role, period, highlights: [] }]`                         |
| `education`  | `[{ school, degree, period, highlights: [] }]`                     |
| `skills`     | `[{ category, items: [] }]`                                        |
| `extras`     | `[{ label, items: [] }]`                                           |

The section order is fixed: Summary → Experience → Projects → Education → Skills → Extras. The headings follow the resume's own `locale` — `zh-CN` gives 自我评价 → 工作经历 → 项目经历 → 教育经历 → 专业技能 → 其他.

## FAQ

**Which clients are supported?** Built for Claude Code, where the plugin also installs a resume skill. Because it speaks the Model Context Protocol, it works with any MCP client — Cursor, Codex, Windsurf, Cline, and Gemini CLI included.

**Which formats can be exported?** `pdf` and `html`. The PDF is a real A4 page printed by headless Chromium; the HTML is a standalone document. The file extension has to match the requested format.

**Does exporting to PDF need anything special?** Only when the **document actually contains
Chinese** — the machine needs a Chinese font installed, otherwise the Chinese characters would come
out as empty boxes. The export fails with a clear message instead of quietly writing a broken file.
A resume with `locale` set to `zh-CN` always counts as Chinese (its section headings are Chinese); a resume
written entirely in English exports fine on a machine without a Chinese font.

**Where are my resumes stored?** Under `~/.config/resume-preview/resumes/<slug>/`, logs under `~/.config/resume-preview/logs`. The `resume_export` tool writes the artifact to any path you choose.

**Which languages are supported?** Two, and they are independent of each other. The page chrome follows the request — `?lang=en` wins, then the browser's `Accept-Language`, then `zh-CN`. The resume itself follows the `locale` you pass to `resume_preview`, which is stored with the resume and decides the section headings and the exported document. The export never depends on the browser, so the same resume always exports the same way.

**What ports does it use?** The local preview server uses ports 3737–3747 and automatically picks the first one that is free. It binds to `127.0.0.1` only and has no authentication — a resume holds personal data, so never expose it to your LAN.

**Can I preview several resumes at once?** Yes. Give each one its own `resume_id`, such as `company-a` or `company-b`, and each gets its own live URL that reloads independently. Reuse the same `resume_id` to revise a resume in the tab you already have open.

**Can the content contain HTML?** No, and deliberately so. Every value is escaped and printed as text, so markup shows up literally instead of being interpreted.

**Is it free?** Yes. resume-preview is open source under the MIT license.

---

MIT licensed · built by [Vitalii Elenhaupt](https://github.com/veelenga) · [GitHub](https://github.com/studyllm/resume-preview) · [npm](https://www.npmjs.com/package/@studyllm/resume-preview) · [Claude Code docs](https://docs.anthropic.com/en/docs/claude-code)
