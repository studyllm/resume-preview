// E2E —— 官网 docs/index.html 的真实浏览器行为
//
//   node .claude/dev/e2e-web.mjs
//
// 覆盖：中英双语的渲染与切换、命令块标题条、语言泄漏、标签页、FAQ 折叠、
//       所有站内锚点、控制台报错、图片/脚本加载
//
// 语言泄漏检查是重点：英文页面的可见文本里出现中文，说明某个双语 span 漏了
// 翻译或写死了中文内容 —— 这类问题肉眼很容易放过。
import puppeteer from "puppeteer";
import { resolve } from "path";

const url = "file://" + resolve("docs/index.html").split("\\").join("/");
const browser = await puppeteer.launch({ headless: "new" });

const CJK = /[⺀-⻿　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

for (const [locale, expectLang, expectHero] of [
  ["zh-CN", "zh-CN", "让 AI 写简历"],
  ["en-US", "en", "Ask an AI for a resume"],
]) {
  console.log(`\n━━━ ${locale} ━━━`);
  const page = await browser.newPage();
  const errors = [];
  const failed = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
  page.on("requestfailed", (r) => failed.push(`${r.url()} — ${r.failure()?.errorText}`));

  await page.emulateLocale(locale);
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(url, { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 500));

  const state = await page.evaluate(() => {
    const vis = (e) => e.getClientRects().length > 0;
    const langSpans = [...document.querySelectorAll('span[lang="zh-CN"]')];
    const enSpans = [...document.querySelectorAll('span[lang="en"]')];
    return {
      lang: document.documentElement.lang,
      title: document.title,
      h1: document.querySelector("h1")?.innerText.replace(/\s+/g, " "),
      visibleZh: langSpans.filter(vis).length,
      visibleEn: enSpans.filter(vis).length,
      faqCount: document.querySelectorAll("#faq details").length,
      anchors: [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href")),
      ids: [...document.querySelectorAll("[id]")].map((e) => e.id),
      imgCount: document.images.length,
      brokenImgs: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).length,
    };
  });

  check("html lang 正确", state.lang === expectLang, state.lang);
  check("标题是目标语言", state.h1?.includes(expectHero), state.h1);
  check(
    "可见语言与页面语言一致",
    expectLang === "en"
      ? state.visibleEn > 0 && state.visibleZh === 0
      : state.visibleZh > 0 && state.visibleEn === 0,
    `可见 zh=${state.visibleZh} en=${state.visibleEn}`
  );
  check("FAQ 条目数正确", state.faqCount === 9, String(state.faqCount));

  // 站内锚点
  const deadAnchors = state.anchors.filter((a) => a !== "#" && !state.ids.includes(a.slice(1)));
  check(
    "所有站内锚点都指向存在的元素",
    deadAnchors.length === 0,
    deadAnchors.join(", ") || "无失效锚点"
  );

  const external = await page.evaluate(() =>
    [...document.querySelectorAll("a[href^='http']")].map((a) => a.href)
  );
  check("外部链接数量合理", external.length >= 3, `${external.length} 个`);

  check("无 JS 报错", errors.length === 0, errors.join(" | "));
  check("无失败的网络请求", failed.length === 0, failed.join(" | "));
  check("无加载失败的图片", state.brokenImgs === 0, `${state.imgCount} 张图片`);

  // 命令块标题条：必须逐个标签页切过去看
  // （隐藏面板里 innerText 会退化成 textContent，读到的会是两种语言拼在一起）
  const cmdTitles = await page.evaluate(() => {
    const radios = [...document.querySelectorAll('.tabs input[type="radio"]')];
    const out = [];
    for (const r of radios) {
      r.checked = true;
      const panel = document.querySelector(`[aria-labelledby="${r.id}"]`);
      const t = panel?.querySelector(".cmd-bar-title");
      out.push(t ? t.innerText.replace(/\s+/g, " ").trim() : null);
    }
    return out;
  });
  check(
    "三个命令块标题条都是目标语言",
    cmdTitles.length === 3 &&
      cmdTitles.every((t) => t && (expectLang === "en" ? !CJK.test(t) : CJK.test(t))),
    JSON.stringify(cmdTitles)
  );

  // 语言泄漏：英文页面的可见文本里不该残留中文
  if (expectLang === "en") {
    const leaks = await page.evaluate((cjkSrc) => {
      const cjk = new RegExp(cjkSrc);
      const vis = (e) => e.getClientRects().length > 0;
      const out = [];
      for (const el of document.querySelectorAll(
        "h1,h2,h3,p,li,summary,td,th,label,span.cmd-bar-title"
      )) {
        if (!vis(el)) continue;
        const t = (el.innerText || "").replace(/\s+/g, " ").trim();
        if (t && cjk.test(t)) out.push(`${el.tagName}: ${t.slice(0, 60)}`);
      }
      return out;
    }, CJK.source);
    check("英文页面可见文本无中文残留", leaks.length === 0, leaks.join(" | "));
  }

  // 标签页
  const tabs = await page.evaluate(() => {
    const radios = [...document.querySelectorAll('.tabs input[type="radio"]')];
    const ids = radios.map((r) => r.id);
    const results = {};
    for (const id of ids) {
      document.getElementById(id).checked = true;
      const panel = document.querySelector(`[aria-labelledby="${id}"]`);
      results[id] = panel ? getComputedStyle(panel).display !== "none" : null;
    }
    return results;
  });
  check(
    "三个安装标签页都能正常切换",
    Object.values(tabs).filter((v) => v === true).length === 3,
    JSON.stringify(tabs)
  );

  // FAQ 折叠
  const faqOpen = await page.evaluate(() => {
    const d = document.querySelectorAll("#faq details")[0];
    d.open = true;
    const body = d.querySelector("p");
    return { open: d.open, hasBody: !!body && body.innerText.trim().length > 20 };
  });
  check("FAQ 条目可展开且有内容", faqOpen.open && faqOpen.hasBody);

  // 语言切换入口
  const switchLinks = await page.evaluate(() =>
    [...document.querySelectorAll(".lang-switch")].map((a) => ({
      text: a.textContent.trim(),
      href: a.getAttribute("href"),
      visible: a.getClientRects().length > 0,
    }))
  );
  const visibleLinks = switchLinks.filter((l) => l.visible);
  check("只显示一个语言切换入口", visibleLinks.length === 1, JSON.stringify(visibleLinks));
  check(
    "切换入口指向另一种语言",
    visibleLinks[0]?.href === (expectLang === "en" ? "?lang=zh-CN" : "?lang=en"),
    visibleLinks[0]?.href
  );

  // 复制按钮
  const copyOk = await page.evaluate(async () => {
    const btn = document.querySelector(".cmd .copy");
    if (!btn) return { found: false };
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    const active = btn.querySelector(`[data-copy-state][lang="${document.documentElement.lang}"]`);
    return { found: true, label: active?.textContent };
  });
  check(
    "复制按钮点击后变成 Copied（当前语言）",
    copyOk.found && /copied|已复制/i.test(copyOk.label || ""),
    copyOk.label
  );

  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n━━━ 结果：${results.length - failed.length}/${results.length} 通过 ━━━`);
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
}
process.exit(failed.length ? 1 : 0);
