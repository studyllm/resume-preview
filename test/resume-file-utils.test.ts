/**
 * Unit tests for the resume-related helpers in file-utils.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile, utimes } from "fs/promises";
import { join } from "path";
import {
  getResumesDir,
  getResumeDir,
  getResumeFilePath,
  saveResumeContent,
  loadResumeContent,
  saveResumeOptions,
  loadResumeOptions,
  normalizeResumeContent,
  slugifyResumeId,
  deleteResumeDirectory,
  validateSavePath,
  invalidateResumeArtifacts,
  isResumeArtifactStale,
} from "../src/file-utils.js";
import { setupTestEnv, restoreTestEnv } from "./helpers/env-helpers.js";

describe("Resume file utilities", () => {
  beforeEach(async () => {
    await setupTestEnv();
  });

  afterEach(async () => {
    await restoreTestEnv();
  });

  describe("getResumesDir", () => {
    it("should return a path under the config directory", () => {
      expect(getResumesDir()).toContain("resume-preview");
      expect(getResumesDir().endsWith("resumes")).toBe(true);
    });
  });

  describe("slugifyResumeId", () => {
    it("should keep an already safe id untouched", () => {
      expect(slugifyResumeId("frontend-senior")).toBe("frontend-senior");
      expect(slugifyResumeId("resume_1")).toBe("resume_1");
    });

    it("should reduce a Chinese id to a safe slug", () => {
      const slug = slugifyResumeId("小王的简历");
      expect(slug).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(slug.startsWith("r-")).toBe(true);
    });

    it("should give different Chinese ids different slugs", () => {
      expect(slugifyResumeId("小王的简历")).not.toBe(slugifyResumeId("小李的简历"));
    });

    it("should be idempotent", () => {
      const slug = slugifyResumeId("小王的简历");
      expect(slugifyResumeId(slug)).toBe(slug);
    });
  });

  describe("getResumeDir / getResumeFilePath", () => {
    it("should place the workspace under the resumes directory", () => {
      const dir = getResumeDir("frontend-senior");
      expect(dir.startsWith(getResumesDir())).toBe(true);
      expect(dir.endsWith("frontend-senior")).toBe(true);
    });

    it("should map each artifact kind to its own file name", () => {
      expect(getResumeFilePath("r1", "content")).toContain("resume.json");
      expect(getResumeFilePath("r1", "options")).toContain("options.json");
      expect(getResumeFilePath("r1", "html")).toContain("resume.html");
      expect(getResumeFilePath("r1", "exportHtml")).toContain("resume.export.html");
      expect(getResumeFilePath("r1", "pdf")).toContain("resume.pdf");
    });
  });

  describe("saveResumeContent / loadResumeContent", () => {
    it("should round-trip the content and stamp the version", async () => {
      await saveResumeContent("r1", { basics: { name: "王小明" } });

      const stored = await loadResumeContent("r1");
      expect(stored.basics?.name).toBe("王小明");
      expect(stored.version).toBe(1);
    });

    it("should keep a version that was already set", async () => {
      await saveResumeContent("r1", { version: 7, basics: { name: "A" } });
      const stored = await loadResumeContent("r1");
      expect(stored.version).toBe(7);
    });
  });

  describe("saveResumeOptions / loadResumeOptions", () => {
    it("should round-trip the options", async () => {
      await saveResumeOptions("r1", { template: "default", theme: "default" });
      const options = await loadResumeOptions("r1");
      expect(options.template).toBe("default");
      expect(options.theme).toBe("default");
    });

    it("should fall back to defaults when the file is missing", async () => {
      const options = await loadResumeOptions("missing");
      expect(options.template).toBe("default");
      expect(options.theme).toBe("default");
    });
  });

  describe("normalizeResumeContent", () => {
    it("should accept an object", () => {
      const content = normalizeResumeContent({ basics: { name: "A" } });
      expect(content.basics?.name).toBe("A");
    });

    it("should accept a JSON string", () => {
      const content = normalizeResumeContent('{"basics":{"name":"A"}}');
      expect(content.basics?.name).toBe("A");
    });

    it("should reject a string that is not valid JSON", () => {
      expect(() => normalizeResumeContent("not json")).toThrow(/Invalid content/);
    });

    it("should reject an array", () => {
      expect(() => normalizeResumeContent([1, 2])).toThrow(/Expected a resume object, got array/);
    });

    it("should reject null", () => {
      expect(() => normalizeResumeContent(null)).toThrow(/Expected a resume object, got null/);
    });

    it("should reject content that is too large", () => {
      const huge = { basics: { name: "A" }, summary: "x".repeat(1024 * 1024 + 10) };
      expect(() => normalizeResumeContent(huge)).toThrow(/exceeds 1024KB limit/);
    });
  });

  describe("deleteResumeDirectory", () => {
    it("should remove the whole workspace", async () => {
      await saveResumeContent("r1", { basics: { name: "A" } });
      const dir = getResumeDir("r1");
      await mkdir(dir, { recursive: true });

      await deleteResumeDirectory("r1");

      await expect(readFile(join(dir, "resume.json"), "utf-8")).rejects.toThrow();
    });

    it("should not fail when the directory does not exist", async () => {
      await expect(deleteResumeDirectory("never-existed")).resolves.toBeUndefined();
    });
  });

  describe("invalidateResumeArtifacts / isResumeArtifactStale", () => {
    // The staleness check compares modification times, so the tests pin them
    // explicitly instead of relying on the clock.
    async function touch(path: string, timestamp: number): Promise<void> {
      const date = new Date(timestamp);
      await utimes(path, date, date);
    }

    it("should report a missing artifact as stale", async () => {
      await saveResumeContent("r1", { basics: { name: "A" } });
      expect(await isResumeArtifactStale("r1", "exportHtml")).toBe(true);
    });

    it("should report an artifact that is newer than the content as fresh", async () => {
      await saveResumeContent("r1", { basics: { name: "A" } });
      const artifact = getResumeFilePath("r1", "exportHtml");
      await writeFile(artifact, "<html></html>", "utf-8");
      await touch(getResumeFilePath("r1", "content"), 1_000_000);
      await touch(artifact, 2_000_000);

      expect(await isResumeArtifactStale("r1", "exportHtml")).toBe(false);
    });

    it("should report an artifact that is older than the content as stale", async () => {
      await saveResumeContent("r1", { basics: { name: "A" } });
      const artifact = getResumeFilePath("r1", "exportHtml");
      await writeFile(artifact, "<html></html>", "utf-8");
      await touch(artifact, 1_000_000);
      await touch(getResumeFilePath("r1", "content"), 2_000_000);

      expect(await isResumeArtifactStale("r1", "exportHtml")).toBe(true);
    });

    it("should report an artifact from the same tick as the content as stale", async () => {
      await saveResumeContent("r1", { basics: { name: "A" } });
      const artifact = getResumeFilePath("r1", "exportHtml");
      await writeFile(artifact, "<html></html>", "utf-8");
      await touch(getResumeFilePath("r1", "content"), 1_000_000);
      await touch(artifact, 1_000_000);

      expect(await isResumeArtifactStale("r1", "exportHtml")).toBe(true);
    });

    it("should remove both cached artifacts", async () => {
      await saveResumeContent("r1", { basics: { name: "A" } });
      await writeFile(getResumeFilePath("r1", "exportHtml"), "<html></html>", "utf-8");
      await writeFile(getResumeFilePath("r1", "pdf"), "pdf-bytes");

      await invalidateResumeArtifacts("r1");

      await expect(readFile(getResumeFilePath("r1", "exportHtml"), "utf-8")).rejects.toThrow();
      await expect(readFile(getResumeFilePath("r1", "pdf"), "utf-8")).rejects.toThrow();
    });

    it("should not fail when there is nothing to remove", async () => {
      await expect(invalidateResumeArtifacts("never-existed")).resolves.toBeUndefined();
    });
  });

  describe("validateSavePath with an expected format", () => {
    it("should accept a matching extension", () => {
      expect(() => validateSavePath("./out.pdf", "pdf")).not.toThrow();
    });

    it("should reject a mismatching extension", () => {
      expect(() => validateSavePath("./out.pdf", "html")).toThrow(
        /Extension "\.pdf" does not match format "html"/
      );
    });

    it("should still reject null bytes", () => {
      expect(() => validateSavePath("./out\0.pdf", "pdf")).toThrow(/null bytes/);
    });
  });
});
