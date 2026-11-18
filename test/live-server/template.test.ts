import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const templatePath = join(__dirname, "../../src/preview/resume-template.html");

let template: string;

beforeAll(async () => {
  template = await readFile(templatePath, "utf-8");
});

describe("Resume preview template", () => {
  it("is readable from disk", () => {
    expect(template).toBeTruthy();
    expect(template).toContain("<!doctype html>");
  });

  it("contains required placeholders", () => {
    expect(template).toContain("{{CONTENT}}");
    expect(template).toContain("{{RESUME_ID}}");
    expect(template).toContain("{{PORT}}");
    expect(template).toContain("{{LIVE_ENABLED}}");
    expect(template).toContain("{{PAGE_TITLE}}");
    expect(template).toContain("{{PAGE_HEAD}}");
    expect(template).toContain("{{PAGE_SHELL}}");
    expect(template).toContain("{{PAGE_SCRIPTS}}");
    expect(template).toContain("{{BODY_ATTRIBUTES}}");

    expect(template).toContain('data-resume-id="{{RESUME_ID}}"');
    expect(template).toContain('data-port="{{PORT}}"');
    expect(template).toContain('data-live-enabled="{{LIVE_ENABLED}}"');
  });

  it("injects the CSS and script assets through the page placeholders", () => {
    // The assets are injected by the renderer, not hard-coded in the template.
    expect(template).toContain("{{PAGE_HEAD}}");
    expect(template).toContain("{{PAGE_SCRIPTS}}");
  });
});
