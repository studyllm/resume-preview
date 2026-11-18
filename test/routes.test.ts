/**
 * Unit tests for routes.ts
 * Tests HTTP route handling logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  matchRoute,
  handleGallery,
  handleSharedCss,
  handleGalleryCss,
  handleGalleryJs,
  ROUTE_CONFIG,
} from "../src/routes.js";
import { ROUTES, RESUME_ROUTES } from "../src/constants.js";
import type { RouteContext } from "../src/types.js";
import { IncomingMessage, ServerResponse } from "http";
import * as pageRenderer from "../src/page-renderer.js";
describe("Routes", () => {
  describe("matchRoute", () => {
    it("should match exact root route", () => {
      const route = matchRoute("/");
      expect(route).not.toBeNull();
      expect(route!.path).toBe(ROUTES.ROOT);
    });

    it("should match shared CSS route", () => {
      const route = matchRoute("/shared.css");
      expect(route).not.toBeNull();
      expect(route!.path).toBe(ROUTES.SHARED_STYLE);
    });

    it("should match gallery CSS route", () => {
      const route = matchRoute("/gallery.css");
      expect(route).not.toBeNull();
      expect(route!.path).toBe(ROUTES.GALLERY_STYLE);
    });

    it("should match gallery JS route", () => {
      const route = matchRoute("/gallery.js");
      expect(route).not.toBeNull();
      expect(route!.path).toBe(ROUTES.GALLERY_SCRIPT);
    });

    it("should return null for unmatched routes", () => {
      const route = matchRoute("/nonexistent");
      expect(route).toBeNull();
    });

    it("should not match similar but different routes", () => {
      const route = matchRoute("/api/resume"); // Missing 's'
      expect(route).toBeNull();
    });

    it("should handle routes with query parameters", () => {
      // The resume API collection is matched exactly, so a query string
      // turns the URL into something the route table does not match.
      const routeWithQuery = matchRoute("/api/resumes?search=test");
      expect(routeWithQuery).toBeNull();

      const route = matchRoute("/api/resumes");
      expect(route).not.toBeNull();
      expect(route!.path).toBe(RESUME_ROUTES.API);
    });
  });

  describe("ROUTE_CONFIG", () => {
    it("should have all required routes configured", () => {
      const paths = ROUTE_CONFIG.map((r) => r.path);
      expect(paths).toContain(ROUTES.ROOT);
      expect(paths).toContain(ROUTES.SHARED_STYLE);
      expect(paths).toContain(ROUTES.GALLERY_STYLE);
      expect(paths).toContain(ROUTES.GALLERY_SCRIPT);
    });

    it("should have handlers for all routes", () => {
      ROUTE_CONFIG.forEach((route) => {
        expect(route.handler).toBeDefined();
        expect(typeof route.handler).toBe("function");
      });
    });

    it("should mark routes as exact match where appropriate", () => {
      const rootRoute = ROUTE_CONFIG.find((r) => r.path === ROUTES.ROOT);
      expect(rootRoute!.exact).toBe(true);
    });
  });

  describe("Handler Functions", () => {
    let mockReq: IncomingMessage;
    let mockRes: ServerResponse;
    let responseData: string;
    let responseHeaders: Record<string, string>;
    let statusCode: number;

    beforeEach(() => {
      // Create mock request
      mockReq = {
        url: "/",
        method: "GET",
        headers: {},
      } as IncomingMessage;

      // Create mock response with capturing methods
      responseData = "";
      responseHeaders = {};
      statusCode = 200;

      mockRes = {
        writeHead: vi.fn((code: number, headers?: Record<string, string>) => {
          statusCode = code;
          if (headers) {
            Object.assign(responseHeaders, headers);
          }
        }),
        end: vi.fn((data?: string) => {
          if (data) responseData += data;
        }),
        write: vi.fn((data: string) => {
          responseData += data;
        }),
      } as unknown as ServerResponse;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe("handleGallery", () => {
      it("should render gallery page with correct content type", async () => {
        vi.spyOn(pageRenderer, "renderPage").mockResolvedValue("<html>Gallery Page</html>");
        const context: RouteContext = { req: mockReq, res: mockRes, url: "/", port: 3737 };

        await handleGallery(context);

        expect(statusCode).toBe(200);
        expect(responseHeaders["Content-Type"]).toBe("text/html");
        expect(responseHeaders["Content-Security-Policy"]).toBeDefined();
        expect(responseData).toContain("Gallery Page");
      });

      it("should pass correct port to template", async () => {
        const renderSpy = vi.spyOn(pageRenderer, "renderPage").mockResolvedValue("<html></html>");
        const context: RouteContext = { req: mockReq, res: mockRes, url: "/", port: 3740 };

        await handleGallery(context);

        expect(renderSpy).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ PORT: 3740 }),
          expect.any(Object)
        );
      });

      it("should handle rendering errors gracefully", async () => {
        vi.spyOn(pageRenderer, "renderPage").mockRejectedValue(new Error("Template not found"));
        const context: RouteContext = { req: mockReq, res: mockRes, url: "/", port: 3737 };

        await handleGallery(context);

        expect(statusCode).toBe(500);
        expect(responseHeaders["Content-Type"]).toBe("text/plain");
        expect(responseData).toContain("Error loading gallery");
      });
    });

    describe("Static Asset Handlers", () => {
      it("handleSharedCss should serve CSS file", async () => {
        const context: RouteContext = {
          req: mockReq,
          res: mockRes,
          url: "/shared.css",
          port: 3737,
        };

        await handleSharedCss(context);

        expect(statusCode).toBe(200);
        expect(responseHeaders["Content-Type"]).toBe("text/css");
        expect(responseData).toContain("/* ===== Base Styles ===== */");
        expect(responseData).toContain("body {");
      });

      it("handleGalleryCss should serve CSS file", async () => {
        const context: RouteContext = {
          req: mockReq,
          res: mockRes,
          url: "/gallery.css",
          port: 3737,
        };

        await handleGalleryCss(context);

        expect(statusCode).toBe(200);
        expect(responseHeaders["Content-Type"]).toBe("text/css");
        expect(responseData).toContain(".gallery-grid");
        expect(responseData).toContain("grid-template-columns");
      });

      it("handleGalleryJs should serve JavaScript file", async () => {
        const context: RouteContext = {
          req: mockReq,
          res: mockRes,
          url: "/gallery.js",
          port: 3737,
        };

        await handleGalleryJs(context);

        expect(statusCode).toBe(200);
        expect(responseHeaders["Content-Type"]).toBe("application/javascript");
        expect(responseData).toContain("function renderGallery");
        expect(responseData).toContain("loadResumes");
      });
    });
  });
  describe("resume routes", () => {
    it("should register the resume API and static assets", () => {
      const paths = ROUTE_CONFIG.map((r) => r.path);
      expect(paths).toContain(RESUME_ROUTES.API);
      expect(paths).toContain(RESUME_ROUTES.API_ITEM);
      expect(paths).toContain(RESUME_ROUTES.STYLE);
      expect(paths).toContain(RESUME_ROUTES.SCRIPT);
    });

    it("should match the resume collection exactly", () => {
      expect(matchRoute("/api/resumes")?.path).toBe(RESUME_ROUTES.API);
      expect(matchRoute("/api/resumes/r1")?.path).toBe(RESUME_ROUTES.API_ITEM);
    });

    it("should not route the removed diagram API", () => {
      expect(matchRoute("/api/diagrams")).toBeNull();
      expect(matchRoute("/api/diagrams/r1")).toBeNull();
    });
  });
});
