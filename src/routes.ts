/**
 * Route Handlers
 * Single Responsibility: HTTP route handling logic
 * Open/Closed: Easy to add new routes without modifying existing handlers
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { RouteContext } from "./types.js";
import { renderPage } from "./page-renderer.js";
import { listResumes, deleteResume } from "./resume-service.js";
import {
  ROUTES,
  RESUME_ROUTES,
  I18N_ROUTES,
  CONTENT_TYPES,
  CSP_HEADER,
  CACHE_CONTROL,
  TEMPLATE_FILES,
  ASSET_FILES,
  I18N_FILE_SUFFIX,
} from "./constants.js";
import { webLogger } from "./logger.js";
import { getDictionary, isSupportedLocale, resolveLocale } from "./i18n.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PREVIEW_DIR = join(__dirname, "preview");

/**
 * Serves a static file
 */
async function serveStaticFile(
  filePath: string,
  contentType: string,
  cacheControl: string = CACHE_CONTROL.NO_STORE
): Promise<{ content: Buffer | string; contentType: string; cacheControl: string }> {
  const content = await readFile(filePath, contentType.includes("text") ? "utf-8" : null);
  return { content, contentType, cacheControl };
}

/**
 * Reads a query parameter from a raw request URL.
 *
 * @param rawUrl The full request URL, query string included
 * @param name Name of the parameter
 * @returns The value, or undefined when the parameter is absent
 */
export function getQueryParam(rawUrl: string | undefined, name: string): string | undefined {
  if (!rawUrl) return undefined;
  const queryStart = rawUrl.indexOf("?");
  if (queryStart === -1) return undefined;
  return new URLSearchParams(rawUrl.slice(queryStart + 1)).get(name) ?? undefined;
}

/**
 * Gallery Page Handler
 * Renders the main gallery page
 */
export async function handleGallery(context: RouteContext): Promise<void> {
  const { req, res, port, url } = context;

  try {
    webLogger.debug("Gallery page request");

    const locale = resolveLocale({
      query: getQueryParam(req.url, "lang"),
      acceptLanguage: req.headers["accept-language"],
    });

    const html = await renderPage(
      TEMPLATE_FILES.GALLERY,
      { PORT: port },
      {
        titleKey: "gallery.pageTitle",
        styles: [ROUTES.SHARED_STYLE, ROUTES.GALLERY_STYLE],
        scripts: [ROUTES.GALLERY_SCRIPT],
        includeNav: false, // Gallery has its own header
        includeFooter: false,
        locale,
        path: url,
      }
    );

    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES.HTML,
      "Content-Security-Policy": CSP_HEADER,
      "Content-Language": locale,
    });
    res.end(html);

    webLogger.info(`Served gallery page (${locale})`);
  } catch (error) {
    webLogger.error("Failed to serve gallery page", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.writeHead(500, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end(`Error loading gallery: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * i18n: serves a locale dictionary to the browser.
 *
 * The locale comes from the URL, so it is checked against the whitelist
 * before it is used — the value never reaches a file path unvalidated.
 */
export async function handleI18nDictionary(context: RouteContext): Promise<void> {
  const { res, url } = context;

  const raw = url.substring(I18N_ROUTES.DICTIONARY.length);
  if (!raw.endsWith(I18N_FILE_SUFFIX)) {
    res.writeHead(404, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end("Not found");
    return;
  }

  const locale = raw.slice(0, -I18N_FILE_SUFFIX.length);
  if (!isSupportedLocale(locale)) {
    webLogger.warn(`Rejected dictionary request for unknown locale: ${locale}`);
    res.writeHead(404, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end("Not found");
    return;
  }

  try {
    const dictionary = await getDictionary(locale);
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES.JSON,
      "Content-Security-Policy": CSP_HEADER,
      "Cache-Control": CACHE_CONTROL.NO_STORE,
    });
    res.end(JSON.stringify(dictionary));
  } catch (error) {
    webLogger.error(`Failed to serve dictionary for locale: ${locale}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    res.writeHead(500, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end("Failed to load dictionary");
  }
}

/**
 * API: List Resumes
 * Returns a JSON list of all stored resumes
 */
export async function handleApiResumes(context: RouteContext): Promise<void> {
  const { res } = context;

  try {
    webLogger.debug("API request: list resumes");

    const resumes = await listResumes();

    const response = {
      resumes,
      count: resumes.length,
    };

    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES.JSON,
      "Cache-Control": CACHE_CONTROL.NO_STORE,
    });
    res.end(JSON.stringify(response));

    webLogger.info(`API: Listed ${resumes.length} resumes`);
  } catch (error) {
    webLogger.error("API error: list resumes", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.writeHead(500, { "Content-Type": CONTENT_TYPES.JSON });
    res.end(
      JSON.stringify({
        error: "Failed to list resumes",
        message: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

/**
 * API: Delete Resume
 * Handles deletion of an individual resume
 */
export async function handleApiResumeDelete(context: RouteContext): Promise<void> {
  const { req, res, url } = context;

  const deleteMatch = url.match(/^\/api\/resumes\/([^\/]+)$/);
  if (!deleteMatch) {
    res.writeHead(404, { "Content-Type": CONTENT_TYPES.JSON });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  if (req.method !== "DELETE") {
    res.writeHead(405, { "Content-Type": CONTENT_TYPES.JSON });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const resumeId = deleteMatch[1];

  try {
    webLogger.debug(`API request: delete resume ${resumeId}`);

    if (!/^[a-zA-Z0-9_-]+$/.test(resumeId)) {
      res.writeHead(400, { "Content-Type": CONTENT_TYPES.JSON });
      res.end(JSON.stringify({ error: "Invalid resume ID" }));
      return;
    }

    await deleteResume(resumeId);

    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES.JSON,
      "Cache-Control": CACHE_CONTROL.NO_STORE,
    });
    res.end(JSON.stringify({ success: true }));

    webLogger.info(`API: Deleted resume ${resumeId}`);
  } catch (error) {
    webLogger.error("API error: delete resume", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.writeHead(500, { "Content-Type": CONTENT_TYPES.JSON });
    res.end(
      JSON.stringify({
        error: "Failed to delete resume",
        message: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

/**
 * Static Asset Handlers
 */
export async function handleSharedCss(context: RouteContext): Promise<void> {
  const { res } = context;
  try {
    const { content, contentType, cacheControl } = await serveStaticFile(
      join(PREVIEW_DIR, ASSET_FILES.SHARED_STYLE),
      CONTENT_TYPES.CSS
    );
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    });
    res.end(content);
  } catch (error) {
    webLogger.error("Failed to serve shared.css", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.writeHead(404, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end("Not found");
  }
}

export async function handleGalleryCss(context: RouteContext): Promise<void> {
  const { res } = context;
  try {
    const { content, contentType, cacheControl } = await serveStaticFile(
      join(PREVIEW_DIR, ASSET_FILES.GALLERY_STYLE),
      CONTENT_TYPES.CSS
    );
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    });
    res.end(content);
  } catch (error) {
    webLogger.error("Failed to serve gallery.css", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.writeHead(404, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end("Not found");
  }
}

export async function handleGalleryJs(context: RouteContext): Promise<void> {
  const { res } = context;
  try {
    const { content, contentType, cacheControl } = await serveStaticFile(
      join(PREVIEW_DIR, ASSET_FILES.GALLERY_SCRIPT),
      CONTENT_TYPES.JAVASCRIPT
    );
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    });
    res.end(content);
  } catch (error) {
    webLogger.error("Failed to serve gallery.js", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.writeHead(404, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end("Not found");
  }
}

export async function handleResumeCss(context: RouteContext): Promise<void> {
  const { res } = context;
  try {
    const { content, contentType, cacheControl } = await serveStaticFile(
      join(PREVIEW_DIR, ASSET_FILES.RESUME_STYLE),
      CONTENT_TYPES.CSS
    );
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    });
    res.end(content);
  } catch (error) {
    webLogger.error("Failed to serve resume.css", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.writeHead(404, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end("Not found");
  }
}

export async function handleResumeJs(context: RouteContext): Promise<void> {
  const { res } = context;
  try {
    const { content, contentType, cacheControl } = await serveStaticFile(
      join(PREVIEW_DIR, ASSET_FILES.RESUME_SCRIPT),
      CONTENT_TYPES.JAVASCRIPT
    );
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    });
    res.end(content);
  } catch (error) {
    webLogger.error("Failed to serve resume.js", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.writeHead(404, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end("Not found");
  }
}

export async function handleI18nScript(context: RouteContext): Promise<void> {
  const { res } = context;
  try {
    const { content, contentType, cacheControl } = await serveStaticFile(
      join(PREVIEW_DIR, ASSET_FILES.I18N_SCRIPT),
      CONTENT_TYPES.JAVASCRIPT
    );
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    });
    res.end(content);
  } catch (error) {
    webLogger.error("Failed to serve i18n.js", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.writeHead(404, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end("Not found");
  }
}

/**
 * Route Configuration
 * Maps routes to their handlers
 */
export interface Route {
  path: string;
  exact?: boolean;
  handler: (context: RouteContext) => Promise<void>;
}

export const ROUTE_CONFIG: Route[] = [
  { path: ROUTES.ROOT, exact: true, handler: handleGallery },
  { path: ROUTES.SHARED_STYLE, exact: true, handler: handleSharedCss },
  { path: ROUTES.GALLERY_STYLE, exact: true, handler: handleGalleryCss },
  { path: ROUTES.GALLERY_SCRIPT, exact: true, handler: handleGalleryJs },
  { path: ROUTES.I18N_SCRIPT, exact: true, handler: handleI18nScript },
  { path: I18N_ROUTES.DICTIONARY, handler: handleI18nDictionary },
  // Resume API. The collection is matched exactly and the item route carries
  // its own trailing slash, so "/api/resumesXYZ" cannot reach these handlers.
  { path: RESUME_ROUTES.API, exact: true, handler: handleApiResumes },
  { path: RESUME_ROUTES.API_ITEM, handler: handleApiResumeDelete },
  { path: RESUME_ROUTES.STYLE, exact: true, handler: handleResumeCss },
  { path: RESUME_ROUTES.SCRIPT, exact: true, handler: handleResumeJs },
];

/**
 * Matches a URL to a route configuration
 * @param url Request URL
 * @returns Matched route or null
 */
export function matchRoute(url: string): Route | null {
  for (const route of ROUTE_CONFIG) {
    if (route.exact) {
      if (url === route.path) {
        return route;
      }
    } else {
      if (url.startsWith(route.path)) {
        return route;
      }
    }
  }
  return null;
}
