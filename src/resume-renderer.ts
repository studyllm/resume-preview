/**
 * Resume Renderer
 * Single Responsibility: turn a resume content model into HTML, a
 * standalone HTML export, or an A4 PDF.
 *
 * The renderer owns two artifacts:
 *  - `resume.html`        the resume body, embedded into the preview page
 *  - `resume.export.html` a standalone document that can be opened directly
 *
 * Both come out of the same page template; only the shell (toolbar) and the
 * way styles are delivered differ between preview and export mode.
 */

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import puppeteer, { Browser } from "puppeteer";
import { escapeHtml } from "./html-utils.js";
import {
  TEMPLATE_FILES,
  ASSET_FILES,
  CJK_FONT_FILES,
  CJK_CHAR_REGEX,
  CJK_ALWAYS_LOCALES,
  TEMPLATE_VARS,
  ROUTES,
  RESUME_ROUTES,
} from "./constants.js";
import { mcpLogger } from "./logger.js";
import { getDictionary, getHtmlLang, renderLanguageSwitcher, t, type Dictionary } from "./i18n.js";
import type { ResumeContent, ResumeOptions, Locale } from "./types.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PREVIEW_DIR = join(__dirname, "preview");

// The resume template has its own cache: the gallery template is cached
// separately in live-server.ts and the two must not overwrite each other.
const templateCache = new Map<string, string>();

async function loadCachedAsset(filename: string): Promise<string> {
  const cached = templateCache.get(filename);
  if (cached) return cached;

  const content = await readFile(join(PREVIEW_DIR, filename), "utf-8");
  templateCache.set(filename, content);
  return content;
}

/**
 * Loads the resume page template. Kept in its own cache so it can never
 * collide with the gallery template.
 */
export async function loadResumeTemplate(): Promise<string> {
  return loadCachedAsset(TEMPLATE_FILES.RESUME_TEMPLATE);
}

/**
 * Loads the resume stylesheet. The standalone HTML export inlines it, so the
 * export has to carry its own copy of the rules.
 */
export async function loadResumeStyles(): Promise<string> {
  return loadCachedAsset(ASSET_FILES.RESUME_STYLE);
}

/**
 * Clears the cached templates. Useful in tests and development.
 */
export function clearResumeTemplateCache(): void {
  templateCache.clear();
}

export interface ResumePageOptions {
  resumeId: string;
  port: number;
  liveEnabled: boolean;
  timestamp?: string;
  /** Language of the page chrome. */
  locale: Locale;
  /** Language of the resume body. */
  resumeLocale: Locale;
  /** Path of the current request, used to build the language switch links. */
  path?: string;
}

// ===== Content model → HTML =====

function renderHighlights(items: string[] | undefined): string {
  if (!items || items.length === 0) return "";
  const list = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `<ul class="resume-list">${list}</ul>`;
}

function renderPeriod(start?: string, end?: string): string {
  const parts = [start, end].filter((part) => part && part.trim().length > 0);
  return parts.join(" – ");
}

function renderSection(title: string, body: string): string {
  if (!body) return "";
  return `<section class="resume-section">
      <h2 class="resume-section-title">${escapeHtml(title)}</h2>
      ${body}
    </section>`;
}

function renderBasics(basics: ResumeContent["basics"], dictionary: Dictionary): string {
  if (!basics) return "";

  const contactParts: string[] = [];
  if (basics.email)
    contactParts.push(`<span class="resume-contact-item">${escapeHtml(basics.email)}</span>`);
  if (basics.phone)
    contactParts.push(`<span class="resume-contact-item">${escapeHtml(basics.phone)}</span>`);
  if (basics.location)
    contactParts.push(`<span class="resume-contact-item">${escapeHtml(basics.location)}</span>`);
  if (basics.links?.length) {
    for (const link of basics.links) {
      contactParts.push(
        `<span class="resume-contact-item">${escapeHtml(link.label)}: ${escapeHtml(link.url)}</span>`
      );
    }
  }

  const title = basics.title ? `<p class="resume-title">${escapeHtml(basics.title)}</p>` : "";
  const contact = contactParts.length
    ? `<div class="resume-contact">${contactParts.join("")}</div>`
    : "";

  return `<header class="resume-header">
      <h1 class="resume-name">${escapeHtml(
        basics.name || t(dictionary, "resume.namePlaceholder")
      )}</h1>
      ${title}
      ${contact}
    </header>`;
}

function renderExperience(items: ResumeContent["experience"]): string {
  if (!items?.length) return "";

  const blocks = items
    .map((item) => {
      const period = renderPeriod(item.start, item.end);
      const heading = [
        `<span class="resume-entry-title">${escapeHtml(item.title || "")}</span>`,
        `<span class="resume-entry-org">${escapeHtml(item.company)}</span>`,
        period ? `<span class="resume-entry-period">${escapeHtml(period)}</span>` : "",
        item.location
          ? `<span class="resume-entry-period">${escapeHtml(item.location)}</span>`
          : "",
      ]
        .filter(Boolean)
        .join("");
      return `<article class="resume-entry">
          <div class="resume-entry-heading">${heading}</div>
          ${renderHighlights(item.highlights)}
        </article>`;
    })
    .join("");

  return blocks;
}

function renderProjects(items: ResumeContent["projects"]): string {
  if (!items?.length) return "";

  const blocks = items
    .map((item) => {
      const heading = [
        `<span class="resume-entry-title">${escapeHtml(item.name)}</span>`,
        item.role ? `<span class="resume-entry-org">${escapeHtml(item.role)}</span>` : "",
        item.period ? `<span class="resume-entry-period">${escapeHtml(item.period)}</span>` : "",
      ]
        .filter(Boolean)
        .join("");
      return `<article class="resume-entry">
          <div class="resume-entry-heading">${heading}</div>
          ${renderHighlights(item.highlights)}
        </article>`;
    })
    .join("");

  return blocks;
}

function renderEducation(items: ResumeContent["education"]): string {
  if (!items?.length) return "";

  const blocks = items
    .map((item) => {
      const heading = [
        `<span class="resume-entry-title">${escapeHtml(item.school)}</span>`,
        item.degree ? `<span class="resume-entry-org">${escapeHtml(item.degree)}</span>` : "",
        item.period ? `<span class="resume-entry-period">${escapeHtml(item.period)}</span>` : "",
      ]
        .filter(Boolean)
        .join("");
      return `<article class="resume-entry">
          <div class="resume-entry-heading">${heading}</div>
          ${renderHighlights(item.highlights)}
        </article>`;
    })
    .join("");

  return blocks;
}

function renderSkills(items: ResumeContent["skills"], dictionary: Dictionary): string {
  if (!items?.length) return "";

  const separator = t(dictionary, "common.itemSeparator");
  const groups = items
    .map((group) => {
      const values = (group.items || []).map((value) => escapeHtml(value)).join(separator);
      return `<div class="resume-skill-group">
          <span class="resume-skill-category">${escapeHtml(group.category)}</span>
          <span class="resume-skill-items">${values}</span>
        </div>`;
    })
    .join("");

  return groups;
}

function renderExtras(items: ResumeContent["extras"], dictionary: Dictionary): string {
  if (!items?.length) return "";

  const separator = t(dictionary, "common.itemSeparator");
  const groups = items
    .map((group) => {
      const values = (group.items || []).map((value) => escapeHtml(value)).join(separator);
      return `<div class="resume-skill-group">
          <span class="resume-skill-category">${escapeHtml(group.label)}</span>
          <span class="resume-skill-items">${values}</span>
        </div>`;
    })
    .join("");

  return groups;
}

/**
 * Renders the resume content model into the body markup that gets stored as
 * `resume.html`. Every user-supplied value is escaped, so the content can
 * never introduce markup of its own.
 *
 * The section headings come from the dictionary of the resume's own locale —
 * the resume language, not the browser's UI language.
 */
export async function renderResumeHtml(content: ResumeContent, locale: Locale): Promise<string> {
  const dictionary = await getDictionary(locale);
  const sections: string[] = [];

  sections.push(renderBasics(content.basics, dictionary));

  if (content.summary) {
    sections.push(
      renderSection(
        t(dictionary, "resume.sectionSummary"),
        `<p class="resume-text">${escapeHtml(content.summary)}</p>`
      )
    );
  }

  sections.push(
    renderSection(t(dictionary, "resume.sectionExperience"), renderExperience(content.experience))
  );
  sections.push(
    renderSection(t(dictionary, "resume.sectionProjects"), renderProjects(content.projects))
  );
  sections.push(
    renderSection(t(dictionary, "resume.sectionEducation"), renderEducation(content.education))
  );
  sections.push(
    renderSection(t(dictionary, "resume.sectionSkills"), renderSkills(content.skills, dictionary))
  );
  sections.push(
    renderSection(t(dictionary, "resume.sectionExtras"), renderExtras(content.extras, dictionary))
  );

  return `<div class="resume-page">${sections.filter(Boolean).join("")}</div>`;
}

// ===== Page assembly =====

function replaceAll(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(key, value);
  }
  return result;
}

/**
 * The preview shell: a status bar with the live-reload indicator, zoom
 * controls and the export menu. Preview mode only — the export document has
 * no toolbar.
 */
function renderPreviewShell(
  timestamp: string,
  dictionary: Dictionary,
  options: { liveEnabled: boolean; locale: Locale; path: string }
): string {
  const statusText = options.liveEnabled
    ? t(dictionary, "preview.statusLive")
    : t(dictionary, "preview.statusStatic");

  return `<div class="status-bar" lang="${options.locale}">
      <div class="toolbar-buttons">
        <span><span class="status-indicator" id="status-indicator"></span><span id="status-text">${escapeHtml(
          statusText
        )}</span></span>
        <div class="toolbar-buttons">
          <button class="toolbar-btn" id="back-button" title="${escapeHtml(
            t(dictionary, "preview.btnBack")
          )}">◄</button>
          <button class="toolbar-btn" id="zoom-out" title="${escapeHtml(
            t(dictionary, "preview.btnZoomOut")
          )}">−</button>
          <span class="zoom-level" id="zoom-level">100%</span>
          <button class="toolbar-btn" id="zoom-in" title="${escapeHtml(
            t(dictionary, "preview.btnZoomIn")
          )}">+</button>
          <button class="toolbar-btn" id="reset-pan" title="${escapeHtml(
            t(dictionary, "preview.btnReset")
          )}">⊙</button>
          <div class="export-dropdown">
            <button class="toolbar-btn" id="export-btn" title="${escapeHtml(
              t(dictionary, "preview.btnExport")
            )}">⬇</button>
            <div class="export-menu" id="export-menu">
              <button class="export-option" data-format="pdf">${escapeHtml(
                t(dictionary, "preview.exportPdf")
              )}</button>
              <button class="export-option" data-format="html">${escapeHtml(
                t(dictionary, "preview.exportHtml")
              )}</button>
            </div>
          </div>
          ${renderLanguageSwitcher(dictionary, options.locale, options.path)}
        </div>
      </div>
      <div id="last-update">${escapeHtml(
        t(dictionary, "preview.lastUpdated", { time: escapeHtml(timestamp) })
      )}</div>
    </div>`;
}

/**
 * Builds the full preview page around an already rendered resume body.
 * The live server calls this per request so the port and the live-reload
 * flag always reflect the current session.
 *
 * The chrome is rendered in the UI locale, the resume body keeps the
 * language it was written in.
 */
export async function createResumeHtmlWrapper(
  bodyHtml: string,
  options: ResumePageOptions
): Promise<string> {
  const template = await loadResumeTemplate();
  const dictionary = await getDictionary(options.locale);
  const timestamp = options.timestamp ?? new Date().toLocaleTimeString(options.locale);

  return replaceAll(template, {
    [TEMPLATE_VARS.RESUME_ID]: escapeHtml(options.resumeId),
    [TEMPLATE_VARS.PORT]: options.port.toString(),
    [TEMPLATE_VARS.LIVE_ENABLED]: options.liveEnabled ? "true" : "false",
    [TEMPLATE_VARS.CONTENT]: `<div class="resume-viewport"><div class="resume-sheet" lang="${options.resumeLocale}">${bodyHtml}</div></div>`,
    [TEMPLATE_VARS.PAGE_TITLE]: escapeHtml(options.resumeId),
    [TEMPLATE_VARS.PAGE_HEAD]: `<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/shared.css" />
    <link rel="stylesheet" href="/resume.css" />`,
    [TEMPLATE_VARS.BODY_ATTRIBUTES]: "",
    [TEMPLATE_VARS.PAGE_SHELL]: renderPreviewShell(timestamp, dictionary, {
      liveEnabled: options.liveEnabled,
      locale: options.locale,
      path: options.path ?? RESUME_ROUTES.VIEW + options.resumeId,
    }),
    [TEMPLATE_VARS.PAGE_SCRIPTS]: `<script src="${ROUTES.I18N_SCRIPT}"></script>
    <script src="${RESUME_ROUTES.SCRIPT}"></script>`,
    [TEMPLATE_VARS.LANG]: getHtmlLang(dictionary, options.locale),
    [TEMPLATE_VARS.LANG_SWITCH]: "",
  });
}

/**
 * Builds the standalone HTML document that is written to
 * `resume.export.html`. It carries its own inlined styles so it can be
 * opened directly in a browser.
 *
 * The document is entirely in the resume's own language — it has no chrome
 * to translate and no request to read a language from.
 */
export async function renderResumeExportHtml(
  content: ResumeContent,
  locale: Locale
): Promise<string> {
  const template = await loadResumeTemplate();
  const styles = await loadResumeStyles();
  const dictionary = await getDictionary(locale);
  const bodyHtml = await renderResumeHtml(content, locale);
  const title = content.basics?.name || t(dictionary, "resume.docTitle");

  return replaceAll(template, {
    [TEMPLATE_VARS.RESUME_ID]: "",
    [TEMPLATE_VARS.PORT]: "",
    [TEMPLATE_VARS.LIVE_ENABLED]: "false",
    [TEMPLATE_VARS.CONTENT]: bodyHtml,
    [TEMPLATE_VARS.PAGE_TITLE]: escapeHtml(title),
    [TEMPLATE_VARS.PAGE_HEAD]: `<style>
    ${styles}
    </style>`,
    [TEMPLATE_VARS.BODY_ATTRIBUTES]: ` class="resume-export"`,
    [TEMPLATE_VARS.PAGE_SHELL]: "",
    [TEMPLATE_VARS.PAGE_SCRIPTS]: "",
    [TEMPLATE_VARS.LANG]: getHtmlLang(dictionary, locale),
    [TEMPLATE_VARS.LANG_SWITCH]: "",
  });
}

// ===== PDF rendering =====

let browserPromise: Promise<Browser> | null = null;
let renderQueue: Promise<unknown> = Promise.resolve();

/**
 * Launches (or reuses) a single headless Chromium instance. Rendering is
 * serialized through a queue so two concurrent exports cannot fight over the
 * same browser.
 */
export async function ensureBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: true,
        args: ["--disable-gpu", "--disable-dev-shm-usage"],
      })
      .catch((error) => {
        browserPromise = null;
        throw error;
      });
  }
  return browserPromise;
}

/**
 * Closes the headless browser if one is running.
 */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    const browser = await pending;
    await browser.close();
  } catch (error) {
    mcpLogger.debug("Failed to close the resume browser", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function enqueueRender<T>(task: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(task, task);
  renderQueue = result.catch(() => undefined);
  return result;
}

/**
 * Renders the resume to a PDF.
 *
 * Page margins come from the template's `@page` rule; puppeteer's `margin`
 * option would override it, so it is deliberately left unset.
 *
 * The document language is the resume's own locale — the export never
 * depends on the language of the request that triggered it.
 */
export async function renderResumePdf(
  content: ResumeContent,
  locale: Locale,
  options: { detectFont?: FontDetector } = {}
): Promise<Buffer> {
  // Only a document that actually contains CJK characters needs a CJK font.
  // A pure-Latin resume renders fine with the generic sans-serif fallback.
  // The check runs before Chromium is launched, so a font-less machine fails
  // immediately instead of paying the browser startup first.
  await assertPdfFontAvailable(content, locale, options.detectFont);

  const html = await renderResumeExportHtml(content, locale);

  return enqueueRender(async () => {
    const browser = await ensureBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "load" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  });
}

// ===== CJK font detection =====

const WINDOWS_CJK_FONT_FILES = CJK_FONT_FILES;

/**
 * Whether a value anywhere in the resume content contains characters that need
 * a CJK-capable font.
 */
function containsCjkCharacters(value: unknown): boolean {
  if (typeof value === "string") return CJK_CHAR_REGEX.test(value);
  if (Array.isArray(value)) return value.some(containsCjkCharacters);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(containsCjkCharacters);
  }
  return false;
}

/**
 * Whether this resume needs a CJK font to render.
 *
 * Two independent sources can introduce CJK characters:
 *
 * - the resume's own locale: the zh-CN dictionary supplies the section headings
 *   (工作经历), the item separator (、) and the placeholders (你的名字 / 简历),
 *   so a zh-CN resume needs one even when its content is written in English.
 *   That rule is written out explicitly rather than left to the character scan,
 *   because a zh-CN resume with nothing but a Latin name and no sections would
 *   otherwise scan as "no CJK needed" while its document title is still Chinese;
 * - the content itself, which may hold Chinese (or Japanese, Korean) text.
 *
 * A pure-Latin resume needs no CJK font: the resume font stack falls back to
 * the generic `sans-serif` family, which is always present.
 */
export function resumeNeedsCjkFont(content: ResumeContent, locale: Locale): boolean {
  if ((CJK_ALWAYS_LOCALES as readonly string[]).includes(locale)) return true;
  return containsCjkCharacters(content);
}

/**
 * Reports whether the machine has a CJK-capable font.
 *
 * The detector is injectable so the export gate can be tested without a
 * font-less machine.
 */
export type FontDetector = () => Promise<boolean | null>;

/**
 * Checks whether the machine has a font that can render Chinese.
 *
 * Returns `true`/`false` when the check could be performed and `null` when
 * the platform offers no way to tell — the caller then logs a warning and
 * carries on rather than blocking a Chinese export on a minimal container.
 */
export async function detectCjkFont(): Promise<boolean | null> {
  if (process.platform === "win32") {
    const fontDir = join(process.env.WINDIR || "C:\\Windows", "Fonts");
    for (const file of WINDOWS_CJK_FONT_FILES) {
      if (existsSync(join(fontDir, file))) return true;
    }
    return false;
  }

  try {
    const { stdout } = await execFileAsync("fc-list", [":lang=zh", "family"]);
    return stdout.trim().length > 0;
  } catch {
    return null;
  }
}

/**
 * Fails loudly when the machine cannot render Chinese, instead of silently
 * producing a PDF full of tofu boxes.
 *
 * Only called for documents that actually need a CJK font — see
 * `resumeNeedsCjkFont`.
 */
export async function assertCjkFontAvailable(detect: FontDetector = detectCjkFont): Promise<void> {
  const available = await detect();
  if (available === true) return;

  if (available === null) {
    mcpLogger.warn(
      "Could not determine whether a CJK font is installed; PDF export may render Chinese incorrectly"
    );
    return;
  }

  throw new Error(
    "No CJK font found for PDF export. Install a Chinese font (e.g. Microsoft YaHei, Noto Sans CJK SC) and try again."
  );
}

/**
 * The font gate for PDF export: fails when the document needs a CJK font and
 * the machine has none. A document without CJK characters never consults the
 * detector at all.
 */
export async function assertPdfFontAvailable(
  content: ResumeContent,
  locale: Locale,
  detect: FontDetector = detectCjkFont
): Promise<void> {
  if (!resumeNeedsCjkFont(content, locale)) return;
  await assertCjkFontAvailable(detect);
}
