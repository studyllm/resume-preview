# Changelog

## 3.2.2 — 2026-11-19

- 重写 README 安装章节：全局安装提到「其他 MCP 客户端」路径的第 1 步，并写明跳过会怎样；
  原先散落在文末的客户端配置章节合并进快速开始，中英 README 与官网同步

## 3.2.1 — 2026-11-19

- `resume` 技能的描述改为纯英文并精简，动词覆盖 write / create / draft（中文提法同样能触发）
- 技能 `allowed-tools` 补上本机实际注册的工具名 `mcp__mermaid__resume_preview` /
  `mcp__mermaid__resume_export`，避免调用时多一次授权弹窗
- 插件版本号抬到 3.2.1：`claude plugin update` 按版本号判断是否重装，版本不变时会跳过

## 3.2.0 — 2026-11-19

- 导出的独立 HTML 改为居中排版：A4 纸张水平居中放在灰色底衬上，带投影与 15mm 内边距；
  打印与 PDF 输出完全不变（页边距仍由 `@page` 提供）
- 「简历画廊」改名为「简历库」（`Resume Gallery` → `Resume Library`），
  导航、页面标题与中英文档同步更新

## 3.1.0 — 2026-11-18

首次发布到 npm（包名 `@studyllm/resume-preview`，此前未发布过）。

- MCP server：`resume_preview` 实时预览 + `resume_export` 导出 PDF / HTML
- 简历按纯文本渲染并转义，内容中的标签与脚本不会被解释
- 导出语言由简历自身的 `locale` 决定，与浏览器请求头无关
- 独立画廊模式：`resume-preview --serve`
