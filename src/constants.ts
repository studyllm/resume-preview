/**
 * Application-wide constants
 * Centralizes all magic strings and numbers for maintainability
 */

// ===== Application Configuration =====
export const APP_NAME = "resume-preview";

/**
 * App directory name used before the project was renamed. The data directory
 * is migrated from it once, on startup — see `migrateLegacyAppDir()`.
 */
export const LEGACY_APP_NAME = "claude-mermaid";

// ===== Server Configuration =====
export const SERVER_PORT_START = 3737;
export const SERVER_PORT_END = 3747;
// Bind to loopback only — this is a local developer tool with no auth,
// and binding to all interfaces would expose the unauthenticated
// gallery + resume API to anyone on the LAN.
export const SERVER_HOST = "127.0.0.1";

// ===== File Names =====
export const FILE_NAMES = {
  RESUME_CONTENT: "resume.json",
  RESUME_OPTIONS: "options.json",
  RESUME_HTML: "resume.html",
  RESUME_EXPORT_HTML: "resume.export.html",
  RESUME_PDF: "resume.pdf",
} as const;

// ===== Directory Names =====
export const DIR_NAMES = {
  LOGS: "logs",
  PREVIEW: "preview",
  RESUMES: "resumes",
} as const;

// ===== Template Files =====
export const TEMPLATE_FILES = {
  GALLERY: "gallery.html",
  RESUME_TEMPLATE: "resume-template.html",
} as const;

// ===== Static Asset Files =====
export const ASSET_FILES = {
  SHARED_STYLE: "shared.css",
  GALLERY_STYLE: "gallery.css",
  GALLERY_SCRIPT: "gallery.js",
  RESUME_STYLE: "resume.css",
  RESUME_SCRIPT: "resume.js",
  I18N_SCRIPT: "i18n.js",
  FAVICON: "favicon.svg",
} as const;

// ===== Internationalization =====
// Two independent locale axes: the UI language (chrome, toolbars, dialogs)
// and the resume language (section headings, exported documents). They are
// deliberately separate so an exported PDF never depends on the browser's
// Accept-Language header.
export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;

/** Language of the page chrome. Resolved per request (query > header > default). */
export const DEFAULT_UI_LOCALE = "zh-CN";

/** Language of the resume itself. Stored per resume in options.json. */
export const DEFAULT_RESUME_LOCALE = "zh-CN";

/** Locale used when a key is missing from the requested language. */
export const FALLBACK_LOCALE = "en";

/**
 * Dictionary key holding the native name of each locale. Used to label the
 * language switcher, so a switcher can name every supported language in the
 * language it names.
 */
export const LOCALE_LABEL_KEYS: Record<string, string> = {
  "zh-CN": "common.langZh",
  en: "common.langEn",
};

/** Directory inside the preview assets that holds the locale dictionaries. */
export const I18N_DIR = "i18n";

/** Suffix of a served dictionary file. */
export const I18N_FILE_SUFFIX = ".json";

// ===== HTTP Routes =====
export const ROUTES = {
  ROOT: "/",
  GALLERY: "/",
  FAVICON_SVG: "/favicon.svg",
  FAVICON_ICO: "/favicon.ico",
  SHARED_STYLE: "/shared.css",
  GALLERY_STYLE: "/gallery.css",
  GALLERY_SCRIPT: "/gallery.js",
  I18N_SCRIPT: "/i18n.js",
} as const;

// ===== Resume Routes =====
// Matching is a sequential prefix scan, so the more specific prefixes
// (EXPORT / VIEW) must be tested before the generic LIVE prefix.
export const RESUME_ROUTES = {
  API: "/api/resumes",
  API_ITEM: "/api/resumes/", // + :id
  LIVE: "/resume/",
  VIEW: "/resume/view/",
  EXPORT: "/resume/export/",
  STYLE: "/resume.css",
  SCRIPT: "/resume.js",
} as const;

// ===== i18n Routes =====
export const I18N_ROUTES = {
  /** + :locale.json — serves a locale dictionary. The locale is whitelisted. */
  DICTIONARY: "/i18n/",
} as const;

// ===== HTTP Headers =====
export const CONTENT_TYPES = {
  HTML: "text/html",
  CSS: "text/css",
  JAVASCRIPT: "application/javascript",
  JSON: "application/json",
  SVG: "image/svg+xml",
  PDF: "application/pdf",
  PLAIN: "text/plain",
} as const;

export const CACHE_CONTROL = {
  NO_STORE: "no-store",
  PUBLIC_24H: "public, max-age=86400",
} as const;

// Content Security Policy
// - default-src 'none': Deny all by default
// - script-src 'self': Only allow scripts from same origin
// - style-src 'self' 'unsafe-inline': Allow CSS from same origin and inline styles
// - img-src 'self' data: blob:: Allow images from same origin, data URIs, and blob URLs (for PNG export)
// - connect-src 'self' ws://localhost:*: Allow WebSocket connections
export const CSP_HEADER =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://localhost:*";

// ===== Validation Patterns =====
export const PREVIEW_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

// ===== CJK Characters =====
// Characters a generic sans-serif cannot render: they need a CJK-capable font
// (Microsoft YaHei, Noto Sans CJK SC, ...) or they come out as tofu boxes.
// Covers Han ideographs, kana, hangul, CJK punctuation and fullwidth forms.
//
// Two boundaries are deliberate:
// - the CJK ideographic comma (U+3001) lives in the punctuation block, not
//   with the Han characters — a Han-only range would miss it;
// - General Punctuation (U+2000–U+206F) is **excluded**: the renderer joins
//   start/end dates with an EN DASH (U+2013), which nearly every dated
//   experience carries, so including it would block every English resume.
//
// No `g` flag on purpose: `RegExp.test` keeps `lastIndex` under `g`, so the
// same input would alternate between true and false.
export const CJK_CHAR_REGEX = /[⺀-⻿　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;

/**
 * Locales whose exported document always contains CJK characters, whatever the
 * content says: their section headings, document title and placeholders are
 * Chinese. These always need a CJK font. Every other locale is judged from the
 * document's own characters.
 */
export const CJK_ALWAYS_LOCALES = ["zh-CN"] as const;

// ===== System Paths (Security) =====
export const UNIX_SYSTEM_PATHS = [
  "/etc",
  "/bin",
  "/sbin",
  "/usr/bin",
  "/usr/sbin",
  "/boot",
  "/sys",
  "/proc",
] as const;

export const WINDOWS_SYSTEM_PATHS = ["C:\\Windows", "C:\\Program Files"] as const;

// ===== WebSocket Messages =====
export const WS_MESSAGES = {
  RELOAD: "reload",
} as const;

// ===== Template Placeholders =====
export const TEMPLATE_VARS = {
  CONTENT: "{{CONTENT}}",
  NAV: "{{NAV}}",
  FOOTER: "{{FOOTER}}",
  RESUME_ID: "{{RESUME_ID}}",
  PORT: "{{PORT}}",
  LIVE_ENABLED: "{{LIVE_ENABLED}}",
  PAGE_TITLE: "{{PAGE_TITLE}}",
  PAGE_SCRIPTS: "{{PAGE_SCRIPTS}}",
  PAGE_STYLES: "{{PAGE_STYLES}}",
  PAGE_HEAD: "{{PAGE_HEAD}}",
  PAGE_SHELL: "{{PAGE_SHELL}}",
  BODY_ATTRIBUTES: "{{BODY_ATTRIBUTES}}",
  LANG: "{{LANG}}",
  LANG_SWITCH: "{{LANG_SWITCH}}",
  I18N_SCRIPT: "{{I18N_SCRIPT}}",
} as const;

// ===== Resume Options =====
/**
 * Templates and themes only list what is actually implemented. Adding a
 * template means adding its id here plus the matching resource file — the
 * validation layer and the rendering path already exist.
 */
export const RESUME_TEMPLATES = ["default"] as const;
export const RESUME_THEMES = ["default"] as const;
export const RESUME_FORMATS = ["pdf", "html"] as const;

export type ResumeTemplate = (typeof RESUME_TEMPLATES)[number];
export type ResumeTheme = (typeof RESUME_THEMES)[number];
export type ResumeFormat = (typeof RESUME_FORMATS)[number];

export const DEFAULT_RESUME_TEMPLATE: ResumeTemplate = "default";
export const DEFAULT_RESUME_THEME: ResumeTheme = "default";
export const DEFAULT_RESUME_FORMAT: ResumeFormat = "pdf";

// ===== Resume Limits =====
/** Version stamped into resume.json so future content-model changes can migrate. */
export const RESUME_CONTENT_VERSION = 1;

/** Upper bound for the resume content accepted by the MCP tool (1 MB). */
export const RESUME_MAX_CONTENT_BYTES = 1024 * 1024;

/** Length of the hash suffix appended to a slugified resume id. */
export const RESUME_SLUG_HASH_LENGTH = 6;

/**
 * Font files that provide CJK coverage. Checked before rendering a document
 * that contains CJK characters, so a missing Chinese font fails loudly
 * instead of producing tofu boxes.
 */
export const CJK_FONT_FILES = [
  "msyh.ttc",
  "msyh.ttf",
  "msyhl.ttc",
  "simsun.ttc",
  "simhei.ttf",
  "Deng.ttf",
] as const;

// ===== Resume Storage =====
/** Namespace prefixes for live-server session keys. */
export const SESSION_NAMESPACES = {
  RESUME: "resume",
} as const;
