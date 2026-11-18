/**
 * Unit tests for the resume service and the resume HTTP routes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { getResumeDir } from "../src/file-utils.js";

import { listResumes, deleteResume } from "../src/resume-service.js";

import {
  matchRoute,
  handleApiResumes,
  handleApiResumeDelete,
  handleResumeCss,
  handleResumeJs,
} from "../src/routes.js";
import { RESUME_ROUTES } from "../src/constants.js";
import type { RouteContext } from "../src/types.js";
import { setupTestEnv, restoreTestEnv } from "./helpers/env-helpers.js";

describe("Resume routes", () => {
  beforeEach(async () => {
    await setupTestEnv();
  });

  afterEach(async () => {
    await restoreTestEnv();
    vi.restoreAllMocks();
  });

  function createContext(url: string, method = "GET"): RouteContext {
    const headers = new Map<string, string>();
    let statusCode = 200;
    let body = "";

    const res = {
      writeHead(code: number, headerBag: Record<string, string> = {}) {
        statusCode = code;
        for (const [key, value] of Object.entries(headerBag)) {
          headers.set(key.toLowerCase(), value);
        }
        (res as any).statusCode = statusCode;
      },
      end(chunk?: string | Buffer) {
        if (chunk) body += chunk instanceof Buffer ? chunk.toString("utf-8") : chunk;
        (res as any).body = body;
      },
      get status() {
        return statusCode;
      },
      get headers() {
        return headers;
      },
    } as any;

    return {
      req: { url, method } as any,
      res,
      url,
      port: 3737,
    };
  }

  function readBody(context: RouteContext): string {
    return (context.res as any).body ?? "";
  }

  describe("matchRoute", () => {
    it("should match the resume collection exactly", () => {
      const route = matchRoute("/api/resumes");
      expect(route?.path).toBe(RESUME_ROUTES.API);
    });

    it("should match a single resume", () => {
      const route = matchRoute("/api/resumes/r1");
      expect(route?.path).toBe(RESUME_ROUTES.API_ITEM);
    });

    it("should not let an unrelated path reach the resume routes", () => {
      const route = matchRoute("/api/resumesXYZ");
      expect(route?.path).not.toBe(RESUME_ROUTES.API);
      expect(route?.path).not.toBe(RESUME_ROUTES.API_ITEM);
    });

    it("should match the resume static assets", () => {
      expect(matchRoute("/resume.css")?.path).toBe(RESUME_ROUTES.STYLE);
      expect(matchRoute("/resume.js")?.path).toBe(RESUME_ROUTES.SCRIPT);
    });
  });

  describe("handleApiResumes", () => {
    it("should return a JSON list", async () => {
      vi.spyOn(await import("../src/resume-service.js"), "listResumes").mockResolvedValue([
        {
          id: "r1",
          template: "default",
          theme: "default",
          modifiedAt: new Date(),
          sizeBytes: 10,
        },
      ]);

      const context = createContext("/api/resumes");
      await handleApiResumes(context);

      expect((context.res as any).writeHead).toBeDefined();
      const payload = JSON.parse(readBody(context) || "{}");
      expect(payload.count).toBe(1);
    });
  });

  describe("handleApiResumeDelete", () => {
    it("should reject a method other than DELETE with 405", async () => {
      const context = createContext("/api/resumes/r1", "GET");
      await handleApiResumeDelete(context);
      expect((context.res as any).status).toBe(405);
      expect(JSON.parse(readBody(context))).toEqual({ error: "Method not allowed" });
    });

    it("should return 404 for a path that does not match", async () => {
      const context = createContext("/api/resumes/", "DELETE");
      await handleApiResumeDelete(context);
      expect((context.res as any).status).toBe(404);
      expect(JSON.parse(readBody(context))).toEqual({ error: "Not found" });
    });

    it("should return 400 for an invalid resume id", async () => {
      const context = createContext("/api/resumes/bad%20id", "DELETE");
      await handleApiResumeDelete(context);
      expect((context.res as any).status).toBe(400);
      expect(JSON.parse(readBody(context))).toEqual({ error: "Invalid resume ID" });
    });

    it("should return 500 when the resume does not exist", async () => {
      const context = createContext("/api/resumes/never-existed", "DELETE");
      await handleApiResumeDelete(context);
      expect((context.res as any).status).toBe(500);
      const payload = JSON.parse(readBody(context));
      expect(payload.error).toBe("Failed to delete resume");
      expect(payload.message).toContain("Resume not found");
    });

    it("should delete an existing resume", async () => {
      const resumeDir = getResumeDir("r-del");
      await mkdir(resumeDir, { recursive: true });
      await writeFile(join(resumeDir, "resume.html"), "<p>x</p>", "utf-8");

      const context = createContext("/api/resumes/r-del", "DELETE");
      await handleApiResumeDelete(context);
      expect((context.res as any).status).toBe(200);
      expect(JSON.parse(readBody(context))).toEqual({ success: true });
    });
  });

  describe("handleApiResumes", () => {
    it("should return 500 when listing fails", async () => {
      const service = await import("../src/resume-service.js");
      vi.spyOn(service, "listResumes").mockRejectedValue(new Error("boom"));

      const context = createContext("/api/resumes");
      await handleApiResumes(context);

      expect((context.res as any).status).toBe(500);
      const payload = JSON.parse(readBody(context));
      expect(payload.error).toBe("Failed to list resumes");
      expect(payload.message).toBe("boom");
    });
  });

  describe("static assets", () => {
    it("should serve the resume stylesheet", async () => {
      const context = createContext("/resume.css");
      await handleResumeCss(context);
      expect((context.res as any).writeHead).toBeDefined();
    });

    it("should serve the resume script", async () => {
      const context = createContext("/resume.js");
      await handleResumeJs(context);
      expect((context.res as any).writeHead).toBeDefined();
    });
  });
});
