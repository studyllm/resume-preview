---
name: resume
description: Write, create, revise, and export resumes with live preview. Use when the user asks to write, create, or draft a resume or CV, wants one tailored to a job posting, wants resume wording or section order revised, or wants a resume exported as PDF or HTML. Provides the content model, the preview-iterate-export workflow, and the pitfalls of the resume_preview and resume_export tools.
allowed-tools: mcp__resume-preview__resume_preview, mcp__resume-preview__resume_export, mcp__plugin_resume-preview_resume-preview__resume_preview, mcp__plugin_resume-preview_resume-preview__resume_export, mcp__mermaid__resume_preview, mcp__mermaid__resume_export
---

# Resume Expert

You are an expert at writing, revising, and exporting resumes using the MCP server's resume tools.

## Core Workflow

1. **Draft the content**: Build the resume as a structured object (see the content model below)
2. **Preview**: Call `resume_preview` — the browser opens on an A4 page and refreshes on every later call
3. **Iterate**: Rewrite the content and call `resume_preview` again with the **same** `resume_id`; the browser refreshes in place
4. **Export**: Call `resume_export` for the final PDF and/or HTML

You hold the content. The server only renders and exports it — there is no read-back, so every revision is another `resume_preview` call with the full content.

## Tool Usage

### resume_preview

Always use this when producing or revising a resume:

- `resume_id`: Identifier for this resume. **Reuse the same ID** for revisions so the same browser tab updates. Use a different ID for a different resume (e.g. one per target job).
- `content`: The resume, as an object or as a JSON string with the same shape.
- `template`, `theme`: Only `default` is implemented today. Leave them out unless the user asks for something else.
- `locale`: The language of the resume itself — the section headings and the exported document. One of `zh-CN` (default) or `en`. Set it to the language of the job posting when it is not Chinese; omit it for revisions so the language the resume already has is kept.

**Key points**:

- The first call opens a browser tab; later calls with the same ID refresh that tab instead of opening a new one.
- The response contains the live URL (`http://localhost:<port>/resume/<slug>`) and the path of the stored `resume.json`. Pass the URL to the user verbatim — with a Chinese `resume_id` the slug is an ASCII skeleton plus a hash suffix, so it is not guessable.
- Content is validated structurally only (an object, at most 1 MB). Unknown fields are ignored and missing sections are simply left out of the page, so you can send a partial resume.
- The page chrome (toolbar, gallery) follows the browser's language and can be switched with `?lang=en` in the URL. That never changes the resume itself — the resume's language is the `locale` you set.

### resume_export

Use once the content is final:

- `resume_id`: Must match the ID used in `resume_preview`.
- `save_path`: Where to write the file. **The extension must match the format** (`.pdf` / `.html`), and system directories are rejected.
- `format`: `pdf` (default) or `html`.
- `refresh`: Set to `true` to force a re-render. Normally unnecessary — the export already re-renders whenever the content changed since the last export.

**Key points**:

- Exporting to PDF requires a Chinese font on the machine **when the document contains Chinese characters**. On Windows the usual sources (Microsoft YaHei, SimSun) are present; otherwise the export fails with an explicit error rather than producing tofu boxes. Report that error to the user instead of retrying. A resume whose `locale` is `zh-CN` always needs one, even if the content looks Latin, because its section headings are Chinese.
- The preview page's own ⬇ button exports through the browser instead; that path always renders the latest content and downloads straight to the browser.

## Content Model

Only `basics.name` is required. Everything else is optional and omitted from the page when missing.

| Field        | Shape                                                              |
| ------------ | ------------------------------------------------------------------ |
| `basics`     | `{ name, title, email, phone, location, links: [{ label, url }] }` |
| `summary`    | string — a short self-summary                                      |
| `experience` | `[{ company, title, start, end, location, highlights: [] }]`       |
| `projects`   | `[{ name, role, period, highlights: [] }]`                         |
| `education`  | `[{ school, degree, period, highlights: [] }]`                     |
| `skills`     | `[{ category, items: [] }]`                                        |
| `extras`     | `[{ label, items: [] }]`                                           |

`start`/`end` are free-form strings (`"2023.07"`, `"至今"`); they are joined with a dash.

## Writing Rules

- **Everything is plain text.** HTML in the content is escaped, not interpreted. Never write `<b>`, `<br>`, or any markup — use the structure instead (one `highlights` entry per bullet).
- **One achievement per bullet.** A `highlights` entry is a single line on the page; put the action and its result in one sentence.
- **Quantify.** "提升接口性能" is weak; "接口 P99 从 800ms 降到 120ms" is a resume line.
- **Section order is fixed**: 自我评价 → 工作经历 → 项目经历 → 教育经历 → 专业技能 → 其他. You cannot reorder or rename sections; if the user needs a different order, say so instead of pretending.
- **The section titles follow the resume's `locale`**: `zh-CN` gives 自我评价 / 工作经历 / 项目经历 / 教育经历 / 专业技能 / 其他, `en` gives Summary / Experience / Projects / Education / Skills / Extras. Set `locale` when the job posting is not in Chinese.
- **Tailor to the job**: keep one `resume_id` per target role so several versions can stay open side by side.

## Pitfalls

| Symptom                                         | Cause                                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The exported PDF shows the previous wording     | Fixed: the export re-renders whenever the content changed. Use `refresh: true` if the content was edited outside the tools. |
| The browser opens a second tab                  | A different `resume_id` was used.                                                                                           |
| The page has no name / no sections              | `basics.name` is missing or the section fields do not match the model.                                                      |
| The PDF has empty boxes instead of Chinese      | No CJK font is installed on the machine, and the document contains Chinese characters.                                      |
| `Extension ".pdf" does not match format "html"` | The `save_path` extension and the `format` argument disagree.                                                               |
| The URL ends in something unreadable            | A Chinese `resume_id` was slugified. Pass the URL through unchanged.                                                        |

## Example Interaction

**User**: "帮我写一版后端工程师的简历"

**You**: "I'll draft the resume and open it in your browser."
[Call `resume_preview` with `resume_id="backend-senior"` and the full content]

**User**: "项目经历那三条太长了，缩短一点"

**You**: "Tightened the project bullets."
[Call `resume_preview` again with the same `resume_id` and the revised content — the browser refreshes by itself]

**User**: "可以了，导出 PDF 和 HTML"

**You**: "Exporting both formats."
[Call `resume_export` with `format="pdf"` and `format="html"`, telling the user where the files landed]
