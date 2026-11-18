import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import {
  getResumesDir,
  getConfigDir,
  validatePreviewId,
  validateSavePath,
} from "../src/file-utils.js";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { setupTestEnv, restoreTestEnv } from "./helpers/env-helpers.js";

// The resume path helpers have their own suite: test/resume-file-utils.test.ts
import { normalizeSeparators, isWindowsPlatform } from "./helpers/path-helpers.js";

describe("File Utilities", () => {
  beforeAll(async () => {
    await setupTestEnv();
  });

  afterAll(async () => {
    await restoreTestEnv();
  });
  describe("getResumesDir", () => {
    it("should return path containing .config/resume-preview/resumes", () => {
      const resumesDir = getResumesDir();
      expect(resumesDir).toContain(".config");
      expect(resumesDir).toContain("resume-preview");
      expect(resumesDir).toContain("resumes");
    });

    it("should return consistent path on multiple calls", () => {
      expect(getResumesDir()).toBe(getResumesDir());
    });

    it("should derive from config dir based on env", () => {
      const resumesDir = getResumesDir();
      const homeDir = process.env.HOME || process.env.USERPROFILE || tmpdir();
      const expectedRoot = process.env.XDG_CONFIG_HOME || join(homeDir, ".config");
      expect(resumesDir).toContain(expectedRoot);
    });
  });

  describe("validatePreviewId", () => {
    it("should accept valid alphanumeric IDs", () => {
      expect(() => validatePreviewId("resume123")).not.toThrow();
      expect(() => validatePreviewId("front-end")).not.toThrow();
      expect(() => validatePreviewId("my_resume")).not.toThrow();
      expect(() => validatePreviewId("Resume-123_test")).not.toThrow();
    });

    it("should reject empty or whitespace-only IDs", () => {
      expect(() => validatePreviewId("")).toThrow("Invalid preview ID format");
      expect(() => validatePreviewId("   ")).toThrow("Invalid preview ID format");
    });

    it("should reject path traversal attempts", () => {
      expect(() => validatePreviewId("../etc/passwd")).toThrow("Invalid preview ID format");
      expect(() => validatePreviewId("..")).toThrow("Invalid preview ID format");
      expect(() => validatePreviewId("foo/../bar")).toThrow("Invalid preview ID format");
    });

    it("should reject absolute paths", () => {
      expect(() => validatePreviewId("/etc/passwd")).toThrow("Invalid preview ID format");
      expect(() => validatePreviewId("/tmp/resume")).toThrow("Invalid preview ID format");
    });

    it("should reject IDs with path separators", () => {
      expect(() => validatePreviewId("foo/bar")).toThrow("Invalid preview ID format");
      expect(() => validatePreviewId("foo\\bar")).toThrow("Invalid preview ID format");
    });

    it("should reject IDs with special characters", () => {
      expect(() => validatePreviewId("resume@123")).toThrow("Invalid preview ID format");
      expect(() => validatePreviewId("test$resume")).toThrow("Invalid preview ID format");
      expect(() => validatePreviewId("my resume")).toThrow("Invalid preview ID format");
      expect(() => validatePreviewId("test;ls")).toThrow("Invalid preview ID format");
    });

    it("should reject IDs with null bytes", () => {
      expect(() => validatePreviewId("test\0resume")).toThrow("Invalid preview ID format");
    });

    it("should reject IDs starting with dot", () => {
      expect(() => validatePreviewId(".hidden")).toThrow("Invalid preview ID format");
      expect(() => validatePreviewId("..secret")).toThrow("Invalid preview ID format");
    });
  });

  describe("getConfigDir precedence", () => {
    let originalXdg: string | undefined;
    let originalHomeLocal: string | undefined;

    beforeEach(() => {
      originalXdg = process.env.XDG_CONFIG_HOME;
      originalHomeLocal = process.env.HOME;
    });

    afterEach(() => {
      if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalXdg;

      if (originalHomeLocal === undefined) delete process.env.HOME;
      else process.env.HOME = originalHomeLocal;
    });

    it("should prefer XDG_CONFIG_HOME when set", async () => {
      const xdgDir = await mkdtemp(join(tmpdir(), "resume-preview-xdg-"));
      process.env.XDG_CONFIG_HOME = xdgDir;

      const cfg = getConfigDir();
      expect(cfg).toBe(xdgDir);

      const resumes = getResumesDir();
      expect(resumes).toBe(join(xdgDir, "resume-preview", "resumes"));
    });

    it("should fallback to HOME/.config when XDG unset", async () => {
      delete process.env.XDG_CONFIG_HOME;
      const tempHome = await mkdtemp(join(tmpdir(), "resume-preview-home-"));
      process.env.HOME = tempHome;

      const cfg = getConfigDir();
      expect(cfg).toBe(join(tempHome, ".config"));

      const resumes = getResumesDir();
      expect(resumes).toBe(join(cfg, "resume-preview", "resumes"));
    });
  });

  describe("validateSavePath", () => {
    it("should allow valid relative paths", () => {
      expect(() => validateSavePath("./diagrams/test.svg")).not.toThrow();
      expect(() => validateSavePath("docs/diagram.png")).not.toThrow();
      expect(() => validateSavePath("../output/diagram.pdf")).not.toThrow();
    });

    it("should allow valid absolute paths", () => {
      expect(() => validateSavePath("/tmp/diagram.svg")).not.toThrow();
      expect(() => validateSavePath("/home/user/diagrams/test.svg")).not.toThrow();
    });

    it("should reject paths with null bytes", () => {
      expect(() => validateSavePath("diagram\0.svg")).toThrow("Path contains null bytes");
      expect(() => validateSavePath("/tmp/\0file.svg")).toThrow("Path contains null bytes");
    });

    it("should reject system directories on the current platform", () => {
      if (isWindowsPlatform()) {
        // Windows branch: protect C:\Windows and C:\Program Files.
        expect(() => validateSavePath("C:\\Windows\\System32\\diagram.svg")).toThrow(
          "Cannot write to system directories"
        );
        expect(() => validateSavePath("C:\\Program Files\\diagram.svg")).toThrow(
          "Cannot write to system directories"
        );
      } else {
        // POSIX branch: protect /etc, /bin, /usr/bin, ...
        expect(() => validateSavePath("/etc/diagram.svg")).toThrow(
          "Cannot write to system directories"
        );
        expect(() => validateSavePath("/bin/diagram.svg")).toThrow(
          "Cannot write to system directories"
        );
        expect(() => validateSavePath("/sbin/diagram.svg")).toThrow(
          "Cannot write to system directories"
        );
        expect(() => validateSavePath("/usr/bin/diagram.svg")).toThrow(
          "Cannot write to system directories"
        );
        expect(() => validateSavePath("/usr/sbin/diagram.svg")).toThrow(
          "Cannot write to system directories"
        );
        expect(() => validateSavePath("/boot/diagram.svg")).toThrow(
          "Cannot write to system directories"
        );
        expect(() => validateSavePath("/sys/diagram.svg")).toThrow(
          "Cannot write to system directories"
        );
        expect(() => validateSavePath("/proc/diagram.svg")).toThrow(
          "Cannot write to system directories"
        );
      }
    });

    // `path.resolve` is bound to the real platform at module load, so faking
    // `process.platform` alone cannot exercise the POSIX branch on Windows.
    it.skipIf(isWindowsPlatform())(
      "should reject Unix system directories when running as POSIX",
      () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, "platform", { value: "linux" });

        try {
          expect(() => validateSavePath("/etc/diagram.svg")).toThrow(
            "Cannot write to system directories"
          );
          expect(() => validateSavePath("/bin/diagram.svg")).toThrow(
            "Cannot write to system directories"
          );
          expect(() => validateSavePath("/usr/bin/diagram.svg")).toThrow(
            "Cannot write to system directories"
          );
        } finally {
          Object.defineProperty(process, "platform", { value: originalPlatform });
        }
      }
    );

    it("should allow paths in user directories", () => {
      expect(() => validateSavePath("/home/user/docs/diagram.svg")).not.toThrow();
      expect(() => validateSavePath("/Users/john/projects/diagram.svg")).not.toThrow();
    });

    it("should allow paths in tmp directory", () => {
      expect(() => validateSavePath("/tmp/diagram.svg")).not.toThrow();
      expect(() => validateSavePath("/var/tmp/test.svg")).not.toThrow();
    });

    it("should handle path traversal attempts in cwd", () => {
      // These should not throw - they resolve to valid paths
      expect(() => validateSavePath("../../diagram.svg")).not.toThrow();
      expect(() => validateSavePath("./../../output/test.svg")).not.toThrow();
    });

    it.skipIf(isWindowsPlatform())("should normalize paths before validation", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux" });

      try {
        // Path traversal that tries to reach /etc
        expect(() => validateSavePath("/tmp/../etc/passwd")).toThrow(
          "Cannot write to system directories"
        );
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform });
      }
    });
  });

  describe("validateSavePath with an expected format", () => {
    it("should accept a matching extension", () => {
      expect(() => validateSavePath("./out.pdf", "pdf")).not.toThrow();
    });

    it("should reject a mismatching extension", () => {
      expect(() => validateSavePath("./out.pdf", "html")).toThrow(/does not match format/);
    });

    it("should keep working when no format is given", () => {
      expect(() => validateSavePath("./out.pdf")).not.toThrow();
    });
  });
});
