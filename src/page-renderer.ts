/**
 * Page Renderer
 * Single Responsibility: Generic page rendering with template composition
 * Open/Closed Principle: Easy to add new pages without modifying this code
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { TEMPLATE_VARS, ROUTES, DEFAULT_UI_LOCALE } from "./constants.js";
import { PageData, PageRenderOptions } from "./types.js";
import { webLogger } from "./logger.js";
import { escapeHtml } from "./html-utils.js";
import { getDictionary, getHtmlLang, renderLanguageSwitcher, t, type Dictionary } from "./i18n.js";

export { escapeHtml };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PREVIEW_DIR = join(__dirname, "preview");

// Template cache for performance
const templateCache = new Map<string, string>();

/**
 * Loads a template file with caching
 * @param filename Template filename
 * @returns Template content
 */
async function loadTemplate(filename: string): Promise<string> {
  if (templateCache.has(filename)) {
    return templateCache.get(filename)!;
  }

  const filePath = join(PREVIEW_DIR, filename);
  const content = await readFile(filePath, "utf-8");
  templateCache.set(filename, content);

  webLogger.debug(`Loaded template: ${filename}`);
  return content;
}

/**
 * Replaces template variables with actual values
 * @param template Template string
 * @param data Data object with variable values
 * @param escape Whether to HTML-escape values (default: true)
 * @returns Processed template
 */
function replaceVariables(template: string, data: PageData, escape: boolean = true): string {
  let result = template;

  for (const [key, value] of Object.entries(data)) {
    const placeholder = `{{${key}}}`;
    const stringValue = String(value ?? "");
    const processedValue = escape ? escapeHtml(stringValue) : stringValue;
    result = result.replaceAll(placeholder, processedValue);
  }

  return result;
}

/**
 * Replaces `{{i18n:some.key}}` placeholders with the translation of that key.
 *
 * Templates use this instead of a template variable per string, so adding a
 * translated label does not mean touching the constants and the type of the
 * page data.
 */
function replaceI18nPlaceholders(template: string, dictionary: Dictionary): string {
  return template.replace(/\{\{i18n:([A-Za-z0-9_.]+)\}\}/g, (_match, key: string) =>
    escapeHtml(t(dictionary, key))
  );
}

/**
 * Generates navigation HTML
 * @param port Server port for links
 * @param dictionary Translations for the current locale
 * @returns Navigation HTML
 */
function generateNav(port: number, dictionary: Dictionary): string {
  const baseUrl = `http://localhost:${port}`;

  return `
    <nav class="nav">
      <a href="${baseUrl}${ROUTES.GALLERY}" class="nav-link">${escapeHtml(
        t(dictionary, "gallery.navGallery")
      )}</a>
    </nav>
  `;
}

/**
 * Generates footer HTML
 * @param dictionary Translations for the current locale
 * @returns Footer HTML
 */
function generateFooter(dictionary: Dictionary): string {
  return `
    <footer class="footer">
      <p>${escapeHtml(t(dictionary, "gallery.footerText"))}</p>
    </footer>
  `;
}

/**
 * Renders a complete page with layout
 * @param contentTemplate Name of the content template file
 * @param data Data for template variables
 * @param options Rendering options
 * @returns Complete HTML page
 */
export async function renderPage(
  contentTemplate: string,
  data: PageData,
  options: PageRenderOptions = {}
): Promise<string> {
  const {
    title,
    titleKey,
    styles = [],
    scripts = [],
    includeNav = true,
    includeFooter = false,
    locale = DEFAULT_UI_LOCALE,
    path = ROUTES.ROOT,
  } = options;

  try {
    const dictionary = await getDictionary(locale);

    // Load content template
    const contentHtml = await loadTemplate(contentTemplate);

    // Generate style links
    const styleLinks = styles.map((style) => `<link rel="stylesheet" href="${style}">`).join("\n");

    // Generate script tags. The i18n module comes first — the other scripts
    // wait for its dictionary before they render runtime strings.
    const scriptTags = [
      `<script src="${ROUTES.I18N_SCRIPT}"></script>`,
      ...scripts.map((script) => `<script src="${script}"></script>`),
    ].join("\n");

    // Generate navigation if requested
    const nav = includeNav && data.PORT ? generateNav(Number(data.PORT), dictionary) : "";

    // Generate footer if requested
    const footer = includeFooter ? generateFooter(dictionary) : "";

    // Combine data with layout components
    const pageData: PageData = {
      ...data,
      PAGE_TITLE: titleKey
        ? t(dictionary, titleKey)
        : (title ?? t(dictionary, "gallery.pageTitle")),
      PAGE_STYLES: styleLinks,
      PAGE_SCRIPTS: scriptTags,
      NAV: nav,
      FOOTER: footer,
      LANG: getHtmlLang(dictionary, locale),
      LANG_SWITCH: renderLanguageSwitcher(dictionary, locale, path),
    };

    // Replace variables in content template (content may include HTML, don't escape)
    const processedContent = replaceI18nPlaceholders(
      replaceVariables(contentHtml, pageData, false),
      dictionary
    );

    webLogger.debug(`Rendered page: ${contentTemplate}`, {
      hasNav: includeNav,
      hasFooter: includeFooter,
      stylesCount: styles.length,
      scriptsCount: scripts.length,
      locale,
    });

    return processedContent;
  } catch (error) {
    webLogger.error(`Failed to render page: ${contentTemplate}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Page rendering failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Clears the template cache
 * Useful for development when templates are modified
 */
export function clearTemplateCache(): void {
  templateCache.clear();
  webLogger.debug("Template cache cleared");
}
