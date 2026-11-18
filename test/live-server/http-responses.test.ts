import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { resetServerState, mockFetch } from "./server-setup.js";
import { ensureLiveServer, addLiveSession, closeLiveServer } from "../../src/live-server.js";
import { SESSION_NAMESPACES } from "../../src/constants.js";

let configDir: string;
let tempDir: string;

describe("Live server responses", () => {
  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "resume-preview-config-test-"));
    process.env.XDG_CONFIG_HOME = configDir;

    tempDir = await mkdtemp(join(tmpdir(), "resume-preview-test-"));
    await closeLiveServer();
    resetServerState();
  });

  afterEach(async () => {
    await closeLiveServer();
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await rm(configDir, { recursive: true, force: true }).catch(() => {});
    delete process.env.XDG_CONFIG_HOME;
    resetServerState();
  });

  it("includes CSP headers", async () => {
    const port = await ensureLiveServer();
    const slug = "csp-test";

    const resumeDir = join(configDir, "resume-preview", "resumes", slug);
    await mkdir(resumeDir, { recursive: true });
    const htmlPath = join(resumeDir, "resume.html");

    await writeFile(htmlPath, "<p>test</p>", "utf-8");

    await addLiveSession(slug, htmlPath, SESSION_NAMESPACES.RESUME);

    const response = await mockFetch(`http://localhost:${port}/resume/${slug}`);
    const cspHeader = response.headers.get("content-security-policy");

    expect(cspHeader).toBeTruthy();
    expect(cspHeader).toContain("default-src 'none'");
    expect(cspHeader).toContain("script-src 'self'");
    expect(cspHeader).toContain("style-src 'self' 'unsafe-inline'");
    expect(cspHeader).toContain("img-src 'self' data: blob:");
    expect(cspHeader).toContain("connect-src 'self' ws://localhost:*");
  });

  it("returns 404 for a path that is not a resume route", async () => {
    const port = await ensureLiveServer();
    const response = await mockFetch(`http://localhost:${port}/view/anything`);
    expect(response.status).toBe(404);
  });

  it("no longer serves the removed diagram endpoints", async () => {
    const port = await ensureLiveServer();

    for (const path of ["/view/x", "/export/x", "/mermaid-live/x", "/api/diagrams", "/style.css"]) {
      const response = await mockFetch(`http://localhost:${port}${path}`);
      expect(response.status).toBe(404);
    }
  });
});
