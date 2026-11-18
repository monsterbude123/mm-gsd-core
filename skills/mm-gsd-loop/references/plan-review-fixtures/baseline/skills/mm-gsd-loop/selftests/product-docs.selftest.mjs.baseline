// 产品文档自测 —— docs/product/ 七篇 + index 的机械契约。
//
// 为什么单独一份自测:产品文档服务三类人(测试拆测试点 / 用户理解产品 / 管理者盘点功能),
// 「不脏」(窄口径禁词)与「不空壳」(实质内容断言)靠自觉守不住,只能机器断言钉死;
// 「仓库内不进 npm」靠 files 白名单现状,同样断言钉死,防止将来有人"顺手"加进去。
//
// 跑法(仓库根):node skills/mm-gsd-loop/selftests/product-docs.selftest.mjs
// 退出码即判据:0 = 全过,1 = 有不过。

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const DOCS = resolve(ROOT, "docs", "product");

// 七篇 + index(导航)
const PAGES = ["index", "install-update", "five-step-ring", "board", "checking", "repair", "telemetry", "guards"];

// 窄口径禁词(与决策一致):REQ-N 追溯记号 / NN-NN 工件号与日期 /
// skills[/]mm-gsd 实现代码路径(~/.agents/skills 安装目的地不命中)/
// .planning[/\] 工件路径引用(裸目录名「.planning」作数据目录说明允许)。
const BANNED = /REQ-\d|\b\d{2}-\d{2}\b|skills[/\\]mm-gsd|\.planning[/\\]/;

const results = [];

function ok(name, cond, detail = "") {
  results.push({ name, pass: !!cond, detail });
  if (cond) console.log(`✓ ${name}`);
  else console.log(`✗ ${name}${detail ? ` —— ${detail}` : ""}`);
}

function main() {
  // 1. 七篇 + index 文件齐(非空判据:存在且 trim 后非空,防空文件)
  for (const p of PAGES) {
    const f = resolve(DOCS, p + ".md");
    const present = existsSync(f) && readFileSync(f, "utf8").trim().length > 0;
    ok(`文件齐且非空:${p}.md`, present);
  }

  const texts = Object.fromEntries(
    PAGES.map((p) => [p, existsSync(resolve(DOCS, p + ".md")) ? readFileSync(resolve(DOCS, p + ".md"), "utf8") : ""]),
  );

  // 2. index 导航链接 ≥7 条(非空集合,防空真)且逐条相对解析可达(以 index 所在目录为基)
  const links = [...texts.index.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/g)].map((m) => m[1]);
  ok("index 导航链接 ≥7 条", links.length >= 7, `got=${links.length}`);
  const broken = links.filter((href) => !existsSync(resolve(DOCS, href)));
  ok("index 链接逐条相对解析可达", broken.length === 0, broken.length ? `断链: ${broken.join(", ")}` : "");

  // 3. 禁词扫描零命中(七篇 + index 全扫)
  for (const p of PAGES) {
    const hits = [...new Set(texts[p].match(new RegExp(BANNED.source, "g")) ?? [])];
    ok(`禁词零命中:${p}.md`, hits.length === 0, hits.length ? hits.join(", ") : "");
  }

  // 4. 每篇实质内容断言(能力关键词,防空壳)
  ok(
    "install-update 含『安装』且含『更新』",
    texts["install-update"].includes("安装") && texts["install-update"].includes("更新"),
  );
  const ring = texts["five-step-ring"];
  ok(
    "five-step-ring 含五步各步名",
    ["讨论", "计划", "执行", "验收", "交付"].every((w) => ring.includes(w)) &&
      ["discuss", "plan", "execute", "verify", "ship"].every((w) => ring.includes(w)),
  );
  ok("board 含『多项目』『批注』『双主题』", ["多项目", "批注", "双主题"].every((w) => texts.board.includes(w)));
  ok("checking 含『--plan-check』", texts.checking.includes("--plan-check"));
  ok("repair 含『点修』『报修』", ["点修", "报修"].every((w) => texts.repair.includes(w)));
  ok("telemetry 含『遥测』『关闭』", ["遥测", "关闭"].every((w) => texts.telemetry.includes(w)));
  ok("guards 含『拦截』", texts.guards.includes("拦截"));

  // 5. README 含 docs/product 入口行
  const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
  ok("README 含 docs/product 入口行", readme.includes("docs/product"));

  // 6. package.json files 白名单不含 docs(仓库内不进 npm,现状钉死)
  const files = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).files ?? [];
  ok("package.json files 不含 docs", files.every((f) => !String(f).includes("docs")), `got=${JSON.stringify(files)}`);

  const bad = results.filter((r) => !r.pass);
  if (bad.length === 0) {
    console.log("✓ 全过");
    process.exit(0);
  }
  console.log(`${bad.length} 项不过`);
  process.exit(1);
}

// ---- 入口(main-guard:被 import 时不执行) -----------------------------------

const invokedAs = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedAs && import.meta.url === invokedAs) main();
