// Re-render the documentation diagrams from their Mermaid sources.
//
// The project no longer ships @mermaid-js/mermaid-cli — the diagram preview
// capability was removed — so the diagrams are rendered with an on-demand
// `npx` install instead of the local node_modules.
//
// --size 1600 -s 1 matches the size the committed diagrams in docs/ were
// rendered at (their SVGs carry `max-width: 1600px`).
import { execFileSync } from "child_process";
import { copyFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const jobs = [
  {
    mmd: "docs/diagrams/architecture.mmd",
    svg: "assets/architecture.svg",
    png: "assets/architecture.png",
  },
  {
    // README 专用的横向版：正文宽度内可读，只画层与层之间的主干依赖
    mmd: "docs/diagrams/architecture.readme.mmd",
    svg: "assets/architecture.readme.svg",
  },
  {
    mmd: "docs/diagrams/module-deps.mmd",
    svg: "assets/module-deps.svg",
  },
  {
    mmd: "docs/diagrams/external-deps.mmd",
    svg: "assets/external-deps.svg",
    png: "assets/external-deps.png",
  },
  {
    mmd: "docs/diagrams/data-model-er.mmd",
    svg: "assets/data-model-er.svg",
  },
];

for (const job of jobs) {
  const out = mkdtempSync(join(tmpdir(), "rerender-"));
  const svg = join(out, "out.svg");
  const args = (output) => [
    "-y",
    "@mermaid-js/mermaid-cli",
    "-i",
    job.mmd,
    "-o",
    output,
    "-t",
    "default",
    "-b",
    "white",
    "--size",
    "1600",
    "-s",
    "1",
  ];

  execFileSync("npx", args(svg), { stdio: "inherit" });
  copyFileSync(svg, job.svg);

  if (job.png) {
    const png = join(out, "out.png");
    execFileSync("npx", args(png), { stdio: "inherit" });
    copyFileSync(png, job.png);
  }

  console.log(`${job.mmd} -> ${job.svg}${job.png ? `, ${job.png}` : ""}`);
}
