// Verifies the resume live-reload loop end to end:
//   fs.watch on resume.html → notifyClients → WebSocket "reload" → location.reload()
//
// Run with: node .claude/dev/verify-live-reload.mjs
import { mkdtemp, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import WebSocket from "ws";

const home = await mkdtemp(join(tmpdir(), "resume-reload-"));
process.env.XDG_CONFIG_HOME = join(home, ".config");
process.env.CLAUDE_MERMAID_LOG_LEVEL = "OFF";

const { handleResumePreview } = await import("../../build/handlers.js");
const { ensureLiveServer, closeLiveServer } = await import("../../build/live-server.js");
const { getResumeFilePath } = await import("../../build/file-utils.js");

const resumeId = "sample";
const content = {
  basics: { name: "王小明", title: "高级前端工程师" },
  experience: [{ company: "某某科技", highlights: ["首屏从 4.2s 降到 1.1s"] }],
};

console.log("① 调用 resume_preview …");
const preview = await handleResumePreview({ resume_id: resumeId, content });
console.log("  ", preview.content[0].text.split("\n")[0]);

const port = await ensureLiveServer();
const htmlPath = getResumeFilePath(resumeId, "html");
const url = `ws://localhost:${port}/resume/${resumeId}`;
console.log(`② 连接 WebSocket: ${url}`);

const ws = new WebSocket(url);
let received = null;
let opened = false;

const guard = setTimeout(() => {
  if (!opened) {
    console.log("✗ 连接超时");
    finish(1);
    return;
  }
  console.log("✗ 超时：未收到 reload，收到的是", JSON.stringify(received));
  finish(1);
}, 8000);

function finish(code) {
  clearTimeout(guard);
  try {
    ws.terminate();
  } catch {}
  // The server keeps the event loop alive; exit explicitly.
  process.exit(code);
}

ws.on("message", (data) => {
  received = data.toString();
});

ws.on("error", (error) => {
  console.log("✗ WebSocket 错误:", error.message);
  finish(1);
});

ws.on("open", async () => {
  opened = true;
  console.log("   ✓ 连接成功");

  const before = await readFile(htmlPath, "utf-8");
  await writeFile(htmlPath, `${before}<!-- touched -->`, "utf-8");
  console.log(`③ 改写被 watch 的 resume.html（${before.length} → ${before.length + 18} 字节）`);

  setTimeout(async () => {
    console.log("④ 收到 WebSocket 消息:", JSON.stringify(received));

    if (received !== "reload") {
      console.log("   ✗ 没有收到 reload —— 热刷新链路断了");
      finish(1);
      return;
    }
    console.log('   ✓ 收到 "reload" —— 浏览器会执行 location.reload()');

    const after = await readFile(htmlPath, "utf-8");
    const updated = after.includes("touched");
    console.log(`⑤ 重载后读到的内容已更新: ${updated}`);
    console.log(
      updated
        ? '\n✓ 热刷新链路完整：fs.watch → notifyClients → ws "reload" → location.reload()'
        : "\n✗ 内容未更新"
    );
    finish(updated ? 0 : 1);
  }, 1500);
});

setTimeout(() => {
  if (!opened) {
    console.log("✗ 连接超时");
    finish(1);
    return;
  }
  console.log("✗ 超时：未收到 reload，收到的是", JSON.stringify(received));
  finish(1);
}, 8000);
