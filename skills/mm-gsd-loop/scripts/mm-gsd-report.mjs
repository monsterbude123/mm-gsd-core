#!/usr/bin/env node
// mm-gsd-report —— 使用方(在别的项目里用 mm-gsd 的 agent)把问题报回上游
//
//   node mm-gsd-report.mjs "<标题>" --evidence "<复现命令或报错>" [--evidence "<第二条>"]
//   node mm-gsd-report.mjs "<标题>" --evidence-file <路径> [--dry-run]
//
// 为什么放在 skills/ 而不是 tools/:使用方手上只有 ~/.agents/skills/,没有仓库。
// 报修入口放 tools/ 就等于不存在 —— 规则 R-13 就是守这一条。
//
// 三条自我要求(见 docs/theory.md):
//   T-03 没有 gh 就必须说没有,不能打印一段"看起来提交了"的东西
//   T-08 没装 gh 也要能看正文,而不是崩在 import
//   T-09 提交成功后打印 URL —— 不给可核对的地址等于让人相信没验证过的事

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { platform, release, homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valAfter = (f) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : ""; };
const allAfter = (f) => argv.reduce((a, v, i) => (v === f && argv[i + 1] ? [...a, argv[i + 1]] : a), []);

const DEFAULT_REPO = "monsterbude123/mm-gsd-core";
const LABEL = "mm-gsd-agent";
const GH_BIN = platform() === "win32" ? "gh.exe" : "gh";

const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[90m", b: "\x1b[1m", x: "\x1b[0m" };
const log = (s = "") => console.log(s);
const ok = (s) => log(`${C.g}✓${C.x} ${s}`);
const bad = (s) => log(`${C.r}✗${C.x} ${s}`);
const warn = (s) => log(`${C.y}!${C.x} ${s}`);

/** 装着的 mm-gsd 是哪一版 —— issue 不带版本号,复现就无从谈起。
 *  逐级往上找 package.json,而不是按固定层数拼路径:脚本挪一层、
 *  安装方式一变(npm --prefix / npx / 仓库内)按层数算就会读错地方,
 *  然后默默报成"未知"。 */
function selfVersion() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try { return JSON.parse(readFileSync(pkg, "utf8")).version ?? "未知"; } catch { return "未知(package.json 解析失败)"; }
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  // 找不到包清单时退到安装器写的清单(它在 ~/.agents/skills/ 下)
  try {
    const mf = join(homedir(), ".agents", "skills", ".mm-gsd-install.json");
    if (existsSync(mf)) return JSON.parse(readFileSync(mf, "utf8")).version ?? "未知";
  } catch {}
  return "未知(没找到包清单)";
}

function collect() {
  const ev = [...allAfter("--evidence")];
  const f = valAfter("--evidence-file");
  if (f) {
    if (!existsSync(f)) { bad(`--evidence-file 指向的文件不存在:${f}`); return null; }
    ev.push(readFileSync(f, "utf8"));
  }
  return ev.map((e) => e.trim()).filter(Boolean);
}

function body(title, evidence) {
  return [
    title, "",
    "> 由使用方 agent 通过 `npx mm-gsd-core report` 上报。", "",
    "## 环境", "",
    `- mm-gsd-core: ${selfVersion()}`,
    `- node: ${process.version}`,
    `- 宿主系统: ${platform()} ${release()}`,
    `- 工作目录: \`${resolve(".")}\``, "",
    "## 证据", "",
    ...evidence.flatMap((e, i) => [
      `### ${evidence.length > 1 ? `证据 ${i + 1}` : "复现 / 报错"}`, "",
      "```", e, "```", "",
    ]),
    "## 期望", "", "_（原本应该是什么样）_", "",
    "## 实际", "", "_（实际发生了什么）_", "",
  ].join("\n");
}

function ghOk() {
  try { execFileSync(GH_BIN, ["auth", "status"], { stdio: "pipe" }); return true; }
  catch { return false; }
}

// ---- 主流程 ----
const title = argv.find((a, i) => !a.startsWith("--") && !allAfter("--evidence").includes(a)
  && a !== valAfter("--evidence") && a !== valAfter("--evidence-file") && a !== valAfter("--repo"));
const repo = valAfter("--repo") || DEFAULT_REPO;
const evidence = collect();

if (!title) {
  bad('用法:npx mm-gsd-core report "<标题>" --evidence "<复现命令或报错>"');
  log("      多个 --evidence 会合成一条 issue —— 一次报清楚,别刷屏。");
  process.exit(1);
}
if (!evidence.length) {
  bad("没有证据。");
  log('      报修必须能复现:`--evidence "<跑的命令 + 它报了什么>"`,或 --evidence-file <路径>。');
  log("      描述「觉得不太对」不是 issue,是抱怨。");
  process.exit(1);
}

const text = body(title, evidence);

if (has("--dry-run")) { log(text); process.exit(0); }

if (!ghOk()) {
  bad(`没提交 —— ${GH_BIN} 没装,或没登录。`);
  log("    这是真的没发出去,不是已经报过了。");
  log("    要真提交:装 gh(https://cli.github.com)并 `gh auth login`;");
  log(`    或把下面内容贴到 ${C.b}${repo}/issues/new${C.x}:`);
  log("");
  log(text);
  log("");
  warn("gh 不可用时退到人工粘贴,但流程不算完成 —— 维护方看不到。");
  process.exit(1);
}

try {
  const url = execFileSync(GH_BIN, ["issue", "create", "--repo", repo,
    "--title", `[${title}]`, "--body", text, "--label", LABEL],
    { encoding: "utf8", stdio: "pipe" }).trim().split("\n").pop();
  ok(`已提交:${url}`);
  log(`  ${C.d}维护方拉取:node tools/mmc.mjs inbox${C.x}`);
  process.exit(0);
} catch (e) {
  bad("提交失败:" + String(e.stderr || e.message).split("\n")[0]);
  log(`    label ${LABEL} 不存在的话会这样。先建:gh label create ${LABEL} --color 1d76db`);
  log("    正文如下,复制粘贴到 " + repo + "/issues/new 也不算没报:");
  log("");
  log(text);
  process.exit(1);
}
