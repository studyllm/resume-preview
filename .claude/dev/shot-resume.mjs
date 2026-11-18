import puppeteer from "puppeteer";

const url = process.argv[2] ?? "http://localhost:3737/resume/frontend-engineer";
const out = process.argv[3] ?? ".claude/dev/resume-preview.png";

const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1400, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: out, fullPage: true });
console.log("saved:", out);
console.log("page title:", await page.title());
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
