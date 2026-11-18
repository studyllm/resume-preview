// 验证**已发布到 npm 的包**能不能当 MCP server 用 —— 不是本地 build。
//
//   node .claude/dev/verify-npm-publish.mjs
//
// 与 e2e-mcp.mjs 的区别：那个跑的是本地 build/index.js，这个跑的是
// `npx -y @studyllm/resume-preview`，和 Claude Code 插件里 mcpServers 写的
// 命令完全一致。目的是验证「发布出去的那个包」本身是好的：tarball 里少文件、
// 依赖装不上、Chromium 没下载，这些问题只有跑真包才暴露得出来。
//
// 测试期间不会弹出浏览器窗口（同 e2e-mcp.mjs 的 PATH 替身做法），
// 也不会写你的真实 ~/.config（XDG_CONFIG_HOME 指到临时目录）。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, readFile, stat, copyFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const PACKAGE = "@studyllm/resume-preview";

const home = await mkdtemp(join(tmpdir(), "resume-npm-"));
const configDir = join(home, ".config");
const stubDir = join(home, "stub");
await mkdir(stubDir, { recursive: true });
await copyFile(process.env.SystemRoot + "\\System32\\where.exe", join(stubDir, "cmd.exe"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

console.log(`\n━━━ 启动已发布的包：npx -y ${PACKAGE} ━━━`);
const transport = new StdioClientTransport({
  // Windows 上 npx 是 .cmd 垫片，spawn 不带 shell 时必须显式指到 .cmd
  command: process.platform === "win32" ? "npx.cmd" : "npx",
  args: ["-y", PACKAGE],
  cwd: home,
  env: {
    ...process.env,
    XDG_CONFIG_HOME: configDir,
    PATH: `${stubDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
    CLAUDE_MERMAID_LOG_LEVEL: "INFO",
  },
});

const client = new Client({ name: "npm-verify", version: "1.0.0" }, { capabilities: {} });
// npx 首次拉包可能超过默认的 60s 请求超时
const TIMEOUT = { timeout: 300000 };
await client.connect(transport, TIMEOUT);
check("MCP 握手成功（包能作为 stdio server 启动）", true);

const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args }, undefined, TIMEOUT);
  return {
    isError: !!r.isError,
    text: (r.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n"),
  };
};

console.log("\n━━━ ① 工具契约 ━━━");
const { tools } = await client.listTools({}, TIMEOUT);
check("暴露恰好两个工具", tools.length === 2, tools.map((t) => t.name).join(", "));

console.log("\n━━━ ② resume_preview ━━━");
const zhContent = {
  basics: { name: "王小明", title: "高级后端工程师", email: "wang@example.com", location: "上海" },
  summary: "八年后端经验。",
  experience: [{ company: "某某科技", highlights: ["接口 P99 从 800ms 降到 180ms"] }],
  skills: [{ category: "后端", items: ["Go", "Java"] }],
};
const r1 = await call("resume_preview", {
  resume_id: "npm-zh",
  content: zhContent,
  locale: "zh-CN",
});
check("调用成功", !r1.isError, r1.text.split("\n")[0]);
const liveUrl = (r1.text.match(/http:\/\/localhost:\d+\/resume\/\S+/) || [])[0];
check("返回了 live URL", !!liveUrl, liveUrl);

const zhDir = join(configDir, "resume-preview", "resumes", "npm-zh");
check(
  "落盘目录存在",
  await stat(zhDir).then(
    () => true,
    () => false
  ),
  zhDir
);
const zhHtml = await readFile(join(zhDir, "resume.html"), "utf-8");
check(
  "resume.html 含中文分节标题与用户内容",
  zhHtml.includes("工作经历") && zhHtml.includes("某某科技")
);
check(
  "预览页可访问",
  await fetch(liveUrl).then(
    (r) => r.ok,
    () => false
  ),
  liveUrl
);

console.log("\n━━━ ③ resume_export ━━━");
const outPdf = join(home, "out.pdf");
const e1 = await call("resume_export", { resume_id: "npm-zh", save_path: outPdf, format: "pdf" });
check("导出 PDF 成功", !e1.isError, e1.text.split("\n")[0]);
const pdfBuf = await readFile(outPdf);
check(
  "产物是合法 PDF（说明 Chromium 可用）",
  pdfBuf.subarray(0, 4).toString() === "%PDF",
  `${pdfBuf.length} 字节`
);

const outHtml = join(home, "out.html");
const e2 = await call("resume_export", { resume_id: "npm-zh", save_path: outHtml, format: "html" });
check("导出 HTML 成功", !e2.isError, e2.text.split("\n")[0]);
check(
  "导出 HTML 是含中文分节标题的独立文档",
  (await readFile(outHtml, "utf-8")).includes("工作经历")
);

await client.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n━━━ 结果：${results.length - failed.length}/${results.length} 通过 ━━━`);
if (failed.length) {
  console.log("失败项：");
  for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? " — " + f.detail : ""}`);
}
process.exit(failed.length ? 1 : 0);
