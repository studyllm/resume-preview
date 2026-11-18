/**
 * Unit tests for the resume renderer
 */

import { describe, it, expect, vi } from "vitest";
import {
  renderResumeHtml,
  createResumeHtmlWrapper,
  renderResumeExportHtml,
  detectCjkFont,
  resumeNeedsCjkFont,
  assertPdfFontAvailable,
  clearResumeTemplateCache,
} from "../src/resume-renderer.js";
import { CJK_CHAR_REGEX } from "../src/constants.js";

const sampleContent = {
  basics: {
    name: "王小明",
    title: "高级前端工程师",
    email: "wang@example.com",
    phone: "138-0000-0000",
    location: "上海",
    links: [{ label: "GitHub", url: "https://github.com/example" }],
  },
  summary: "8 年前端经验。",
  experience: [
    {
      company: "某某科技",
      title: "高级前端工程师",
      start: "2021-03",
      end: "至今",
      location: "上海",
      highlights: ["首屏从 4.2s 降到 1.1s", "带 5 人团队"],
    },
  ],
  projects: [{ name: "某项目", role: "负责人", period: "2022", highlights: ["上线了"] }],
  education: [{ school: "某某大学", degree: "本科", period: "2014-2018" }],
  skills: [{ category: "前端", items: ["TypeScript", "React"] }],
  extras: [{ label: "证书", items: ["软考高级"] }],
};

describe("Resume renderer", () => {
  describe("renderResumeHtml", () => {
    it("should render the basics", async () => {
      const html = await renderResumeHtml(sampleContent, "zh-CN");
      expect(html).toContain("王小明");
      expect(html).toContain("高级前端工程师");
      expect(html).toContain("wang@example.com");
      expect(html).toContain("138-0000-0000");
    });

    it("should render every section", async () => {
      const html = await renderResumeHtml(sampleContent, "zh-CN");
      expect(html).toContain("工作经历");
      expect(html).toContain("某某科技");
      expect(html).toContain("项目经历");
      expect(html).toContain("教育经历");
      expect(html).toContain("某某大学");
      expect(html).toContain("专业技能");
      expect(html).toContain("TypeScript");
      expect(html).toContain("自我评价");
    });

    it("should render the section headings in the resume language", async () => {
      const html = await renderResumeHtml(sampleContent, "en");
      expect(html).toContain("Experience");
      expect(html).toContain("Projects");
      expect(html).toContain("Education");
      expect(html).toContain("Skills");
      expect(html).toContain("Summary");
      expect(html).not.toContain("工作经历");
    });

    it("should join the skill items with the locale's separator", async () => {
      const chinese = await renderResumeHtml(sampleContent, "zh-CN");
      expect(chinese).toContain("TypeScript、React");

      const english = await renderResumeHtml(sampleContent, "en");
      expect(english).toContain("TypeScript, React");
    });

    it("should omit sections that are absent", async () => {
      const html = await renderResumeHtml({ basics: { name: "只有名字" } }, "zh-CN");
      expect(html).toContain("只有名字");
      expect(html).not.toContain("工作经历");
      expect(html).not.toContain("教育经历");
      expect(html).not.toContain("专业技能");
    });

    it("should use a placeholder when the name is missing", async () => {
      const html = await renderResumeHtml({ basics: {} }, "zh-CN");
      expect(html).toContain("你的名字");

      const english = await renderResumeHtml({ basics: {} }, "en");
      expect(english).toContain("Your Name");
    });

    it("should escape HTML in the content", async () => {
      const html = await renderResumeHtml(
        {
          basics: { name: "<script>alert(1)</script>" },
          summary: "<img src=x onerror=alert(1)>",
        },
        "zh-CN"
      );
      // No raw tag is introduced — the markup only ever appears as text
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("&lt;img");
    });

    it("should escape HTML inside highlights", async () => {
      const html = await renderResumeHtml(
        {
          basics: { name: "A" },
          experience: [{ company: "<b>x</b>", highlights: ["<i>y</i>"] }],
        },
        "zh-CN"
      );
      expect(html).not.toContain("<b>");
      expect(html).not.toContain("<i>");
    });
  });

  describe("createResumeHtmlWrapper", () => {
    it("should build a live preview page", async () => {
      const body = await renderResumeHtml(sampleContent, "zh-CN");
      const html = await createResumeHtmlWrapper(body, {
        resumeId: "r-1",
        port: 3737,
        liveEnabled: true,
        locale: "zh-CN",
        resumeLocale: "zh-CN",
      });

      expect(html).toContain('data-resume-id="r-1"');
      expect(html).toContain('data-port="3737"');
      expect(html).toContain('data-live-enabled="true"');
      expect(html).toContain("/resume.js");
      expect(html).toContain("/resume.css");
      expect(html).toContain("王小明");
      expect(html).toContain("status-indicator");
    });

    it("should mark a static page as not live", async () => {
      const html = await createResumeHtmlWrapper(await renderResumeHtml(sampleContent, "zh-CN"), {
        resumeId: "r-1",
        port: 0,
        liveEnabled: false,
        locale: "zh-CN",
        resumeLocale: "zh-CN",
      });
      expect(html).toContain('data-live-enabled="false"');
    });

    it("should translate the chrome and keep the resume in its own language", async () => {
      const body = await renderResumeHtml(sampleContent, "zh-CN");
      const html = await createResumeHtmlWrapper(body, {
        resumeId: "r-1",
        port: 3737,
        liveEnabled: true,
        locale: "en",
        resumeLocale: "zh-CN",
      });

      // The chrome follows the request language
      expect(html).toContain('<html lang="en"');
      expect(html).toContain("Live Reload Active");
      expect(html).toContain("Download PDF");

      // The resume body keeps the language it was written in
      expect(html).toContain('lang="zh-CN"');
      expect(html).toContain("工作经历");
    });
  });

  describe("renderResumeExportHtml", () => {
    it("should produce a standalone document", async () => {
      const html = await renderResumeExportHtml(sampleContent, "zh-CN");

      expect(html).toContain('class="resume-export"');
      expect(html).toContain("<style>");
      expect(html).toContain("@page");
      expect(html).toContain("王小明");
      // No toolbar and no script in an exported document
      expect(html).not.toContain("status-indicator");
      expect(html).not.toContain("<script");
    });

    it("should export in the resume language", async () => {
      const html = await renderResumeExportHtml(sampleContent, "en");
      expect(html).toContain("Experience");
      expect(html).not.toContain("工作经历");
    });

    it("should inline the resume styles", async () => {
      const html = await renderResumeExportHtml(sampleContent, "zh-CN");
      expect(html).toContain(".resume-page");
      expect(html).not.toContain('<link rel="stylesheet"');
    });
  });

  describe("detectCjkFont", () => {
    it("should return a boolean or null", async () => {
      const result = await detectCjkFont();
      expect(result === null || typeof result === "boolean").toBe(true);
    });
  });

  describe("resumeNeedsCjkFont", () => {
    const englishContent = {
      basics: {
        name: "Alex Morgan",
        title: "Senior Backend Engineer",
        email: "alex@example.com",
        location: "Shanghai",
        links: [{ label: "GitHub", url: "https://github.com/example" }],
      },
      summary: "8 years of backend experience.",
      experience: [
        {
          company: "Northwind Systems",
          title: "Senior Backend Engineer",
          start: "2021-03",
          end: "Present",
          location: "Shanghai",
          highlights: ["Cut p99 latency from 800ms to 180ms"],
        },
      ],
      skills: [{ category: "Backend", items: ["Go", "Kafka"] }],
    };

    it("should always require a CJK font for a zh-CN resume", () => {
      // The zh-CN template injects Chinese headings and placeholders, so the
      // font is needed even when the content is written in English.
      expect(resumeNeedsCjkFont(englishContent, "zh-CN")).toBe(true);
    });

    it("should always require a CJK font for a zh-CN resume with no sections", () => {
      expect(resumeNeedsCjkFont({ basics: { name: "Alex Morgan" } }, "zh-CN")).toBe(true);
      expect(resumeNeedsCjkFont({}, "zh-CN")).toBe(true);
    });

    it("should not require a CJK font for a pure-Latin resume", () => {
      expect(resumeNeedsCjkFont(englishContent, "en")).toBe(false);
      expect(resumeNeedsCjkFont({}, "en")).toBe(false);
    });

    it("should require a CJK font when an English resume carries Chinese", () => {
      expect(resumeNeedsCjkFont({ basics: { name: "王某某" } }, "en")).toBe(true);
    });

    it("should require a CJK font for kana, hangul and CJK punctuation", () => {
      expect(resumeNeedsCjkFont({ summary: "エンジニア" }, "en")).toBe(true);
      expect(resumeNeedsCjkFont({ summary: "개발자" }, "en")).toBe(true);
      expect(resumeNeedsCjkFont({ summary: "A、B" }, "en")).toBe(true);
      expect(resumeNeedsCjkFont({ summary: "「引用」" }, "en")).toBe(true);
      expect(resumeNeedsCjkFont({ summary: "Ａ１" }, "en")).toBe(true);
    });

    it("should find CJK characters nested in the content model", () => {
      expect(
        resumeNeedsCjkFont({ basics: { name: "Alex", links: [{ label: "简历", url: "x" }] } }, "en")
      ).toBe(true);
    });

    it("should not mistake Latin accents or general punctuation for CJK", () => {
      expect(resumeNeedsCjkFont({ summary: "café naïve Müller" }, "en")).toBe(false);
      expect(resumeNeedsCjkFont({ summary: "2021-03 – Present · 100% … “quoted”" }, "en")).toBe(
        false
      );
    });

    it("should agree with what the rendered document actually contains", async () => {
      // Guards the rule "a zh-CN document always needs a CJK font": if a
      // locale ever ships dictionary entries with CJK characters, this fails
      // and the rule has to be extended.
      for (const locale of ["zh-CN", "en"] as const) {
        const html = await renderResumeExportHtml(englishContent, locale);
        expect(resumeNeedsCjkFont(englishContent, locale)).toBe(CJK_CHAR_REGEX.test(html));
      }
    });
  });

  describe("assertPdfFontAvailable", () => {
    const englishContent = {
      basics: { name: "Alex Morgan", title: "Senior Backend Engineer" },
      summary: "8 years of backend experience.",
    };

    it("should not consult the detector for a pure-Latin document", async () => {
      const detect = vi.fn(async () => false);
      await expect(assertPdfFontAvailable(englishContent, "en", detect)).resolves.toBeUndefined();
      expect(detect).not.toHaveBeenCalled();
    });

    it("should not throw for a pure-Latin document when no CJK font exists", async () => {
      await expect(
        assertPdfFontAvailable(englishContent, "en", async () => false)
      ).resolves.toBeUndefined();
    });

    it("should throw for a zh-CN document when no CJK font exists", async () => {
      await expect(
        assertPdfFontAvailable(englishContent, "zh-CN", async () => false)
      ).rejects.toThrow(/No CJK font/);
    });

    it("should throw for an English document that carries Chinese", async () => {
      await expect(
        assertPdfFontAvailable({ summary: "八年前端经验" }, "en", async () => false)
      ).rejects.toThrow(/No CJK font/);
    });

    it("should not throw when the detector cannot tell", async () => {
      await expect(
        assertPdfFontAvailable(englishContent, "zh-CN", async () => null)
      ).resolves.toBeUndefined();
    });

    it("should not throw when a CJK font is installed", async () => {
      await expect(
        assertPdfFontAvailable(englishContent, "zh-CN", async () => true)
      ).resolves.toBeUndefined();
    });
  });

  describe("clearResumeTemplateCache", () => {
    it("should clear the cached template without breaking rendering", async () => {
      clearResumeTemplateCache();
      const html = await renderResumeExportHtml(sampleContent, "zh-CN");
      expect(html).toContain("王小明");
    });
  });
});
