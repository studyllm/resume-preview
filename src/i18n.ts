/**
 * Internationalization
 * Single Responsibility: resolve a locale and look up translated strings.
 *
 * Two locale axes live here:
 *  - the UI language, resolved per request from the query string or the
 *    Accept-Language header;
 *  - the resume language, persisted per resume in options.json.
 *
 * The dictionaries are plain JSON files shared by the server and the browser,
 * so a key can never exist on one side only.
 */

import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  SUPPORTED_LOCALES,
  DEFAULT_UI_LOCALE,
  FALLBACK_LOCALE,
  I18N_DIR,
  I18N_FILE_SUFFIX,
  LOCALE_LABEL_KEYS,
} from "./constants.js";
import type { Locale } from "./types.js";
import { webLogger } from "./logger.js";
import { escapeHtml } from "./html-utils.js";

export type { Locale };

export type Dictionary = { [key: string]: string | Dictionary };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DICTIONARY_DIR = join(__dirname, "preview", I18N_DIR);

const rawCache = new Map<Locale, Dictionary>();
const mergedCache = new Map<Locale, Dictionary>();

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function isDictionary(value: unknown): value is Dictionary {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Loads one dictionary file. A missing or broken file yields an empty
 * dictionary rather than an exception — a missing translation must never
 * take the page down.
 */
async function loadRawDictionary(locale: Locale): Promise<Dictionary> {
  const cached = rawCache.get(locale);
  if (cached) return cached;

  let dictionary: Dictionary = {};
  try {
    const content = await readFile(getDictionaryFilePath(locale), "utf-8");
    dictionary = JSON.parse(content) as Dictionary;
  } catch (error) {
    webLogger.warn(`Failed to load dictionary for locale: ${locale}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  rawCache.set(locale, dictionary);
  return dictionary;
}

function mergeDictionaries(base: Dictionary, overlay: Dictionary): Dictionary {
  const result: Dictionary = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = result[key];
    if (isDictionary(existing) && isDictionary(value)) {
      result[key] = mergeDictionaries(existing, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Returns the dictionary for a locale, with the fallback language merged
 * underneath it. A key missing from the requested language falls back to the
 * fallback language rather than showing the raw key.
 */
export async function getDictionary(locale: Locale): Promise<Dictionary> {
  const cached = mergedCache.get(locale);
  if (cached) return cached;

  const fallback = await loadRawDictionary(FALLBACK_LOCALE);
  const overlay = locale === FALLBACK_LOCALE ? {} : await loadRawDictionary(locale);
  const merged = mergeDictionaries(fallback, overlay);

  mergedCache.set(locale, merged);
  return merged;
}

function lookup(dictionary: Dictionary, key: string): string | undefined {
  let current: string | Dictionary | undefined = dictionary;

  for (const part of key.split(".")) {
    if (!isDictionary(current)) return undefined;
    current = current[part];
  }

  return typeof current === "string" ? current : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Looks up a dotted key and substitutes `{placeholders}`.
 * Returns the key itself when the dictionary has no such entry.
 */
export function t(
  dictionary: Dictionary,
  key: string,
  vars?: Record<string, string | number>
): string {
  const raw = lookup(dictionary, key);
  if (raw === undefined) return key;
  return interpolate(raw, vars);
}

/**
 * The value for the `<html lang>` attribute. Falls back to the locale code.
 */
export function getHtmlLang(dictionary: Dictionary, locale: Locale): string {
  return lookup(dictionary, "meta.htmlLang") ?? locale;
}

/**
 * Matches a language tag against the supported locales.
 * "en" and "en-US" both resolve to "en"; "zh" resolves to "zh-CN".
 */
export function matchLocale(tag: string): Locale | null {
  const trimmed = tag.trim();
  if (!trimmed) return null;
  if (isSupportedLocale(trimmed)) return trimmed;

  const prefix = trimmed.split("-")[0].toLowerCase();
  const matched = SUPPORTED_LOCALES.find((locale) => locale.split("-")[0].toLowerCase() === prefix);
  return matched ?? null;
}

/**
 * Parses an Accept-Language header and returns the first supported locale.
 */
export function parseAcceptLanguage(header: string | undefined): Locale | null {
  if (!header) return null;

  const candidates = header.split(",").map((part, index) => {
    const [tag, ...params] = part.trim().split(";");
    const qParam = params.find((param) => param.trim().startsWith("q="));
    const parsed = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
    return {
      tag: tag.trim(),
      quality: Number.isFinite(parsed) ? parsed : 0,
      index,
    };
  });

  candidates.sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const candidate of candidates) {
    const locale = matchLocale(candidate.tag);
    if (locale) return locale;
  }

  return null;
}

export interface LocaleRequestHints {
  /** Value of the `lang` query parameter, if any. */
  query?: string | undefined;
  /** Value of the Accept-Language header, if any. */
  acceptLanguage?: string | undefined;
}

/**
 * Resolves the UI locale: the query parameter wins, then the header, then
 * the default. An unsupported query value is ignored rather than rejected —
 * a bad query parameter must not turn into an error page.
 */
export function resolveLocale(hints: LocaleRequestHints = {}): Locale {
  const fromQuery = hints.query ? matchLocale(hints.query) : null;
  if (fromQuery) return fromQuery;

  const fromHeader = parseAcceptLanguage(hints.acceptLanguage);
  if (fromHeader) return fromHeader;

  return DEFAULT_UI_LOCALE;
}

/**
 * The path of a dictionary file. The locale must already be whitelisted —
 * this value is joined into a path and must never carry user input.
 */
export function getDictionaryFilePath(locale: Locale): string {
  return join(DICTIONARY_DIR, `${locale}${I18N_FILE_SUFFIX}`);
}

/**
 * Renders the language switcher: one link per supported language, pointing
 * at the current page with the `lang` query parameter replaced.
 *
 * The links work without JavaScript. The client refines them afterwards to
 * keep the other query parameters of the current URL.
 */
export function renderLanguageSwitcher(
  dictionary: Dictionary,
  locale: Locale,
  path: string
): string {
  const groupLabel = escapeHtml(t(dictionary, "common.switchLanguage"));

  const options = SUPPORTED_LOCALES.map((option) => {
    const labelKey = LOCALE_LABEL_KEYS[option] ?? "meta.label";
    const text = escapeHtml(t(dictionary, labelKey));
    const active = option === locale;
    const current = active ? ' aria-current="true"' : "";
    const activeClass = active ? " is-active" : "";

    return `<a class="lang-option${activeClass}" href="${escapeHtml(path)}?lang=${encodeURIComponent(
      option
    )}" hreflang="${option}" lang="${option}"${current}>${text}</a>`;
  }).join("");

  return `<div class="lang-switch" role="group" aria-label="${groupLabel}">${options}</div>`;
}

/**
 * Clears the dictionary caches. Useful in tests and development.
 */
export function clearDictionaryCache(): void {
  rawCache.clear();
  mergedCache.clear();
}
