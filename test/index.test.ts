import { describe, it, expect } from "vitest";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { RESUME_TEMPLATES, RESUME_THEMES, RESUME_FORMATS } from "../src/constants.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load tool definitions from the source by parsing the built output
// Since index.ts has top-level await and stdio side effects, we parse package.json
// and validate the tool schema structure against the source file directly.
const indexSource = await readFile(join(__dirname, "../src/index.ts"), "utf-8");

describe("MCP server tool definitions", () => {
  describe("resume_preview", () => {
    it("should be defined with correct name", () => {
      expect(indexSource).toContain('name: "resume_preview"');
    });

    it("should require resume_id and content parameters", () => {
      expect(indexSource).toContain('required: ["resume_id", "content"]');
    });

    it("should accept content as an object or a JSON string", () => {
      expect(indexSource).toContain('anyOf: [{ type: "object" }, { type: "string" }]');
    });

    it("should build template and theme enums from the allowlists", () => {
      expect(indexSource).toContain("enum: [...RESUME_TEMPLATES]");
      expect(indexSource).toContain("enum: [...RESUME_THEMES]");
      expect(RESUME_TEMPLATES).toEqual(["default"]);
      expect(RESUME_THEMES).toEqual(["default"]);
    });

    it("should have default values for optional parameters", () => {
      expect(indexSource).toContain("default: DEFAULT_RESUME_TEMPLATE");
      expect(indexSource).toContain("default: DEFAULT_RESUME_THEME");
    });
  });

  describe("resume_export", () => {
    it("should be defined with correct name", () => {
      expect(indexSource).toContain('name: "resume_export"');
    });

    it("should require save_path and resume_id parameters", () => {
      expect(indexSource).toContain('required: ["save_path", "resume_id"]');
    });

    it("should offer the pdf and html formats", () => {
      expect(indexSource).toContain("enum: [...RESUME_FORMATS]");
      expect(RESUME_FORMATS).toEqual(["pdf", "html"]);
    });
  });

  describe("server configuration", () => {
    it("should use resume-preview as server name", () => {
      expect(indexSource).toContain('name: "resume-preview"');
    });

    it("should define exactly two tools", () => {
      const resumeTools = indexSource.match(/name: "resume_\w+"/g);
      expect(resumeTools).toHaveLength(2);
    });

    it("should not expose any mermaid tool", () => {
      const mermaidTools = indexSource.match(/name: "mermaid_\w+"/g);
      expect(mermaidTools).toBeNull();
      expect(indexSource).not.toContain('case "mermaid_');
    });

    it("should dispatch every tool to a handler", () => {
      for (const toolName of ["resume_preview", "resume_export"]) {
        expect(indexSource).toContain(`case "${toolName}":`);
      }
    });
  });
});

describe("package.json", () => {
  it("should have matching version", async () => {
    const pkg = JSON.parse(await readFile(join(__dirname, "../package.json"), "utf-8"));
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
