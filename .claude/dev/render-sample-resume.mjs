// Dev helper: render a sample resume and serve its live preview.
// Used by .claude/launch.json to eyeball the resume page in a browser.
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const home = await mkdtemp(join(tmpdir(), "resume-dev-"));
process.env.XDG_CONFIG_HOME = join(home, ".config");
process.env.CLAUDE_MERMAID_LOG_LEVEL = "INFO";

const { handleResumePreview } = await import("../../build/handlers.js");
const { ensureLiveServer } = await import("../../build/live-server.js");

const content = {
  basics: {
    name: "王小明",
    title: "高级前端工程师",
    email: "wang.xiaoming@example.com",
    phone: "138-0000-0000",
    location: "上海",
    links: [{ label: "GitHub", url: "github.com/example" }],
  },
  summary:
    "8 年前端经验，主导过 3 个亿级 DAU 项目。擅长前端架构与性能优化，熟悉 React / TypeScript / Node。",
  experience: [
    {
      company: "某某科技",
      title: "高级前端工程师",
      start: "2021-03",
      end: "至今",
      location: "上海",
      highlights: [
        "主导核心业务线重构，首屏加载从 4.2s 降到 1.1s",
        "搭建前端监控与灰度发布体系，线上故障平均恢复时间缩短 60%",
        "带 5 人小组，沉淀 40+ 篇内部技术文档",
      ],
    },
    {
      company: "某网络公司",
      title: "前端工程师",
      start: "2018-07",
      end: "2021-02",
      location: "杭州",
      highlights: ["负责后台管理系统从 0 到 1 的建设", "将构建时间从 6 分钟压缩到 90 秒"],
    },
  ],
  projects: [
    {
      name: "统一组件库",
      role: "负责人",
      period: "2022",
      highlights: ["服务 20+ 业务线，复用率超过 70%", "按需加载使包体积下降 45%"],
    },
  ],
  education: [{ school: "某某大学", degree: "计算机科学与技术 · 本科", period: "2014-2018" }],
  skills: [
    { category: "前端", items: ["TypeScript", "React", "Vue", "Webpack", "Vite"] },
    { category: "工程化", items: ["Node.js", "CI/CD", "Jest", "Playwright"] },
    { category: "其他", items: ["性能优化", "可访问性", "Node.js 服务端渲染"] },
  ],
  extras: [{ label: "证书", items: ["软考高级系统架构设计师", "PMP"] }],
};

const result = await handleResumePreview({ resume_id: "sample", content });
console.log(result.content[0].text);

const port = await ensureLiveServer();
console.log(`RESUME_PREVIEW_URL=http://localhost:${port}/resume/sample`);
