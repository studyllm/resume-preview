import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { migrateLegacyAppDir, getAppDir, getConfigDir } from "../src/file-utils.js";
import { LEGACY_APP_NAME, APP_NAME } from "../src/constants.js";

/**
 * The project was renamed from `claude-mermaid` to `resume-preview`. The data
 * directory is named after the app, so it has to be migrated once, on startup.
 */
describe("migrateLegacyAppDir", () => {
  let configDir: string;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "resume-preview-migration-"));
    process.env.XDG_CONFIG_HOME = configDir;
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleError.mockRestore();
    delete process.env.XDG_CONFIG_HOME;
    await rm(configDir, { recursive: true, force: true }).catch(() => {});
  });

  it("does nothing when neither directory exists", async () => {
    await migrateLegacyAppDir();

    expect(existsSync(getAppDir())).toBe(false);
    expect(existsSync(join(getConfigDir(), LEGACY_APP_NAME))).toBe(false);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("renames the legacy directory when the current one is missing", async () => {
    const legacyDir = join(getConfigDir(), LEGACY_APP_NAME);
    await mkdir(join(legacyDir, "resumes"), { recursive: true });
    await writeFile(join(legacyDir, "resumes", "resume.json"), "{}");

    await migrateLegacyAppDir();

    expect(existsSync(legacyDir)).toBe(false);
    expect(existsSync(join(getAppDir(), "resumes", "resume.json"))).toBe(true);
    expect(await readFile(join(getAppDir(), "resumes", "resume.json"), "utf-8")).toBe("{}");
  });

  it("merges the legacy directory into the current one when both exist", async () => {
    const legacyDir = join(getConfigDir(), LEGACY_APP_NAME);
    await mkdir(join(legacyDir, "resumes", "old-resume"), { recursive: true });
    await writeFile(join(legacyDir, "resumes", "old-resume", "resume.json"), "{}");
    await mkdir(getAppDir(), { recursive: true });
    await writeFile(join(getAppDir(), "new.txt"), "new");

    await migrateLegacyAppDir();

    // Legacy content is merged in, not orphaned in the old directory.
    expect(existsSync(join(getAppDir(), "resumes", "old-resume", "resume.json"))).toBe(true);
    expect(existsSync(join(getAppDir(), "new.txt"))).toBe(true);
    expect(existsSync(legacyDir)).toBe(false);
  });

  it("keeps the current file when both directories hold the same name", async () => {
    const legacyDir = join(getConfigDir(), LEGACY_APP_NAME);
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "same.txt"), "from legacy");
    await mkdir(getAppDir(), { recursive: true });
    await writeFile(join(getAppDir(), "same.txt"), "from current");

    await migrateLegacyAppDir();

    expect(await readFile(join(getAppDir(), "same.txt"), "utf-8")).toBe("from current");
  });

  it("never throws when the migration cannot complete", async () => {
    // A file (not a directory) sitting where the app directory should be
    // makes both rename and copy fail — the server must still start.
    await writeFile(getAppDir(), "not a directory");
    await mkdir(join(getConfigDir(), LEGACY_APP_NAME), { recursive: true });

    await expect(migrateLegacyAppDir()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });

  it("uses the current app name and keeps the legacy name available", () => {
    expect(APP_NAME).toBe("resume-preview");
    expect(LEGACY_APP_NAME).toBe("claude-mermaid");
    expect(getAppDir()).toBe(join(getConfigDir(), APP_NAME));
  });
});
