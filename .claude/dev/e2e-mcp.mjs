// E2E —— MCP 工具链路 + 浏览器端真实行为
//
//   npm run build && node .claude/dev/e2e-mcp.mjs
//
// 覆盖：真实 stdio 上的 MCP 工具调用 → 落盘产物 → Chromium 加载真实预览页 →
//       WebSocket 热刷新 → 画廊页 → 导出 PDF/HTML → 错误路径
//
// 测试期间不会弹出浏览器窗口：给 PATH 前置一个 cmd.exe 替身，拦掉「打开默认
// 浏览器」那一步。替身必须是真实可执行文件 —— Windows 上 spawn 一个存在但
// 不是合法可执行文件的文件会**同步抛错**（这正是产品里的一个真实缺陷，
// 见 src/handlers.ts 的 spawn 调用）。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, readFile, writeFile, mkdir, stat, copyFile } from "fs/promises";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const home = await mkdtemp(join(tmpdir(), "resume-e2e-"));
const configDir = join(home, ".config");
const stubDir = join(home, "stub");
await mkdir(stubDir, { recursive: true });
await copyFile(process.env.SystemRoot + "\\System32\\where.exe", join(stubDir, "cmd.exe"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "build", "index.js")],
  cwd: root,
  env: {
    ...process.env,
    XDG_CONFIG_HOME: configDir,
    PATH: `${stubDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
    CLAUDE_MERMAID_LOG_LEVEL: "INFO",
  },
});
const client = new Client({ name: "e2e", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return {
    isError: !!r.isError,
    text: (r.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n"),
  };
};

console.log("\n━━━ ① MCP 工具契约 ━━━");
const { tools } = await client.listTools();
check("暴露恰好两个工具", tools.length === 2, tools.map((t) => t.name).join(", "));
const previewTool = tools.find((t) => t.name === "resume_preview");
const localeProp = previewTool?.inputSchema?.properties?.locale;
check(
  "resume_preview 声明 locale 参数且默认 zh-CN",
  localeProp?.default === "zh-CN" && localeProp?.enum?.includes("en"),
  JSON.stringify(localeProp?.enum)
);
check(
  "resume_export 描述已说明字体条件",
  tools
    .find((t) => t.name === "resume_export")
    ?.description.includes("when the document contains Chinese"),
  "描述里含条件表述"
);

console.log("\n━━━ ② resume_preview（中文简历 / zh-CN）━━━");
const zhContent = {
  basics: { name: "王小明", title: "高级后端工程师", email: "wang@example.com", location: "上海" },
  summary: "八年后端经验。",
  experience: [{ company: "某某科技", highlights: ["接口 P99 从 800ms 降到 180ms"] }],
  skills: [{ category: "后端", items: ["Go", "Java"] }],
};
const r1 = await call("resume_preview", {
  resume_id: "e2e-zh",
  content: zhContent,
  locale: "zh-CN",
});
check("调用成功", !r1.isError, r1.text.split("\n")[0]);
check(
  "返回了 live URL",
  /http:\/\/localhost:\d+\/resume\//.test(r1.text),
  (r1.text.match(/http:\/\/localhost:\d+\/resume\/\S+/) || [""])[0]
);
const zhDir = join(configDir, "resume-preview", "resumes", "e2e-zh");
const zhFiles = await stat(zhDir)
  .then(() => true)
  .catch(() => false);
check("落盘目录存在", zhFiles, zhDir);
const zhOptions = JSON.parse(await readFile(join(zhDir, "options.json"), "utf-8"));
check("options.json 记录 locale=zh-CN", zhOptions.locale === "zh-CN", JSON.stringify(zhOptions));
const zhHtml = await readFile(join(zhDir, "resume.html"), "utf-8");
check("resume.html 含中文分节标题", zhHtml.includes("工作经历") && zhHtml.includes("自我评价"));
check("resume.html 含用户内容", zhHtml.includes("某某科技"));

console.log("\n━━━ ③ resume_preview（英文简历 / en）━━━");
const enContent = {
  basics: {
    name: "Alex Morgan",
    title: "Senior Backend Engineer",
    email: "alex@example.com",
    location: "Shanghai",
  },
  summary: "Eight years of backend experience.",
  experience: [
    { company: "Northwind Systems", highlights: ["Cut p99 latency from 800ms to 180ms"] },
  ],
  skills: [{ category: "Backend", items: ["Go", "Java"] }],
};
const r2 = await call("resume_preview", { resume_id: "e2e-en", content: enContent, locale: "en" });
check("调用成功", !r2.isError, r2.text.split("\n")[0]);
const enDir = join(configDir, "resume-preview", "resumes", "e2e-en");
const enOptions = JSON.parse(await readFile(join(enDir, "options.json"), "utf-8"));
check("options.json 记录 locale=en", enOptions.locale === "en", JSON.stringify(enOptions));
const enHtml = await readFile(join(enDir, "resume.html"), "utf-8");
check("resume.html 用英文分节标题", enHtml.includes("Experience") && enHtml.includes("Summary"));
check("resume.html 不含中文分节标题", !enHtml.includes("工作经历"));
check(
  "resume.html 落盘的是 body 片段（不含 <html> 标签）",
  !enHtml.includes("<html"),
  "完整文档由服务端组装"
);

console.log("\n━━━ ④ 浏览器端：真实加载预览页 ━━━");
const port = (r1.text.match(/localhost:(\d+)/) || [])[1];
const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && consoleErrors.push("console: " + m.text()));
const failedRequests = [];
page.on("requestfailed", (r) => failedRequests.push(`${r.url()} — ${r.failure()?.errorText}`));

// 界面语言由浏览器决定；本机默认 Accept-Language 是 zh-CN，这里显式设成 en-US
await page.emulateLocale("en-US");
await page.goto(`http://localhost:${port}/resume/e2e-en`, { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 1200));
const previewState = await page.evaluate(() => ({
  lang: document.documentElement.lang,
  h1: document.querySelector(".resume-name")?.innerText.trim(),
  sectionTitles: [...document.querySelectorAll(".resume-section-title")].map((e) =>
    e.innerText.trim()
  ),
  statusText: document.getElementById("status-text")?.innerText.trim(),
  statusClass: document.getElementById("status-indicator")?.className || "",
}));
check("预览页渲染出姓名", previewState.h1 === "Alex Morgan", previewState.h1);
check(
  "简历正文用英文分节标题",
  previewState.sectionTitles.includes("Experience"),
  JSON.stringify(previewState.sectionTitles)
);
check("简历正文无中文分节标题", !previewState.sectionTitles.includes("工作经历"));
check("界面语言=en-US 时 html lang=en", previewState.lang === "en", previewState.lang);
check(
  "工具栏状态文案随界面语言走（英文）",
  /live/i.test(previewState.statusText || ""),
  previewState.statusText
);
check(
  "WebSocket 已连接（状态点无 disconnected 类）",
  !/disconnected/.test(previewState.statusClass),
  `class="${previewState.statusClass}"`
);
check("无 JS 报错", consoleErrors.length === 0, consoleErrors.join(" | "));
check("无失败的网络请求", failedRequests.length === 0, failedRequests.join(" | "));

console.log("\n━━━ ④b 双轴独立性：界面语言 × 简历语言 ━━━");
{
  // 浏览器中文 + 简历英文 → 界面中文、简历英文
  const p1 = await browser.newPage();
  await p1.emulateLocale("zh-CN");
  await p1.goto(`http://localhost:${port}/resume/e2e-en`, { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 900));
  const s1 = await p1.evaluate(() => ({
    lang: document.documentElement.lang,
    status: document.getElementById("status-text")?.innerText.trim(),
    sections: [...document.querySelectorAll(".resume-section-title")].map((e) =>
      e.innerText.trim()
    ),
  }));
  check("浏览器中文 + 简历英文 → html lang=zh-CN（界面语言）", s1.lang === "zh-CN", s1.lang);
  check("浏览器中文 + 简历英文 → 工具栏是中文", /实时刷新/.test(s1.status || ""), s1.status);
  check(
    "浏览器中文 + 简历英文 → 简历正文仍是英文",
    s1.sections.includes("Experience"),
    JSON.stringify(s1.sections)
  );
  await p1.close();

  // 浏览器英文 + 简历中文 → 界面英文、简历中文
  const p2 = await browser.newPage();
  await p2.emulateLocale("en-US");
  await p2.goto(`http://localhost:${port}/resume/e2e-zh`, { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 900));
  const s2 = await p2.evaluate(() => ({
    lang: document.documentElement.lang,
    status: document.getElementById("status-text")?.innerText.trim(),
    sections: [...document.querySelectorAll(".resume-section-title")].map((e) =>
      e.innerText.trim()
    ),
  }));
  check("浏览器英文 + 简历中文 → html lang=en（界面语言）", s2.lang === "en", s2.lang);
  check("浏览器英文 + 简历中文 → 工具栏是英文", /live/i.test(s2.status || ""), s2.status);
  check(
    "浏览器英文 + 简历中文 → 简历正文仍是中文",
    s2.sections.includes("工作经历"),
    JSON.stringify(s2.sections)
  );
  await p2.close();
}

console.log("\n━━━ ⑤ 热刷新：改内容 → 页面自动重载 ━━━");
await page.evaluate(() => {
  window.__marker = "before";
});
const r3 = await call("resume_preview", {
  resume_id: "e2e-en",
  content: { ...enContent, summary: "Updated summary text." },
  locale: "en",
});
check("二次 preview 调用成功", !r3.isError);
await new Promise((r) => setTimeout(r, 2500));
const afterReload = await page.evaluate(() => ({
  marker: window.__marker,
  summary: document.querySelector(".resume-text")?.innerText.trim(),
}));
check(
  "页面确实重载过（window 标记被清空）",
  afterReload.marker === undefined,
  String(afterReload.marker)
);
check("重载后显示的是新内容", afterReload.summary === "Updated summary text.", afterReload.summary);

console.log("\n━━━ ⑥ 画廊页 ━━━");
const gallery = await browser.newPage();
const galleryErrors = [];
gallery.on("pageerror", (e) => galleryErrors.push(e.message));
await gallery.goto(`http://localhost:${port}/`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 900));
const galleryState = await gallery.evaluate(() => ({
  count: document.querySelectorAll(".resume-card").length,
  hasSearch: !!document.querySelector("input[type=search], .search-input, input"),
  deleteBtns: document.querySelectorAll(".delete-btn").length,
}));
check("画廊列出 2 份简历", galleryState.count === 2, String(galleryState.count));
check("画廊有搜索框", galleryState.hasSearch);
check("画廊每份简历有删除按钮", galleryState.deleteBtns === 2, String(galleryState.deleteBtns));
check("画廊无 JS 报错", galleryErrors.length === 0, galleryErrors.join(" | "));
if (galleryState.hasSearch) {
  await gallery.type("input", "e2e-en");
  await new Promise((r) => setTimeout(r, 500));
  const filtered = await gallery.evaluate(() => document.querySelectorAll(".resume-card").length);
  check("搜索能过滤出 1 份", filtered === 1, String(filtered));
}

console.log("\n━━━ ⑦ 导出 ━━━");
const outPdf = join(home, "out.pdf");
const outHtml = join(home, "out.html");
const e1 = await call("resume_export", { resume_id: "e2e-en", save_path: outPdf, format: "pdf" });
check("导出 PDF 成功", !e1.isError, e1.text.split("\n")[0]);
const pdfBuf = await readFile(outPdf);
check("产物是合法 PDF", pdfBuf.subarray(0, 4).toString() === "%PDF", `${pdfBuf.length} 字节`);

const e2 = await call("resume_export", { resume_id: "e2e-zh", save_path: outHtml, format: "html" });
check("导出 HTML 成功", !e2.isError, e2.text.split("\n")[0]);
const exported = await readFile(outHtml, "utf-8");
check(
  "导出 HTML 是独立文档（含中文分节标题）",
  exported.includes("工作经历") && exported.includes("自我评价")
);
check(
  "导出 HTML 不含工具栏元素（只有内联 CSS 里有 .status-bar 样式）",
  !/<div class="status-bar"/.test(exported),
  "元素层面无工具栏"
);

console.log("\n━━━ ⑧ 错误路径 ━━━");
const bad1 = await call("resume_export", {
  resume_id: "e2e-en",
  save_path: join(home, "x.html"),
  format: "pdf",
});
check(
  "扩展名与 format 不符时报错",
  bad1.isError,
  (bad1.text.match(/does not match format/) || [bad1.text.split("\n")[0]])[0]
);
const bad2 = await call("resume_preview", { resume_id: "e2e-en" });
check("缺 content 时报错", bad2.isError, bad2.text.split("\n")[0]);
const bad3 = await call("resume_export", {
  resume_id: "does-not-exist",
  save_path: join(home, "y.pdf"),
  format: "pdf",
});
check("不存在的 resume_id 报错", bad3.isError, bad3.text.split("\n")[0]);

await browser.close();
await client.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n━━━ 结果：${results.length - failed.length}/${results.length} 通过 ━━━`);
if (failed.length) {
  console.log("失败项：");
  for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
}
process.exit(failed.length ? 1 : 0);
