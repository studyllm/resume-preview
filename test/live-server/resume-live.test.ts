/**
 * Live server tests for the resume domain
 *
 * Covers the WebSocket path dispatch and the resume preview pages.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
// The mock has to be registered before live-server is loaded
import { mockFetch, resetServerState } from "./server-setup.js";
import {
  ensureLiveServer,
  addLiveSession,
  closeLiveServer,
  resolveSessionFromPath,
} from "../../src/live-server.js";
import { getResumeDir, getResumeFilePath } from "../../src/file-utils.js";
import { SESSION_NAMESPACES } from "../../src/constants.js";
import { setupTestEnv, restoreTestEnv } from "../helpers/env-helpers.js";

describe("Resume live server", () => {
  beforeEach(async () => {
    await setupTestEnv();
    await closeLiveServer();
    resetServerState();
  });

  afterEach(async () => {
    await closeLiveServer();
    await restoreTestEnv();
    resetServerState();
  });

  describe("resolveSessionFromPath", () => {
    it("should resolve a resume path to the resume namespace", () => {
      const session = resolveSessionFromPath("/resume/r-abc");
      expect(session?.namespace).toBe(SESSION_NAMESPACES.RESUME);
      expect(session?.label).toBe("r-abc");
      expect(session?.key).toBe("resume:r-abc");
    });

    it("should return null for a path that is not a resume session", () => {
      expect(resolveSessionFromPath("/architecture")).toBeNull();
      expect(resolveSessionFromPath("/resume")).toBeNull();
    });

    it("should return null for an empty path", () => {
      expect(resolveSessionFromPath("/")).toBeNull();
      expect(resolveSessionFromPath("/resume/")).toBeNull();
    });
  });

  describe("GET /resume/:id", () => {
    it("should return 404 when the resume has no live session", async () => {
      const port = await ensureLiveServer();
      const response = await mockFetch(`http://localhost:${port}/resume/unknown`);
      expect(response.status).toBe(404);
      expect(await response.text()).toContain("Resume not found");
    });

    it("should serve the preview page for a registered resume", async () => {
      const port = await ensureLiveServer();
      const slug = "r-test";

      await mkdir(getResumeDir(slug), { recursive: true });
      await writeFile(getResumeFilePath(slug, "html"), "<p>王小明</p>", "utf-8");

      await addLiveSession(slug, getResumeFilePath(slug, "html"), SESSION_NAMESPACES.RESUME);

      const response = await mockFetch(`http://localhost:${port}/resume/${slug}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");

      const body = await response.text();
      expect(body).toContain("王小明");
      expect(body).toContain(`data-resume-id="${slug}"`);
      expect(body).toContain("/resume.js");
    });
  });

  describe("GET /resume/view/:id", () => {
    it("should serve the static page straight from disk", async () => {
      const port = await ensureLiveServer();
      const slug = "r-static";

      await mkdir(getResumeDir(slug), { recursive: true });
      await writeFile(getResumeFilePath(slug, "html"), "<p>静态页</p>", "utf-8");

      const response = await mockFetch(`http://localhost:${port}/resume/view/${slug}`);
      expect(response.status).toBe(200);

      const body = await response.text();
      expect(body).toContain("静态页");
      expect(body).toContain('data-live-enabled="false"');
    });

    it("should return 404 for a resume that does not exist", async () => {
      const port = await ensureLiveServer();
      const response = await mockFetch(`http://localhost:${port}/resume/view/missing`);
      expect(response.status).toBe(404);
    });
  });

  describe("watcher resilience", () => {
    it("should not crash when the watched resume is deleted", async () => {
      const port = await ensureLiveServer();
      const slug = "r-deleted";

      await mkdir(getResumeDir(slug), { recursive: true });
      await writeFile(getResumeFilePath(slug, "html"), "<p>x</p>", "utf-8");

      await addLiveSession(slug, getResumeFilePath(slug, "html"), SESSION_NAMESPACES.RESUME);

      // Removing the watched file used to raise an unhandled watcher error
      // and take the whole process down.
      await rm(getResumeFilePath(slug, "html"), { force: true });

      const response = await mockFetch(`http://localhost:${port}/resume/${slug}`);
      expect([200, 404, 500]).toContain(response.status);
    });
  });
});
