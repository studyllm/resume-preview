/**
 * Unit tests for the resume service
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, utimes } from "fs/promises";
import { join } from "path";
import { listResumes, getResumeInfo, deleteResume } from "../src/resume-service.js";
import { getResumeDir, getResumeFilePath } from "../src/file-utils.js";
import { setupTestEnv, restoreTestEnv } from "./helpers/env-helpers.js";

describe("Resume service", () => {
  beforeEach(async () => {
    await setupTestEnv();
  });

  afterEach(async () => {
    await restoreTestEnv();
  });

  async function createResume(id: string, name: string): Promise<void> {
    await mkdir(getResumeDir(id), { recursive: true });
    await writeFile(
      getResumeFilePath(id, "options"),
      JSON.stringify({ template: "default", theme: "default" }),
      "utf-8"
    );
    await writeFile(getResumeFilePath(id, "html"), `<p>${name}</p>`, "utf-8");
  }

  describe("listResumes", () => {
    it("should return an empty array when nothing is stored", async () => {
      expect(await listResumes()).toEqual([]);
    });

    it("should list the stored resumes", async () => {
      await createResume("r1", "A");
      await createResume("r2", "B");

      const resumes = await listResumes();
      expect(resumes).toHaveLength(2);
      expect(resumes.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
    });

    it("should not expose a format field", async () => {
      await createResume("r1", "A");
      const [resume] = await listResumes();
      expect(resume).not.toHaveProperty("format");
      expect(resume.template).toBe("default");
      expect(resume.theme).toBe("default");
      expect(resume.sizeBytes).toBeGreaterThan(0);
    });

    it("should sort by modification time, newest first", async () => {
      await createResume("older", "A");
      await createResume("newer", "B");

      const older = new Date(Date.now() - 60_000);
      await utimes(getResumeFilePath("older", "html"), older, older);

      const resumes = await listResumes();
      expect(resumes[0].id).toBe("newer");
    });

    it("should skip directories whose name is not a valid id", async () => {
      await mkdir(join(getResumeDir("r1"), "..", "not valid!"), { recursive: true });
      await createResume("r1", "A");

      const resumes = await listResumes();
      expect(resumes.map((r) => r.id)).toEqual(["r1"]);
    });
  });

  describe("getResumeInfo", () => {
    it("should return the info of an existing resume", async () => {
      await createResume("r1", "A");
      const info = await getResumeInfo("r1");
      expect(info?.id).toBe("r1");
      expect(info?.template).toBe("default");
    });

    it("should return null for a missing resume", async () => {
      expect(await getResumeInfo("never-existed")).toBeNull();
    });

    it("should return null for an invalid id", async () => {
      expect(await getResumeInfo("../escape")).toBeNull();
    });

    it("should return null when the resume has no artifact yet", async () => {
      await mkdir(getResumeDir("empty"), { recursive: true });
      expect(await getResumeInfo("empty")).toBeNull();
    });
  });

  describe("deleteResume", () => {
    it("should remove the resume directory", async () => {
      await createResume("r1", "A");
      await deleteResume("r1");
      expect(await getResumeInfo("r1")).toBeNull();
    });

    it("should remove a workspace that contains a subdirectory", async () => {
      await createResume("r1", "A");
      await mkdir(join(getResumeDir("r1"), "nested"), { recursive: true });
      await writeFile(join(getResumeDir("r1"), "nested", "file.txt"), "x", "utf-8");

      // The diagram equivalent used readdir + unlink + rmdir, which throws on a
      // subdirectory; the resume path must not.
      await expect(deleteResume("r1")).resolves.toBeUndefined();
      expect(await getResumeInfo("r1")).toBeNull();
    });

    it("should throw when the resume does not exist", async () => {
      await expect(deleteResume("never-existed")).rejects.toThrow("Resume not found");
    });
  });
});
