/**
 * Unit tests for the internationalization module and the dictionary route.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  clearDictionaryCache,
  getDictionary,
  isSupportedLocale,
  matchLocale,
  parseAcceptLanguage,
  resolveLocale,
  t,
} from "../src/i18n.js";
import { DEFAULT_UI_LOCALE, SUPPORTED_LOCALES } from "../src/constants.js";
// The mock has to be registered before live-server is loaded
import { mockFetch, resetServerState } from "./live-server/server-setup.js";
import { ensureLiveServer, closeLiveServer } from "../src/live-server.js";
import { setupTestEnv, restoreTestEnv } from "./helpers/env-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const I18N_DIR = join(__dirname, "..", "src", "preview", "i18n");

/**
 * Flattens a nested dictionary into dotted keys.
 */
function flattenKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key)
  );
}

describe("i18n", () => {
  describe("dictionaries", () => {
    it("should ship a dictionary for every supported locale", async () => {
      for (const locale of SUPPORTED_LOCALES) {
        const content = await readFile(join(I18N_DIR, `${locale}.json`), "utf-8");
        expect(() => JSON.parse(content)).not.toThrow();
      }
    });

    it("should have the same keys in every locale", async () => {
      const keySets = await Promise.all(
        SUPPORTED_LOCALES.map(async (locale) => {
          const content = await readFile(join(I18N_DIR, `${locale}.json`), "utf-8");
          return flattenKeys(JSON.parse(content)).sort();
        })
      );

      const [reference, ...others] = keySets;
      for (const keys of others) {
        expect(keys).toEqual(reference);
      }
    });

    it("should fall back to English for a key a locale is missing", async () => {
      const english = await getDictionary("en");
      const chinese = await getDictionary("zh-CN");

      expect(t(english, "resume.sectionExperience")).toBe("Experience");
      // The Chinese dictionary has the key, so it wins over the fallback
      expect(t(chinese, "resume.sectionExperience")).toBe("工作经历");
      // A key nobody has falls back to the key itself
      expect(t(chinese, "resume.doesNotExist")).toBe("resume.doesNotExist");
    });

    it("should reload the dictionaries after the cache is cleared", async () => {
      clearDictionaryCache();
      const dictionary = await getDictionary("zh-CN");
      expect(t(dictionary, "gallery.title")).toBe("简历画廊");
    });
  });

  describe("t", () => {
    it("should substitute placeholders", async () => {
      const dictionary = await getDictionary("en");
      expect(t(dictionary, "gallery.deleteConfirm", { id: "r-1" })).toContain("r-1");
    });

    it("should leave unknown placeholders untouched", async () => {
      const dictionary = await getDictionary("en");
      expect(t(dictionary, "gallery.deleteConfirm", {})).toContain("{id}");
    });
  });

  describe("matchLocale", () => {
    it("should match an exact locale", () => {
      expect(matchLocale("zh-CN")).toBe("zh-CN");
      expect(matchLocale("en")).toBe("en");
    });

    it("should match a region variant by its language", () => {
      expect(matchLocale("en-US")).toBe("en");
      expect(matchLocale("en-GB")).toBe("en");
    });

    it("should match a bare language tag", () => {
      expect(matchLocale("zh")).toBe("zh-CN");
    });

    it("should return null for an unsupported language", () => {
      expect(matchLocale("fr")).toBeNull();
      expect(matchLocale("")).toBeNull();
    });
  });

  describe("parseAcceptLanguage", () => {
    it("should take the highest quality supported language", () => {
      expect(parseAcceptLanguage("fr;q=0.9, en;q=0.8, zh-CN;q=0.7")).toBe("en");
    });

    it("should fall through an unsupported language", () => {
      expect(parseAcceptLanguage("fr, en")).toBe("en");
    });

    it("should return null without a header", () => {
      expect(parseAcceptLanguage(undefined)).toBeNull();
      expect(parseAcceptLanguage("")).toBeNull();
    });
  });

  describe("resolveLocale", () => {
    it("should prefer the query parameter", () => {
      expect(resolveLocale({ query: "en", acceptLanguage: "zh-CN,zh;q=0.9" })).toBe("en");
    });

    it("should fall back to the header when the query is unsupported", () => {
      expect(resolveLocale({ query: "fr", acceptLanguage: "zh-CN,zh;q=0.9" })).toBe("zh-CN");
    });

    it("should use the default without any hint", () => {
      expect(resolveLocale()).toBe(DEFAULT_UI_LOCALE);
    });

    it("should only accept supported locales", () => {
      expect(isSupportedLocale("en")).toBe(true);
      expect(isSupportedLocale("fr")).toBe(false);
      expect(isSupportedLocale(42)).toBe(false);
    });
  });

  describe("dictionary route", () => {
    beforeEach(async () => {
      await setupTestEnv();
      await closeLiveServer();
      resetServerState();
    });

    afterEach(async () => {
      await closeLiveServer();
      await restoreTestEnv();
      resetServerState();
    });

    it("should serve a supported dictionary", async () => {
      const port = await ensureLiveServer();
      const response = await mockFetch(`http://localhost:${port}/i18n/zh-CN.json`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");

      const body = await response.json();
      expect(body.gallery.title).toBe("简历画廊");
    });

    it("should reject an unsupported locale", async () => {
      const port = await ensureLiveServer();
      const response = await mockFetch(`http://localhost:${port}/i18n/fr.json`);

      expect(response.status).toBe(404);
    });

    it("should reject a path traversal attempt", async () => {
      const port = await ensureLiveServer();
      const response = await mockFetch(`http://localhost:${port}/i18n/..%2f..%2fetc%2fpasswd.json`);

      expect(response.status).toBe(404);
    });

    it("should reject a request without a locale", async () => {
      const port = await ensureLiveServer();
      const response = await mockFetch(`http://localhost:${port}/i18n/`);

      expect(response.status).toBe(404);
    });
  });

  describe("gallery page language", () => {
    beforeEach(async () => {
      await setupTestEnv();
      await closeLiveServer();
      resetServerState();
    });

    afterEach(async () => {
      await closeLiveServer();
      await restoreTestEnv();
      resetServerState();
    });

    it("should render the gallery in the language of the query parameter", async () => {
      const port = await ensureLiveServer();
      const response = await mockFetch(`http://localhost:${port}/?lang=en`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-language")).toBe("en");

      const body = await response.text();
      expect(body).toContain("Resume Gallery");
      expect(body).not.toContain("简历画廊");
    });

    it("should render the gallery in the language of the header", async () => {
      const port = await ensureLiveServer();
      const response = await mockFetch(`http://localhost:${port}/`, {
        headers: { "accept-language": "en-US,en;q=0.9" },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-language")).toBe("en");
      expect(await response.text()).toContain("Resume Gallery");
    });

    it("should render the gallery in Chinese by default", async () => {
      const port = await ensureLiveServer();
      const response = await mockFetch(`http://localhost:${port}/`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-language")).toBe(DEFAULT_UI_LOCALE);
      expect(await response.text()).toContain("简历画廊");
    });

    it("should offer a language switcher", async () => {
      const port = await ensureLiveServer();
      const body = await (await mockFetch(`http://localhost:${port}/`)).text();

      expect(body).toContain("lang-switch");
      expect(body).toContain('hreflang="en"');
      expect(body).toContain('hreflang="zh-CN"');
    });
  });
});
