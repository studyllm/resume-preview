// Calls a tool on the MCP server over stdio, with Claude out of the loop.
// Lets you exercise a single tool while debugging, without reloading Claude Code.
//
//   node .claude/dev/call-tool.mjs
//   node .claude/dev/call-tool.mjs resume_preview '{"resume_id":"sample","content":{...}}'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const [toolName, rawArgs] = process.argv.slice(2);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "build", "index.js")],
  cwd: root,
  env: {
    ...process.env,
    CLAUDE_MERMAID_LOG_LEVEL: process.env.CLAUDE_MERMAID_LOG_LEVEL ?? "DEBUG",
  },
});

const client = new Client({ name: "dev-probe", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

if (!toolName) {
  const { tools } = await client.listTools();
  console.log("可用工具：");
  for (const tool of tools) {
    console.log(`  ${tool.name}`);
    console.log(`    ${tool.description.split("\n")[0]}`);
  }
  await client.close();
  process.exit(0);
}

const toolArgs = rawArgs ? JSON.parse(rawArgs) : {};
console.log(`调用 ${toolName} …`);
const result = await client.callTool({ name: toolName, arguments: toolArgs });

for (const item of result.content ?? []) {
  if (item.type === "text") console.log(item.text);
}
if (result.isError) {
  console.error("调用失败");
  await client.close();
  process.exit(1);
}

await client.close();
