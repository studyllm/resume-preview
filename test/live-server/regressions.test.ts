import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { resetServerState, mockFetch } from "./server-setup.js";
import {
  ensureLiveServer,
  addLiveSession,
  closeLiveServer,
  getPathname,
} from "../../src/live-server.js";
import { deleteResume } from "../../src/resume-service.js";
import { SESSION_NAMESPACES } from "../../src/constants.js";

let configDir: string;

async function createResumeFiles(slug: string): Promise<string> {
  const resumeDir = join(configDir, "resume-preview", "resumes", slug);
  await mkdir(resumeDir, { recursive: true });
  await writeFile(join(resumeDir, "resume.html"), "<p>test</p>", "utf-8");
  await writeFile(join(resumeDir, "resume.json"), '{"basics":{"name":"test"}}', "utf-8");
  return resumeDir;
}

describe("Regression: live server robustness", () => {
  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "resume-preview-regression-"));
    process.env.XDG_CONFIG_HOME = configDir;
    await closeLiveServer();
    resetServerState();
  });

  afterEach(async () => {
    await closeLiveServer();
    await rm(configDir, { recursive: true, force: true }).catch(() => {});
    delete process.env.XDG_CONFIG_HOME;
    resetServerState();
  });

  describe("getPathname", () => {
    it("returns the pathname unchanged when there is no query string", () => {
      expect(getPathname("/api/resumes")).toBe("/api/resumes");
      expect(getPathname("/resume/view/architecture")).toBe("/resume/view/architecture");
    });

    it("strips the query string", () => {
      expect(getPathname("/api/resumes?foo=1")).toBe("/api/resumes");
      expect(getPathname("/resume/view/architecture?x=1")).toBe("/resume/view/architecture");
      expect(getPathname("/gallery.css?v=2")).toBe("/gallery.css");
    });

    it("strips the fragment", () => {
      expect(getPathname("/api/resumes#frag")).toBe("/api/resumes");
    });

    it("falls back to / for empty or missing input", () => {
      expect(getPathname("")).toBe("/");
      expect(getPathname(undefined)).toBe("/");
      expect(getPathname("?only=query")).toBe("/");
    });
  });

  describe("query strings do not break routing", () => {
    it("serves the resume API list with a query string", async () => {
      await ensureLiveServer();
      const response = await mockFetch("http://localhost:3737/api/resumes?cacheBust=1");
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(Array.isArray(payload.resumes)).toBe(true);
    });

    it("serves the gallery with a query string", async () => {
      await ensureLiveServer();
      const response = await mockFetch("http://localhost:3737/?cacheBust=1");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html");
    });

    it("serves gallery assets with a query string", async () => {
      await ensureLiveServer();
      const response = await mockFetch("http://localhost:3737/gallery.css?v=2");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/css");
    });

    it("serves the resume preview with a query string", async () => {
      const port = await ensureLiveServer();
      const slug = "qs-view";
      const resumeDir = await createResumeFiles(slug);
      await addLiveSession(slug, join(resumeDir, "resume.html"), SESSION_NAMESPACES.RESUME);

      const response = await mockFetch(`http://localhost:${port}/resume/${slug}?x=1`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html");
    });
  });

  describe("deleting a watched resume does not crash the server", () => {
    it("survives deleting the workspace of a watched resume", async () => {
      await ensureLiveServer();
      const slug = "delete-crash";
      const resumeDir = await createResumeFiles(slug);
      await addLiveSession(slug, join(resumeDir, "resume.html"), SESSION_NAMESPACES.RESUME);

      // Deleting the watched file makes the fs watcher emit an 'error' event.
      // Unhandled, that event terminates the Node process.
      await expect(deleteResume(slug)).resolves.toBeUndefined();

      // Give the watcher a chance to emit its error event.
      await new Promise((resolve) => setTimeout(resolve, 300));

      // The server is still able to serve requests.
      const response = await mockFetch("http://localhost:3737/api/resumes");
      expect(response.status).toBe(200);
    });

    it("keeps serving requests after a resume is deleted over HTTP", async () => {
      const port = await ensureLiveServer();
      const slug = "delete-http";
      const resumeDir = await createResumeFiles(slug);
      await addLiveSession(slug, join(resumeDir, "resume.html"), SESSION_NAMESPACES.RESUME);

      const response = await mockFetch(`http://localhost:${port}/api/resumes/${slug}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 300));

      const list = await mockFetch(`http://localhost:${port}/api/resumes`);
      expect(list.status).toBe(200);
      const payload = await list.json();
      expect(payload.resumes).toHaveLength(0);
    });

    it("stops watching a resume whose file was removed", async () => {
      await ensureLiveServer();
      const slug = "watch-removed";
      const resumeDir = await createResumeFiles(slug);
      const htmlPath = join(resumeDir, "resume.html");
      await addLiveSession(slug, htmlPath, SESSION_NAMESPACES.RESUME);

      await unlink(htmlPath).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 300));

      // The resume no longer resolves to a file, so the view request 404s
      // instead of serving stale content.
      const response = await mockFetch(`http://localhost:3737/resume/view/${slug}`);
      expect(response.status).toBe(404);
    });
  });
});
