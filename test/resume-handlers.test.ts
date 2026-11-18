/**
 * Unit tests for the resume MCP tools
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFile, stat, utimes, writeFile } from "fs/promises";
import { join } from "path";
import { handleResumePreview, handleResumeExport } from "../src/handlers.js";
import { getResumeDir, getResumeFilePath, slugifyResumeId } from "../src/file-utils.js";
import { setupTestEnv, restoreTestEnv } from "./helpers/env-helpers.js";

// Mock the browser launch and the live server so nothing is opened
vi.mock("child_process", () => ({
  execFile: vi.fn((_file: string, _args: string[], callback: Function) => {
    callback(null, { stdout: "", stderr: "" });
  }),
  spawn: vi.fn(() => ({
    unref: vi.fn(),
    on: vi.fn(),
  })),
}));

vi.mock("../src/live-server.js", () => ({
  ensureLiveServer: vi.fn(async () => 3737),
  addLiveSession: vi.fn(async () => {}),
  hasActiveConnections: vi.fn(() => false),
}));

const content = {
  basics: { name: "王小明", title: "高级前端工程师" },
  experience: [{ company: "某某科技", highlights: ["做了 X"] }],
};

describe("handleResumePreview", () => {
  beforeEach(async () => {
    await setupTestEnv();
  });

  afterEach(async () => {
    await restoreTestEnv();
  });

  it("should report a missing resume_id", async () => {
    const result = await handleResumePreview({ content });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("resume_id parameter is required");
  });

  it("should report missing content", async () => {
    const result = await handleResumePreview({ resume_id: "r1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("content parameter is required");
  });

  it("should reject content that is not an object", async () => {
    const result = await handleResumePreview({ resume_id: "r1", content: "not json" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid content");
  });

  it("should reject an unknown template", async () => {
    const result = await handleResumePreview({
      resume_id: "r1",
      content,
      template: "nope",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid template");
  });

  it("should render and return a live URL", async () => {
    const result = await handleResumePreview({ resume_id: "r1", content });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Live reload URL");
    expect(result.content[0].text).toContain("/resume/r1");
  });

  it("should still return the live URL when the browser cannot be opened", async () => {
    // On Windows, spawn throws synchronously when the command exists but is
    // not a valid executable. The resume is already rendered, so the call
    // must succeed and still hand the client the URL to open.
    const { spawn } = await import("child_process");
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error("spawn UNKNOWN");
    });

    const result = await handleResumePreview({ resume_id: "r1", content });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Live reload URL");
    expect(result.content[0].text).toContain("/resume/r1");
    const body = await readFile(getResumeFilePath("r1", "html"), "utf-8");
    expect(body).toContain("王小明");
  });

  it("should write the content, the options and the rendered body", async () => {
    await handleResumePreview({ resume_id: "r1", content });

    const stored = JSON.parse(await readFile(getResumeFilePath("r1", "content"), "utf-8"));
    expect(stored.basics.name).toBe("王小明");
    expect(stored.version).toBe(1);

    const options = JSON.parse(await readFile(getResumeFilePath("r1", "options"), "utf-8"));
    expect(options.template).toBe("default");

    const body = await readFile(getResumeFilePath("r1", "html"), "utf-8");
    expect(body).toContain("王小明");
    expect(body).toContain("某某科技");
  });

  it("should accept a JSON string as content", async () => {
    const result = await handleResumePreview({
      resume_id: "r1",
      content: JSON.stringify(content),
    });
    expect(result.isError).toBeUndefined();
    const body = await readFile(getResumeFilePath("r1", "html"), "utf-8");
    expect(body).toContain("王小明");
  });

  it("should store a Chinese id under its slug", async () => {
    await handleResumePreview({ resume_id: "小王的简历", content });
    const slug = slugifyResumeId("小王的简历");
    expect(getResumeDir("小王的简历")).toBe(
      join(getResumeDir("r1").split("resumes")[0], "resumes", slug)
    );
  });

  it("should keep the stored template when none is given", async () => {
    await handleResumePreview({ resume_id: "r1", content });
    const options = JSON.parse(await readFile(getResumeFilePath("r1", "options"), "utf-8"));
    expect(options.template).toBe("default");
    expect(options.theme).toBe("default");
  });

  it("should default the locale to zh-CN", async () => {
    await handleResumePreview({ resume_id: "r1", content });
    const options = JSON.parse(await readFile(getResumeFilePath("r1", "options"), "utf-8"));
    expect(options.locale).toBe("zh-CN");
  });

  it("should store the requested locale and render the headings in it", async () => {
    await handleResumePreview({ resume_id: "r1", content, locale: "en" });

    const options = JSON.parse(await readFile(getResumeFilePath("r1", "options"), "utf-8"));
    expect(options.locale).toBe("en");

    const body = await readFile(getResumeFilePath("r1", "html"), "utf-8");
    expect(body).toContain("Experience");
    expect(body).not.toContain("工作经历");
  });

  it("should keep the stored locale when none is given", async () => {
    await handleResumePreview({ resume_id: "r1", content, locale: "en" });
    await handleResumePreview({ resume_id: "r1", content });

    const options = JSON.parse(await readFile(getResumeFilePath("r1", "options"), "utf-8"));
    expect(options.locale).toBe("en");
  });

  it("should reject an unsupported locale", async () => {
    const result = await handleResumePreview({ resume_id: "r1", content, locale: "fr" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid locale");
  });
});

describe("handleResumeExport", () => {
  beforeEach(async () => {
    await setupTestEnv();
  });

  afterEach(async () => {
    await restoreTestEnv();
  });

  it("should report a missing save_path", async () => {
    const result = await handleResumeExport({ resume_id: "r1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("save_path parameter is required");
  });

  it("should report a missing resume_id", async () => {
    const result = await handleResumeExport({ save_path: "./out.html" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("resume_id parameter is required");
  });

  it("should reject an extension that does not match the format", async () => {
    const result = await handleResumeExport({
      resume_id: "r1",
      save_path: "./out.pdf",
      format: "html",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("does not match format");
  });

  it("should reject an unknown format", async () => {
    const result = await handleResumeExport({
      resume_id: "r1",
      save_path: "./out.docx",
      format: "docx",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid format");
  });

  it("should export an HTML file", async () => {
    await handleResumePreview({ resume_id: "r1", content });

    const target = join(process.env.XDG_CONFIG_HOME!, "out.html");
    const result = await handleResumeExport({
      resume_id: "r1",
      save_path: target,
      format: "html",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Resume saved to:");
    const saved = await readFile(target, "utf-8");
    expect(saved).toContain("王小明");
    expect(saved).toContain("resume-export");
  });

  it("should fail when the resume does not exist", async () => {
    const result = await handleResumeExport({
      resume_id: "never-existed",
      save_path: join(process.env.XDG_CONFIG_HOME!, "out.html"),
      format: "html",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error saving resume");
  });

  it("should export the updated content after the resume was changed", async () => {
    await handleResumePreview({ resume_id: "r1", content });

    const first = join(process.env.XDG_CONFIG_HOME!, "first.html");
    await handleResumeExport({ resume_id: "r1", save_path: first, format: "html" });
    expect(await readFile(first, "utf-8")).toContain("王小明");

    // The resume is edited, so the export must not ship the previous version.
    await handleResumePreview({
      resume_id: "r1",
      content: { basics: { name: "李小明" }, summary: "改过的内容" },
    });

    const second = join(process.env.XDG_CONFIG_HOME!, "second.html");
    const result = await handleResumeExport({
      resume_id: "r1",
      save_path: second,
      format: "html",
    });

    expect(result.isError).toBeUndefined();
    const saved = await readFile(second, "utf-8");
    expect(saved).toContain("李小明");
    expect(saved).toContain("改过的内容");
    expect(saved).not.toContain("王小明");
  });

  it("should reuse a cached artifact when the content did not change", async () => {
    await handleResumePreview({ resume_id: "r1", content });

    // A cached artifact that is newer than the content is reused as is.
    const artifact = getResumeFilePath("r1", "exportHtml");
    await writeFile(artifact, "<html>cached</html>", "utf-8");
    const future = new Date(Date.now() + 60_000);
    await utimes(artifact, future, future);

    const target = join(process.env.XDG_CONFIG_HOME!, "cached.html");
    await handleResumeExport({ resume_id: "r1", save_path: target, format: "html" });

    expect(await readFile(target, "utf-8")).toContain("cached");
  });

  it("should re-render when refresh is requested", async () => {
    await handleResumePreview({ resume_id: "r1", content });

    const artifact = getResumeFilePath("r1", "exportHtml");
    await writeFile(artifact, "<html>cached</html>", "utf-8");
    const future = new Date(Date.now() + 60_000);
    await utimes(artifact, future, future);

    const target = join(process.env.XDG_CONFIG_HOME!, "refreshed.html");
    const result = await handleResumeExport({
      resume_id: "r1",
      save_path: target,
      format: "html",
      refresh: true,
    });

    expect(result.isError).toBeUndefined();
    const saved = await readFile(target, "utf-8");
    expect(saved).not.toContain("cached");
    expect(saved).toContain("王小明");
  });
});
