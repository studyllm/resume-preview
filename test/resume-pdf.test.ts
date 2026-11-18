/**
 * PDF export end-to-end, with the font detector injected.
 *
 * The real detector depends on the platform's font directory (or `fc-list`),
 * which cannot be made to say "no Chinese font" from a test. Injecting it
 * lets these tests exercise the gate that actually matters: a resume written
 * entirely in Latin script must export on a machine that has no CJK font.
 */

import { describe, it, expect, afterAll } from "vitest";
import { renderResumePdf, closeBrowser } from "../src/resume-renderer.js";
import type { ResumeContent } from "../src/types.js";

const englishContent: ResumeContent = {
  basics: {
    name: "Alex Morgan",
    title: "Senior Backend Engineer",
    email: "alex@example.com",
    location: "Shanghai",
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
  skills: [{ category: "Backend", items: ["Go", "Java", "Kafka"] }],
};

const noCjkFont = async () => false;

afterAll(async () => {
  await closeBrowser();
});

describe("PDF export font gate", () => {
  it("should export an English resume on a machine without a CJK font", async () => {
    const pdf = await renderResumePdf(englishContent, "en", { detectFont: noCjkFont });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("should refuse a zh-CN resume when no CJK font is installed", async () => {
    await expect(
      renderResumePdf(englishContent, "zh-CN", { detectFont: noCjkFont })
    ).rejects.toThrow(/No CJK font/);
  });

  it("should refuse an English resume that carries Chinese", async () => {
    await expect(
      renderResumePdf({ basics: { name: "王某某" } }, "en", { detectFont: noCjkFont })
    ).rejects.toThrow(/No CJK font/);
  });

  it("should export a zh-CN resume when a CJK font is installed", async () => {
    const pdf = await renderResumePdf(englishContent, "zh-CN", {
      detectFont: async () => true,
    });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
