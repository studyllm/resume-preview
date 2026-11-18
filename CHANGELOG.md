# Changelog

## 3.1.0 — 2026-11-18

首次发布到 npm（包名 `@studyllm/resume-preview`，此前未发布过）。

- MCP server：`resume_preview` 实时预览 + `resume_export` 导出 PDF / HTML
- 简历按纯文本渲染并转义，内容中的标签与脚本不会被解释
- 导出语言由简历自身的 `locale` 决定，与浏览器请求头无关
- 独立画廊模式：`resume-preview --serve`
