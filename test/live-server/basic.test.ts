import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, unlink, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { resetServerState } from "./server-setup.js";
import {
  ensureLiveServer,
  addLiveSession,
  hasActiveConnections,
  escapeHtml,
  closeLiveServer,
} from "../../src/live-server.js";

let configDir: string;
let tempDir: string;
let testFilePath: string;

describe("Live server basics", () => {
  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "resume-preview-config-test-"));
    process.env.XDG_CONFIG_HOME = configDir;

    tempDir = await mkdtemp(join(tmpdir(), "resume-preview-test-"));
    testFilePath = join(tempDir, "test-resume.html");
    await writeFile(testFilePath, "<p>test</p>", "utf-8");

    await closeLiveServer();
    resetServerState();
  });

  afterEach(async () => {
    await closeLiveServer();

    try {
      await unlink(testFilePath);
    } catch {}

    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await rm(configDir, { recursive: true, force: true }).catch(() => {});

    delete process.env.XDG_CONFIG_HOME;
    resetServerState();
  });

  it("returns a valid port", async () => {
    const port = await ensureLiveServer();
    expect(port).toBeGreaterThanOrEqual(3737);
    expect(port).toBeLessThanOrEqual(3747);
  });

  it("returns the same port on subsequent calls", async () => {
    const port1 = await ensureLiveServer();
    const port2 = await ensureLiveServer();
    expect(port1).toBe(port2);
  });

  it("adds a session without throwing", async () => {
    await expect(addLiveSession("resume-1", testFilePath)).resolves.not.toThrow();
  });

  it("handles multiple sessions", async () => {
    await addLiveSession("resume-1", testFilePath);
    await addLiveSession("resume-2", testFilePath);

    expect(hasActiveConnections("resume-1")).toBe(false);
    expect(hasActiveConnections("resume-2")).toBe(false);
  });

  it("replaces an existing session", async () => {
    const id = "replace-test";
    await addLiveSession(id, testFilePath);
    await addLiveSession(id, testFilePath);
    expect(hasActiveConnections(id)).toBe(false);
  });

  it("reports no connections for an unknown session", () => {
    expect(hasActiveConnections("non-existent")).toBe(false);
  });

  it("reports no connections for a newly added session", async () => {
    const id = "new-resume";
    await addLiveSession(id, testFilePath);
    expect(hasActiveConnections(id)).toBe(false);
  });

  it("escapes HTML entities", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });
});
