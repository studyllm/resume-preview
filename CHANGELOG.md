# Changelog

## 3.2.0 — 2026-11-19

- 导出的独立 HTML 改为居中排版：A4 纸张水平居中放在灰色底衬上，带投影与 15mm 内边距；
  打印与 PDF 输出完全不变（页边距仍由 `@page` 提供）
- 「简历画廊」改名为「简历库」（`Resume Gallery` → `Resume Library`），
  导航、页面标题与中英文档同步更新
- `resume` 技能的描述补上中文触发词（写 / 创建 / 生成 / 做一份简历），
  中文提法现在能正常触发技能

## 3.1.0 — 2026-11-18

首次发布到 npm（包名 `@studyllm/resume-preview`，此前未发布过）。

- MCP server：`resume_preview` 实时预览 + `resume_export` 导出 PDF / HTML
- 简历按纯文本渲染并转义，内容中的标签与脚本不会被解释
- 导出语言由简历自身的 `locale` 决定，与浏览器请求头无关
- 独立画廊模式：`resume-preview --serve`
