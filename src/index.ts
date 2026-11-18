#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { handleResumePreview, handleResumeExport } from "./handlers.js";
import { migrateLegacyAppDir } from "./file-utils.js";
import {
  RESUME_TEMPLATES,
  RESUME_THEMES,
  RESUME_FORMATS,
  SUPPORTED_LOCALES,
  DEFAULT_RESUME_TEMPLATE,
  DEFAULT_RESUME_THEME,
  DEFAULT_RESUME_FORMAT,
  DEFAULT_RESUME_LOCALE,
} from "./constants.js";
import { mcpLogger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(await readFile(join(__dirname, "../package.json"), "utf-8"));
const VERSION = packageJson.version;

if (process.argv.includes("-v") || process.argv.includes("--version")) {
  console.log(VERSION);
  process.exit(0);
}

const isServeMode = process.argv.includes("--serve");

// One-time migration of the pre-rename data directory. Runs before anything
// reads or writes under the app directory.
await migrateLegacyAppDir();

if (isServeMode) {
  const { startServeMode } = await import("./serve.js");
  await startServeMode();
}

const TOOL_DEFINITIONS: Tool[] = [
  {
    name: "resume_preview",
    description:
      "Render a resume from structured content and open it in the browser with live reload. " +
      "The content is rendered as an A4 page and the browser refreshes automatically every time " +
      "the content is updated, so you can iterate on the wording without re-exporting. " +
      "All content is rendered as plain text — HTML in the content is escaped, not interpreted. " +
      "The `locale` parameter sets the language of the section headings and of the exported document; " +
      "match it to the language of the job posting. " +
      "Use resume_export to save the result as PDF or HTML. " +
      "IMPORTANT: Automatically use this tool whenever you produce or revise a resume for the user.",
    inputSchema: {
      type: "object",
      properties: {
        resume_id: {
          type: "string",
          description:
            "ID for this resume. May contain Chinese characters; the storage name is derived from it. Use different IDs for multiple resumes.",
        },
        content: {
          description:
            "The resume content, either as an object or as a JSON string containing the same object. " +
            "Fields: basics {name, title, email, phone, location, links[{label,url}]}, summary, " +
            "experience[{company,title,start,end,location,highlights[]}], " +
            "projects[{name,role,period,highlights[]}], " +
            "education[{school,degree,period,highlights[]}], " +
            "skills[{category,items[]}], extras[{label,items[]}]. " +
            "Only basics.name is required; every other section is omitted when missing.",
          anyOf: [{ type: "object" }, { type: "string" }],
        },
        template: {
          type: "string",
          enum: [...RESUME_TEMPLATES],
          description: `Layout template of the resume (default: ${DEFAULT_RESUME_TEMPLATE})`,
          default: DEFAULT_RESUME_TEMPLATE,
        },
        theme: {
          type: "string",
          enum: [...RESUME_THEMES],
          description: `Color and font theme of the resume (default: ${DEFAULT_RESUME_THEME})`,
          default: DEFAULT_RESUME_THEME,
        },
        locale: {
          type: "string",
          enum: [...SUPPORTED_LOCALES],
          description:
            `Language of the resume itself — the section headings and the exported document ` +
            `(default: ${DEFAULT_RESUME_LOCALE}). Independent of the language of the browser UI. ` +
            `Omit it to keep the language the resume was last rendered in.`,
          default: DEFAULT_RESUME_LOCALE,
        },
      },
      required: ["resume_id", "content"],
    },
  },
  {
    name: "resume_export",
    description:
      "Save the current resume to a file path. " +
      "Renders on demand when the artifact does not exist yet, and re-renders " +
      "whenever the content changed since the last export. " +
      "The file extension must match the requested format. " +
      "PDF export requires a Chinese font to be installed on the machine when the " +
      "document contains Chinese characters.",
    inputSchema: {
      type: "object",
      properties: {
        resume_id: {
          type: "string",
          description:
            "ID of the resume to export. Must match the resume_id used in resume_preview.",
        },
        save_path: {
          type: "string",
          description:
            "Path to save the resume file (e.g. './docs/resume.pdf'). The extension must match the format.",
        },
        format: {
          type: "string",
          enum: [...RESUME_FORMATS],
          description: `Output format (default: ${DEFAULT_RESUME_FORMAT})`,
          default: DEFAULT_RESUME_FORMAT,
        },
        refresh: {
          type: "boolean",
          description:
            "Re-render the artifact even if a cached one exists. Use when the content was changed outside of resume_preview.",
          default: false,
        },
      },
      required: ["save_path", "resume_id"],
    },
  },
];

const server = new Server(
  {
    name: "resume-preview",
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  mcpLogger.debug("ListTools request received");
  return { tools: TOOL_DEFINITIONS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments;

  mcpLogger.info(`CallTool request: ${toolName}`);

  try {
    let result;
    switch (toolName) {
      case "resume_preview":
        result = await handleResumePreview(args);
        mcpLogger.info(`CallTool completed: ${toolName}`);
        return result;
      case "resume_export":
        result = await handleResumeExport(args);
        mcpLogger.info(`CallTool completed: ${toolName}`);
        return result;
      default:
        mcpLogger.error(`Unknown tool: ${toolName}`);
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    mcpLogger.error(`Tool ${toolName} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

async function main() {
  mcpLogger.info("MCP Server starting", { version: VERSION });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  mcpLogger.info("MCP Server connected via stdio");
  console.error("Resume Preview MCP Server running on stdio");
}

if (!isServeMode) {
  main().catch((error) => {
    mcpLogger.error("Fatal error during startup", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
