/**
 * Client-side internationalization
 *
 * The page chrome is rendered by the server in the request language, so the
 * dictionary is only needed for strings that are produced at runtime — counts,
 * relative times, confirmation dialogs and status changes.
 *
 * The dictionary is fetched from the same origin; the Content Security
 * Policy forbids inline scripts, so it cannot be embedded in the page.
 */

(function () {
  const DEFAULT_LOCALE = "zh-CN";
  const FALLBACK_LOCALE = "en";

  let dictionary = {};
  let locale = DEFAULT_LOCALE;

  /**
   * The server puts the request language on the <html> element.
   */
  function detectLocale() {
    const declared = (document.documentElement.getAttribute("lang") || "").trim();
    if (declared === "zh-CN" || declared === FALLBACK_LOCALE) return declared;

    const prefix = declared.split("-")[0].toLowerCase();
    if (prefix === "zh") return "zh-CN";
    if (prefix === "en") return FALLBACK_LOCALE;

    return DEFAULT_LOCALE;
  }

  function lookup(key) {
    let current = dictionary;

    for (const part of key.split(".")) {
      if (typeof current !== "object" || current === null) return undefined;
      current = current[part];
    }

    return typeof current === "string" ? current : undefined;
  }

  function interpolate(template, vars) {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, function (match, name) {
      const value = vars[name];
      return value === undefined ? match : String(value);
    });
  }

  /**
   * Looks up a dotted key and substitutes {placeholders}.
   */
  function t(key, vars) {
    const raw = lookup(key);
    if (raw === undefined) return key;
    return interpolate(raw, vars);
  }

  /**
   * Formats a timestamp as relative time ("2 minutes ago").
   * Intl handles the plural rules, so Chinese and English both come out right.
   */
  function relativeTime(date) {
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    const diffMs = new Date(date).getTime() - Date.now();
    const diffSec = Math.round(diffMs / 1000);
    const diffMin = Math.round(diffSec / 60);
    const diffHour = Math.round(diffMin / 60);
    const diffDay = Math.round(diffHour / 24);

    if (Math.abs(diffSec) < 60) return formatter.format(0, "second");
    if (Math.abs(diffMin) < 60) return formatter.format(-diffMin, "minute");
    if (Math.abs(diffHour) < 24) return formatter.format(-diffHour, "hour");
    if (Math.abs(diffDay) < 7) return formatter.format(-diffDay, "day");

    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(date));
  }

  /**
   * Points the language switch links at the current URL with only the `lang`
   * parameter replaced, so the other query parameters survive the switch.
   * The server already renders working links — this only refines them.
   */
  function setupLanguageSwitch() {
    const links = document.querySelectorAll(".lang-option");
    links.forEach(function (link) {
      const lang = link.getAttribute("hreflang");
      if (!lang) return;
      const url = new URL(window.location.href);
      url.searchParams.set("lang", lang);
      link.setAttribute("href", url.pathname + url.search + url.hash);
    });
  }

  /**
   * Resolves once the dictionary is loaded. Callers that render runtime
   * strings wait for it, so no untranslated text is ever shown.
   */
  const ready = (async function () {
    locale = detectLocale();
    try {
      const response = await fetch("/i18n/" + encodeURIComponent(locale) + ".json", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error("HTTP " + response.status + ": " + response.statusText);
      }
      dictionary = await response.json();
    } catch (error) {
      console.warn("Failed to load the translation dictionary:", error);
    }
    setupLanguageSwitch();
  })();

  window.RPI18n = {
    ready: ready,
    t: t,
    relativeTime: relativeTime,
    get locale() {
      return locale;
    },
  };
})();
