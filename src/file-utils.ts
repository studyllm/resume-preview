import { readFile, writeFile, mkdir, rm, stat, access, rename, cp } from "fs/promises";
import { join, resolve, extname } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import {
  APP_NAME,
  LEGACY_APP_NAME,
  PREVIEW_ID_REGEX,
  UNIX_SYSTEM_PATHS,
  WINDOWS_SYSTEM_PATHS,
  FILE_NAMES,
  DIR_NAMES,
  RESUME_TEMPLATES,
  RESUME_THEMES,
  RESUME_FORMATS,
  SUPPORTED_LOCALES,
  DEFAULT_RESUME_LOCALE,
  RESUME_CONTENT_VERSION,
  RESUME_MAX_CONTENT_BYTES,
  RESUME_SLUG_HASH_LENGTH,
} from "./constants.js";
import type { ResumeContent, ResumeOptions, Locale } from "./types.js";

export function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.trim()) return xdg;
  const homeDir = process.env.HOME || process.env.USERPROFILE || tmpdir();
  return join(homeDir, ".config");
}

export function getAppDir(): string {
  return join(getConfigDir(), APP_NAME);
}

/**
 * Moves the pre-rename data directory into the current one, once.
 *
 * The project was renamed from `claude-mermaid` to `resume-preview`, and the
 * data directory is named after the app. Without this step an existing user's
 * resumes and logs would stay in the old directory and become
 * invisible.
 *
 * Rules:
 * - legacy directory missing → fresh install, nothing to do
 * - current directory missing → the legacy one is renamed to it (fast path)
 * - current directory already exists → the legacy contents are **merged** into
 *   it, so neither side is orphaned; files already present in the current
 *   directory win
 *
 * A rename can fail on Windows while another process still holds a handle on a
 * watched file inside the legacy directory (the pre-rename server does exactly
 * that). When that happens the migration falls back to copying, which works
 * with open read handles, and the stale directory is removed on a best-effort
 * basis.
 *
 * Never throws: a failed migration is reported and the server keeps running.
 */
export async function migrateLegacyAppDir(): Promise<void> {
  const current = getAppDir();
  const legacy = join(getConfigDir(), LEGACY_APP_NAME);
  if (current === legacy) return;

  try {
    await access(legacy);
  } catch {
    // Fresh install — nothing to migrate.
    return;
  }

  let currentExists = true;
  try {
    await access(current);
  } catch {
    currentExists = false;
  }

  if (!currentExists) {
    try {
      await rename(legacy, current);
      console.error(`Migrated data directory: ${legacy} -> ${current}`);
      return;
    } catch {
      // Fall through to the copy-based merge below.
    }
  }

  try {
    await cp(legacy, current, { recursive: true, force: false, errorOnExist: false });
  } catch (error) {
    console.error(
      `Could not migrate data directory ${legacy} -> ${current}:`,
      error instanceof Error ? error.message : String(error)
    );
    return;
  }

  // Best effort cleanup: the legacy directory may still be held open by a
  // pre-rename server, in which case it stays behind as a stale copy.
  try {
    await rm(legacy, { recursive: true, force: true });
    console.error(`Migrated data directory: ${legacy} -> ${current}`);
  } catch {
    console.error(
      `Merged data directory ${legacy} -> ${current}. ` +
        `The old directory could not be removed and can be deleted manually.`
    );
  }
}

/**
 * Root directory holding every resume workspace.
 */
export function getResumesDir(): string {
  return join(getAppDir(), DIR_NAMES.RESUMES);
}

export function getLogsDir(): string {
  return join(getAppDir(), DIR_NAMES.LOGS);
}

/**
 * Validates that previewId is safe to use in file paths
 * Only allows alphanumeric characters, hyphens, and underscores
 */
export function validatePreviewId(previewId: string): void {
  if (!previewId || !PREVIEW_ID_REGEX.test(previewId)) {
    throw new Error(
      "Invalid preview ID format. Only alphanumeric characters, hyphens, and underscores are allowed."
    );
  }
}

function validateAllowed(label: string, value: string, allowed: readonly string[]): void {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid ${label}: "${value}". Allowed values: ${allowed.join(", ")}.`);
  }
}

// ===== Resume helpers =====

export function validateResumeId(resumeId: string): void {
  if (!resumeId || typeof resumeId !== "string") {
    throw new Error("resume_id parameter is required");
  }
  if (resumeId.length > 200) {
    throw new Error("Invalid resume ID: must be at most 200 characters");
  }
}

export function validateResumeTemplate(template: string): void {
  validateAllowed("template", template, RESUME_TEMPLATES);
}

export function validateResumeTheme(theme: string): void {
  validateAllowed("theme", theme, RESUME_THEMES);
}

export function validateResumeFormat(format: string): void {
  validateAllowed("format", format, RESUME_FORMATS);
}

/**
 * Checks a locale against the whitelist and returns it narrowed to the
 * supported set. The cast is safe: validateAllowed rejects everything else.
 */
export function validateResumeLocale(locale: string): Locale {
  validateAllowed("locale", locale, SUPPORTED_LOCALES);
  return locale as Locale;
}

/**
 * Narrows a stored locale to a supported one. Options files written by an
 * older version have no locale at all, and a hand-edited one may carry
 * anything — both fall back to the default instead of failing the load.
 */
function toStoredLocale(value: unknown): Locale {
  if (typeof value !== "string") return DEFAULT_RESUME_LOCALE;
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
    ? (value as Locale)
    : DEFAULT_RESUME_LOCALE;
}

/**
 * Turns a resume id into a name that is safe to use as a directory name and
 * as a URL path segment.
 *
 * Ids that are already safe are returned untouched so the common case stays
 * readable ("frontend-senior" stays "frontend-senior"). Anything else — a
 * Chinese id, for instance — is reduced to its ASCII skeleton plus a short
 * hash of the original, which keeps distinct ids from colliding. The result
 * always satisfies PREVIEW_ID_REGEX, so the path traversal guard holds.
 */
export function slugifyResumeId(resumeId: string): string {
  if (PREVIEW_ID_REGEX.test(resumeId)) {
    return resumeId;
  }

  const skeleton = resumeId
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  const hash = createHash("sha256")
    .update(resumeId, "utf-8")
    .digest("hex")
    .slice(0, RESUME_SLUG_HASH_LENGTH);

  return `${skeleton || "r"}-${hash}`;
}

export function getResumeDir(resumeId: string): string {
  const slug = slugifyResumeId(resumeId);
  // The slug is what actually reaches the filesystem, so it must pass the
  // same guard that protects the resume workspace.
  validatePreviewId(slug);
  return join(getResumesDir(), slug);
}

export type ResumeFileKind = "content" | "options" | "html" | "exportHtml" | "pdf";

const RESUME_FILE_NAMES: Record<ResumeFileKind, string> = {
  content: FILE_NAMES.RESUME_CONTENT,
  options: FILE_NAMES.RESUME_OPTIONS,
  html: FILE_NAMES.RESUME_HTML,
  exportHtml: FILE_NAMES.RESUME_EXPORT_HTML,
  pdf: FILE_NAMES.RESUME_PDF,
};

export function getResumeFilePath(resumeId: string, kind: ResumeFileKind): string {
  return join(getResumeDir(resumeId), RESUME_FILE_NAMES[kind]);
}

export async function saveResumeContent(resumeId: string, content: ResumeContent): Promise<void> {
  const dir = getResumeDir(resumeId);
  await mkdir(dir, { recursive: true });
  const payload = { ...content, version: content.version ?? RESUME_CONTENT_VERSION };
  await writeFile(
    getResumeFilePath(resumeId, "content"),
    JSON.stringify(payload, null, 2),
    "utf-8"
  );
}

export async function loadResumeContent(resumeId: string): Promise<ResumeContent> {
  const content = await readFile(getResumeFilePath(resumeId, "content"), "utf-8");
  return JSON.parse(content) as ResumeContent;
}

export async function saveResumeOptions(resumeId: string, options: ResumeOptions): Promise<void> {
  const dir = getResumeDir(resumeId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    getResumeFilePath(resumeId, "options"),
    JSON.stringify(options, null, 2),
    "utf-8"
  );
}

export async function loadResumeOptions(resumeId: string): Promise<ResumeOptions> {
  try {
    const content = await readFile(getResumeFilePath(resumeId, "options"), "utf-8");
    const parsed = JSON.parse(content) as Partial<ResumeOptions>;
    return {
      template: parsed.template ?? RESUME_TEMPLATES[0],
      theme: parsed.theme ?? RESUME_THEMES[0],
      locale: toStoredLocale(parsed.locale),
    };
  } catch {
    return {
      template: RESUME_TEMPLATES[0],
      theme: RESUME_THEMES[0],
      locale: DEFAULT_RESUME_LOCALE,
    };
  }
}

/**
 * Accepts the resume content either as an object or as a JSON string and
 * returns the normalized content model. Only structural problems are
 * rejected — unknown fields are ignored and missing sections are simply
 * omitted by the renderer.
 */
export function normalizeResumeContent(input: unknown): ResumeContent {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error("content parameter is required");
    }
    if (Buffer.byteLength(trimmed, "utf-8") > RESUME_MAX_CONTENT_BYTES) {
      throw new Error(
        `Invalid content: Resume content exceeds ${RESUME_MAX_CONTENT_BYTES / 1024}KB limit`
      );
    }
    try {
      return normalizeResumeContent(JSON.parse(trimmed));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid content: ${error.message}`);
      }
      throw error;
    }
  }

  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    const actual = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
    throw new Error(`Invalid content: Expected a resume object, got ${actual}`);
  }

  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf-8") > RESUME_MAX_CONTENT_BYTES) {
    throw new Error(
      `Invalid content: Resume content exceeds ${RESUME_MAX_CONTENT_BYTES / 1024}KB limit`
    );
  }

  return input as ResumeContent;
}

/**
 * Removes the cached export artifacts of a resume.
 *
 * The export tool caches its rendered artifact inside the workspace and
 * reuses it on the next call, so a cached PDF would keep the old content
 * after the resume has been edited. Every content change invalidates the
 * cache; the artifacts are rendered again on the next export.
 */
export async function invalidateResumeArtifacts(resumeId: string): Promise<void> {
  for (const kind of ["exportHtml", "pdf"] as const) {
    await rm(getResumeFilePath(resumeId, kind), { force: true });
  }
}

/**
 * Tells whether a cached export artifact is older than the content it was
 * rendered from.
 *
 * Comparing the two modification times catches every way the content can
 * change — a new `resume_preview`, or an edit made outside the MCP tools —
 * without the export path having to trust any bookkeeping elsewhere.
 *
 * An artifact is only reusable when it is *strictly* newer than the content.
 * On a filesystem with a coarse timestamp resolution the two can land in the
 * same tick, and re-rendering is always safe while serving stale content
 * is not.
 */
export async function isResumeArtifactStale(
  resumeId: string,
  kind: "pdf" | "exportHtml"
): Promise<boolean> {
  try {
    const [artifactStat, contentStat] = await Promise.all([
      stat(getResumeFilePath(resumeId, kind)),
      stat(getResumeFilePath(resumeId, "content")),
    ]);
    return artifactStat.mtimeMs <= contentStat.mtimeMs;
  } catch {
    // No artifact, or no content yet — nothing cached to reuse.
    return true;
  }
}

/**
 * Removes a resume workspace and everything in it.
 *
 * Uses rm({recursive:true}) rather than an unlink/rmdir dance: rmdir fails on
 * subdirectories and is deprecated in Node.
 */
export async function deleteResumeDirectory(resumeId: string): Promise<void> {
  const dir = getResumeDir(resumeId);
  await rm(dir, { recursive: true, force: true });
}

/**
 * Validates a save path to prevent path traversal and writing to sensitive locations
 * @param savePath - The path where the user wants to save the file
 * @param expectedFormat - When given, the file extension must match this format
 * @throws Error if the path is invalid or dangerous
 */
export function validateSavePath(savePath: string, expectedFormat?: string): void {
  // Check for null bytes (potential security issue)
  if (savePath.includes("\0")) {
    throw new Error("Path contains null bytes");
  }

  // Resolve to absolute path
  const absolutePath = resolve(savePath);

  // Prevent writing to sensitive system directories (Unix/Linux/macOS)
  if (
    process.platform !== "win32" &&
    UNIX_SYSTEM_PATHS.some((danger) => absolutePath.startsWith(danger))
  ) {
    throw new Error("Cannot write to system directories");
  }

  // Prevent writing to Windows system directories
  if (process.platform === "win32") {
    const normalizedPath = absolutePath.replace(/\//g, "\\");
    if (WINDOWS_SYSTEM_PATHS.some((danger) => normalizedPath.startsWith(danger))) {
      throw new Error("Cannot write to system directories");
    }
  }

  // A resume that lands in a .pdf file holding HTML content is unusable, so
  // the extension has to agree with the requested format.
  if (expectedFormat) {
    const extension = extname(absolutePath).toLowerCase();
    if (extension !== `.${expectedFormat.toLowerCase()}`) {
      throw new Error(`Extension "${extension || ""}" does not match format "${expectedFormat}"`);
    }
  }
}

export interface OpenCommand {
  command: string;
  args: string[];
}

export function getOpenCommand(url: string): OpenCommand {
  switch (process.platform) {
    case "darwin":
      return { command: "open", args: [url] };
    case "win32":
      return { command: "cmd.exe", args: ["/c", "start", "", url] };
    default:
      return { command: "xdg-open", args: [url] };
  }
}
