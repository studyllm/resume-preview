import { createServer, Server as HttpServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { watch, FSWatcher, existsSync } from "fs";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  validateResumeId,
  slugifyResumeId,
  getResumeFilePath,
  loadResumeContent,
  loadResumeOptions,
} from "./file-utils.js";
import {
  createResumeHtmlWrapper,
  renderResumeExportHtml,
  renderResumePdf,
} from "./resume-renderer.js";
import { webLogger } from "./logger.js";
import { getQueryParam, matchRoute } from "./routes.js";
import { resolveLocale } from "./i18n.js";
import { LiveSessionState } from "./types.js";
import { escapeHtml } from "./html-utils.js";

export { escapeHtml };
import {
  CSP_HEADER,
  SERVER_PORT_START,
  SERVER_PORT_END,
  SERVER_HOST,
  ROUTES,
  RESUME_ROUTES,
  CONTENT_TYPES,
  CACHE_CONTROL,
  WS_MESSAGES,
  SESSION_NAMESPACES,
} from "./constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PREVIEW_DIR = join(__dirname, "preview");
const FAVICON_PATH = join(PREVIEW_DIR, "favicon.svg");

let liveServer: HttpServer | null = null;
let liveServerPort: number | null = null;
let wss: WebSocketServer | null = null;
const liveSessions = new Map<string, LiveSessionState>();

/**
 * Session keys are namespaced so a resume and anything else that happens to
 * share an id cannot overwrite each other's live preview session.
 */
function sessionKey(namespace: string, id: string): string {
  return `${namespace}:${id}`;
}

export function resumeSessionKey(id: string): string {
  return sessionKey(SESSION_NAMESPACES.RESUME, id);
}

/**
 * Resolves a WebSocket path to the live session it refers to.
 *
 * Only the "/resume/" prefix is a live session; every other path is unknown.
 */
export function resolveSessionFromPath(
  path: string
): { key: string; label: string; namespace: string } | null {
  if (!path.startsWith(RESUME_ROUTES.LIVE)) {
    return null;
  }

  const resumeId = path.substring(RESUME_ROUTES.LIVE.length);
  if (!resumeId) return null;
  return {
    key: resumeSessionKey(resumeId),
    label: resumeId,
    namespace: SESSION_NAMESPACES.RESUME,
  };
}

/**
 * Extracts the pathname from a request URL, dropping any query string and
 * fragment. Routing decisions are made on the pathname alone.
 */
export function getPathname(rawUrl: string | undefined): string {
  if (!rawUrl) return "/";
  const withoutFragment = rawUrl.split("#")[0];
  const queryStart = withoutFragment.indexOf("?");
  const pathname = queryStart === -1 ? withoutFragment : withoutFragment.slice(0, queryStart);
  return pathname.length > 0 ? pathname : "/";
}

async function findAvailablePort(
  startPort: number = SERVER_PORT_START,
  maxPort: number = SERVER_PORT_END
): Promise<number> {
  for (let port = startPort; port <= maxPort; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const testServer = createServer();
        testServer.once("error", reject);
        testServer.once("listening", () => {
          testServer.close(() => resolve());
        });
        testServer.listen(port, SERVER_HOST);
      });
      return port;
    } catch (error) {
      continue;
    }
  }
  throw new Error(`No available ports found between ${startPort} and ${maxPort}`);
}

/**
 * Extracts a resume id from a URL path segment and normalizes it to its
 * slug. Returns null when the segment is missing or malformed.
 */
function parseResumeIdFromUrl(url: string, prefix: string): string | null {
  const rawId = url.substring(prefix.length);
  if (!rawId) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawId);
  } catch {
    return null;
  }

  try {
    validateResumeId(decoded);
  } catch {
    return null;
  }

  return slugifyResumeId(decoded);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Serves the live resume preview page. The page itself is assembled per
 * request so the port and the live-reload flag always match the session.
 *
 * The chrome follows the request language, the resume body keeps the
 * language stored with the resume.
 */
async function handleResumeLiveRequest(
  url: string,
  req: IncomingMessage,
  res: ServerResponse,
  port: number
): Promise<void> {
  const resumeId = parseResumeIdFromUrl(url, RESUME_ROUTES.LIVE);
  if (!resumeId) {
    res.writeHead(400, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end("Invalid resume ID");
    return;
  }

  const state = liveSessions.get(resumeSessionKey(resumeId));
  if (!state) {
    webLogger.warn(`Resume live preview - not registered: ${resumeId}`);
    res.writeHead(404, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end("Resume not found");
    return;
  }

  try {
    const locale = resolveLocale({
      query: getQueryParam(req.url, "lang"),
      acceptLanguage: req.headers["accept-language"],
    });
    const options = await loadResumeOptions(resumeId);

    const body = await readFile(state.filePath, "utf-8");
    const html = await createResumeHtmlWrapper(body, {
      resumeId,
      port,
      liveEnabled: true,
      locale,
      resumeLocale: options.locale,
      path: url,
    });
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES.HTML,
      "Content-Security-Policy": CSP_HEADER,
      "Content-Language": locale,
    });
    res.end(html);
    webLogger.info(`Served resume live preview for: ${resumeId}`, { locale });
  } catch (error) {
    webLogger.error(`Error serving resume live preview for: ${resumeId}`, {
      error: errorText(error),
    });
    res.writeHead(500, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end(`Error reading resume: ${errorText(error)}`);
  }
}

/**
 * Serves the static resume preview page. It reads straight from disk, so it
 * works even when the resume has no live preview session.
 */
async function handleResumeViewRequest(
  url: string,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const resumeId = parseResumeIdFromUrl(url, RESUME_ROUTES.VIEW);
  if (!resumeId) {
    res.writeHead(400, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end("Invalid resume ID");
    return;
  }

  try {
    const locale = resolveLocale({
      query: getQueryParam(req.url, "lang"),
      acceptLanguage: req.headers["accept-language"],
    });
    const options = await loadResumeOptions(resumeId);

    const body = await readFile(getResumeFilePath(resumeId, "html"), "utf-8");
    const html = await createResumeHtmlWrapper(body, {
      resumeId,
      port: 0,
      liveEnabled: false,
      locale,
      resumeLocale: options.locale,
      path: url,
    });
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES.HTML,
      "Content-Security-Policy": CSP_HEADER,
      "Content-Language": locale,
    });
    res.end(html);
    webLogger.info(`Served resume static view for: ${resumeId}`, { locale });
  } catch (error) {
    webLogger.warn(`Resume not found: ${resumeId}`, { error: errorText(error) });
    res.writeHead(404, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end(`Resume not found: ${errorText(error)}`);
  }
}

/**
 * Renders the resume on demand and streams it back as a download.
 */
async function handleResumeExportRequest(
  url: string,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const resumeId = parseResumeIdFromUrl(url, RESUME_ROUTES.EXPORT);
  if (!resumeId) {
    res.writeHead(400, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end("Invalid resume ID");
    return;
  }

  const rawUrl = req.url ?? "";
  const queryIndex = rawUrl.indexOf("?");
  const format =
    queryIndex >= 0
      ? new URLSearchParams(rawUrl.slice(queryIndex + 1)).get("format") || "pdf"
      : "pdf";

  if (format !== "pdf" && format !== "html") {
    res.writeHead(400, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end(`Invalid format: "${format}"`);
    return;
  }

  try {
    const content = await loadResumeContent(resumeId);
    // The exported document is in the resume's own language. It never
    // depends on the language of the request that triggered the export.
    const options = await loadResumeOptions(resumeId);
    let payload: Buffer;
    let contentType: string;

    if (format === "pdf") {
      payload = await renderResumePdf(content, options.locale);
      contentType = CONTENT_TYPES.PDF;
    } else {
      const html = await renderResumeExportHtml(content, options.locale);
      payload = Buffer.from(html, "utf-8");
      contentType = CONTENT_TYPES.HTML;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${resumeId}.${format}"`,
      "Content-Length": payload.byteLength,
      "Content-Language": options.locale,
      "Cache-Control": CACHE_CONTROL.NO_STORE,
    });
    res.end(payload);
    webLogger.info(`Served resume export for: ${resumeId}`, { format });
  } catch (error) {
    webLogger.error(`Resume export failed for: ${resumeId}`, { error: errorText(error) });
    res.writeHead(500, { "Content-Type": CONTENT_TYPES.PLAIN });
    res.end("Failed to export resume");
  }
}

export async function ensureLiveServer(): Promise<number> {
  if (liveServer && liveServerPort) {
    webLogger.debug(`Reusing existing server on port ${liveServerPort}`);
    return liveServerPort;
  }

  const port = await findAvailablePort();
  webLogger.info(`Starting live server on port ${port}`);

  liveServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Routing works on the pathname only. Query strings and fragments are
    // not part of a route, and leaving them in made requests such as
    // "/gallery.css?v=2" or "/view/arch?x=1" fail to match.
    const url = getPathname(req.url);

    try {
      // Try to match new route system first (gallery, API, new assets)
      const route = matchRoute(url);
      if (route) {
        await route.handler({ req, res, url, port });
        return;
      }

      // Resume routes. The order matters: "/resume/export/" and
      // "/resume/view/" are prefixes of "/resume/", so they have to be tested
      // first or they would be read as a resume id containing a slash.
      if (url.startsWith(RESUME_ROUTES.EXPORT)) {
        await handleResumeExportRequest(url, req, res);
        return;
      }

      if (url.startsWith(RESUME_ROUTES.VIEW)) {
        await handleResumeViewRequest(url, req, res);
        return;
      }

      if (url.startsWith(RESUME_ROUTES.LIVE)) {
        await handleResumeLiveRequest(url, req, res, port);
        return;
      }

      if (url === ROUTES.FAVICON_SVG) {
        const icon = await readFile(FAVICON_PATH);
        res.writeHead(200, {
          "Content-Type": CONTENT_TYPES.SVG,
          "Cache-Control": CACHE_CONTROL.PUBLIC_24H,
        });
        res.end(icon);
        return;
      }

      if (url === ROUTES.FAVICON_ICO) {
        // Redirect common .ico requests to SVG favicon
        res.writeHead(302, { Location: ROUTES.FAVICON_SVG });
        res.end();
        return;
      }

      res.writeHead(404, { "Content-Type": CONTENT_TYPES.PLAIN });
      res.end("Not found");
    } catch (error) {
      webLogger.error(`HTTP server error for ${url}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      res.writeHead(500, { "Content-Type": CONTENT_TYPES.PLAIN });
      res.end(`Server error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  wss = new WebSocketServer({ server: liveServer });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const path = getPathname(req.url);
    const session = resolveSessionFromPath(path);
    const key = session?.key ?? "";
    const label = session?.label ?? "";

    webLogger.info(`WebSocket connection attempt`, { id: label, url: req.url });

    if (session && liveSessions.has(key)) {
      const state = liveSessions.get(key)!;
      state.clients.add(ws);
      webLogger.info(`WebSocket client connected to session: ${label}`, {
        clientCount: state.clients.size,
      });

      ws.on("close", () => {
        state.clients.delete(ws);
        webLogger.info(`WebSocket client disconnected from session: ${label}`, {
          clientCount: state.clients.size,
        });
      });
    } else {
      webLogger.warn(`WebSocket connection failed - session not registered: ${label}`);
      ws.close();
    }
  });

  await new Promise<void>((resolve) => {
    liveServer!.listen(port, SERVER_HOST, () => {
      liveServerPort = port;
      webLogger.info(`Live reload server listening on ${SERVER_HOST}:${port}`);
      console.error(`Live reload server started on ${SERVER_HOST}:${port}`);
      resolve();
    });
  });

  return port;
}

export async function addLiveSession(
  sessionId: string,
  filePath: string,
  namespace: string = SESSION_NAMESPACES.RESUME
): Promise<void> {
  const key = sessionKey(namespace, sessionId);
  const existingClients = liveSessions.has(key)
    ? liveSessions.get(key)!.clients
    : new Set<WebSocket>();
  const isUpdate = liveSessions.has(key);

  if (isUpdate) {
    liveSessions.get(key)!.watcher.close();
    webLogger.info(`Updating live session: ${sessionId}`, {
      existingClientCount: existingClients.size,
    });
  } else {
    webLogger.info(`Registering new live session: ${sessionId}`);
  }

  const watcher = watch(filePath, (eventType) => {
    if (eventType === "change") {
      webLogger.debug(`File change detected for session: ${sessionId}`);
      notifyClients(key);
      return;
    }

    // "rename" fires both when the file is atomically replaced and when it
    // is removed. Only the latter should end the preview session.
    if (eventType === "rename" && !existsSync(filePath)) {
      webLogger.info(`Watched file removed, ending preview session: ${sessionId}`);
      removeLiveSession(sessionId, namespace);
    }
  });

  // A watched file that is deleted (e.g. via DELETE /api/resumes/:id) makes
  // the underlying watcher emit an 'error' event on some platforms. Without a
  // listener Node treats that as an unhandled 'error' event and crashes the
  // whole process, taking the MCP server down with it.
  watcher.on("error", (error) => {
    webLogger.warn(`Watcher error for session: ${sessionId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    if (!existsSync(filePath)) {
      removeLiveSession(sessionId, namespace);
    }
  });

  liveSessions.set(key, {
    filePath,
    watcher,
    clients: existingClients,
  });
}

/**
 * Ends the live preview session: closes its file watcher and disconnects any
 * WebSocket clients. Safe to call for unknown IDs.
 */
export function removeLiveSession(
  sessionId: string,
  namespace: string = SESSION_NAMESPACES.RESUME
): void {
  const key = sessionKey(namespace, sessionId);
  const state = liveSessions.get(key);
  if (!state) return;

  liveSessions.delete(key);

  try {
    state.watcher.close();
  } catch (error) {
    webLogger.debug("Error closing watcher", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  state.clients.forEach((client) => {
    try {
      client.close();
    } catch {
      // Client already gone; nothing to do.
    }
  });
  state.clients.clear();

  webLogger.info(`Removed live session: ${sessionId}`);
}

export function hasActiveConnections(
  sessionId: string,
  namespace: string = SESSION_NAMESPACES.RESUME
): boolean {
  const state = liveSessions.get(sessionKey(namespace, sessionId));
  const hasConnections = state ? state.clients.size > 0 : false;
  webLogger.debug(`Checking active connections for ${sessionId}`, {
    hasConnections,
    clientCount: state?.clients.size || 0,
  });
  return hasConnections;
}

function notifyClients(key: string): void {
  const state = liveSessions.get(key);
  if (!state) return;

  let notifiedCount = 0;
  state.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(WS_MESSAGES.RELOAD);
      notifiedCount++;
    }
  });

  if (notifiedCount > 0) {
    webLogger.info(`Notified clients to reload session: ${key}`, {
      notifiedCount,
      totalClients: state.clients.size,
    });
  }
}

/**
 * Closes the live server and cleans up all resources.
 * This is safe to call multiple times and useful for graceful shutdown.
 */
export async function closeLiveServer(): Promise<void> {
  // Close all file watchers
  liveSessions.forEach((state) => {
    try {
      state.watcher.close();
    } catch (error) {
      webLogger.debug("Error closing watcher", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  liveSessions.clear();

  // Close WebSocket server
  if (wss) {
    await new Promise<void>((resolve) => {
      wss!.close(() => {
        webLogger.debug("WebSocket server closed");
        resolve();
      });
    });
    wss = null;
  }

  // Close HTTP server
  if (liveServer) {
    await new Promise<void>((resolve) => {
      liveServer!.close(() => {
        webLogger.info(`Live server closed (was on port ${liveServerPort})`);
        resolve();
      });
    });
    liveServer = null;
    liveServerPort = null;
  }
}
