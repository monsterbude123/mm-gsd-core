#!/usr/bin/env node
// mm-gsd-summary.mjs —— 生成票 SUMMARY 草稿,commits 按提交主题 scope 实测(phase 14 D-04/D-05,#19)
//
//   node mm-gsd-summary.mjs --ticket <NN-MM>
//   node mm-gsd-summary.mjs --help
//
// commits 实测:git log 全量取回提交主题,精确匹配含 `(NN-MM):` scope 的条目计数
// (不用 --grep 子串 —— 会误命中主题里提到「NN-MM」的别票);零命中按 `NN-MM`
// 前缀兜底并 WARN 提示补 scope;再零 → commits: 0 并 WARN。
// 生成 .planning/<NN-MM>-SUMMARY.md(照 templates/summary.md 字段);已存在则拒绝覆盖。
// 零依赖,只认 node: 内置;行解析一律 /\r?\n/(Git for Windows 的 CRLF)。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined; };

if (has("--help") || has("-h")) {
  console.log(`mm-gsd-summary —— 生成票 SUMMARY 草稿,commits 按提交主题 scope 实测

用法:
  node mm-gsd-summary.mjs --ticket <NN-MM> [--notes <file.json>]

  --ticket <NN-MM>   票号,如 14-02(必需)
  --notes <file.json>  人工备注(JSON),校验过才填进 SUMMARY 对应节;文件必须存在
  --help             本说明

notes schema(固定,未知字段与类型错一律拒绝并列出全部违规、退出 1):
  { one_liner?: string,        → ## One-liner
    accomplishments?: string[], → ## Accomplishments
    deviations?: string[],      → ## Deviations from Plan
    threats?: string[],         → ## Threat Flags
    stubs?: string[],           → ## Known Stubs
    deferred?: string[] }       → ## Deferred Issues
  六字段与 templates/summary.md 的节字面一一对应;草稿缺节按模板字面补建。

行为:
  1. git log --format=%s 全量取回提交主题,数出含 \`(<NN-MM>):\` scope 的条目
  2. 零命中 → 按 <NN-MM> 前缀兜底重匹配,并 WARN 提示补 scope
  3. 仍零 → commits: 0 并 WARN(有代码变更但 commits=0 属非法)
  4. 生成 .planning/<NN-MM>-SUMMARY.md 草稿(One-liner/Accomplishments 留占位待填,
     --notes 校验通过的字段填进对应节);已存在则拒绝覆盖(退出 1,手工改)

SUMMARY 落盘不 commit —— 流程记忆属本地工件(exec SKILL「SUMMARY 原子块」)。`);
  process.exit(0);
}

const ticket = val("--ticket");
if (!ticket || !/^\d+-\d+$/.test(ticket)) {
  console.error("✗ 用法:node mm-gsd-summary.mjs --ticket <NN-MM>(--help 看详情)");
  process.exit(1);
}

// ---- --notes:固定 schema 的可选人工备注(phase 15 D-03)----
// 校验在生成之前:JSON.parse 失败 / 未知字段 / 类型错 / 数组元素非字符串 → 全部违规一次列出,exit 1。
const NOTES_SCHEMA = {
  one_liner: "string",
  accomplishments: "string[]",
  deviations: "string[]",
  threats: "string[]",
  stubs: "string[]",
  deferred: "string[]",
};
// 六字段与 templates/summary.md 的节字面一一对应,不自创新节
const NOTES_SECTION = [
  ["deviations", "## Deviations from Plan"],
  ["stubs", "## Known Stubs"],
  ["deferred", "## Deferred Issues"],
  ["threats", "## Threat Flags"],     // 模板里的节序:Deviations → Stubs → Deferred → Threats
];
let notes = null;
if (has("--notes")) {
  const notesPath = val("--notes");
  if (!notesPath) { console.error("✗ --notes 需要一个 JSON 文件路径(--help 看 schema)"); process.exit(1); }
  let raw;
  try { raw = readFileSync(notesPath, "utf8"); }
  catch { console.error(`✗ --notes 文件读不到:${notesPath}`); process.exit(1); }
  let obj;
  try { obj = JSON.parse(raw); }
  catch (e) { console.error(`✗ notes 不是合法 JSON:${e.message}`); process.exit(1); }
  const bad = [];
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    bad.push("notes 顶层必须是对象(六字段 schema 见 --help)");
  } else {
    for (const [k, v] of Object.entries(obj)) {
      const kind = NOTES_SCHEMA[k];
      if (!kind) { bad.push(`未知字段 "${k}"(合法:${Object.keys(NOTES_SCHEMA).join(", ")})`); continue; }
      if (kind === "string") {
        if (typeof v !== "string") bad.push(`字段 "${k}" 类型错:须为 string,实为 ${Array.isArray(v) ? "array" : typeof v}`);
      } else if (!Array.isArray(v)) {
        bad.push(`字段 "${k}" 类型错:须为 string[],实为 ${Array.isArray(v) ? "array" : typeof v}`);
      } else {
        v.forEach((el, i) => { if (typeof el !== "string") bad.push(`字段 "${k}"[${i}] 非字符串(${typeof el})`); });
      }
    }
  }
  if (bad.length) {
    console.error(`✗ notes 校验失败(${bad.length} 处违规):`);
    for (const b of bad) console.error(`  - ${b}`);
    process.exit(1);
  }
  notes = obj;
}
const summaryPath = join(".planning", `${ticket}-SUMMARY.md`);
if (existsSync(summaryPath)) {
  console.error(`✗ ${summaryPath} 已存在 —— 拒绝覆盖,手工改那份(已填的内容不该被草稿冲掉)`);
  process.exit(1);
}
if (!existsSync(".planning")) {
  console.error("✗ 这里没有 .planning/ —— 不是 mm-gsd 项目根,先 cd 到项目根再跑");
  process.exit(1);
}

const git = spawnSync("git", ["log", "--format=%s"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
if (git.status !== 0) {
  console.error(`✗ git log 失败:${(git.stderr || "").trim()}`);
  process.exit(1);
}
const subjects = git.stdout.split(/\r?\n/).filter((s) => s.trim());

let commits = subjects.filter((s) => s.includes(`(${ticket}):`)).length;
let warn = "";
if (!commits) {
  commits = subjects.filter((s) => s.startsWith(ticket)).length;
  warn = commits
    ? `WARN:没有 \`(${ticket}):\` scope 的提交,按前缀兜底数到 ${commits} 笔 —— 提交主题缺 scope,commits 实测会变人工回填(issue #19 实测 2 票),请补 scope`
    : `WARN:找不到 \`(${ticket}):\` scope 的提交,按前缀兜底也零命中 —— commits 记 0;有代码变更但 commits=0 属非法,先核对提交主题`;
}

const [phase, plan] = ticket.split("-");
const items = (key, ph) => (notes && notes[key]?.length ? notes[key].map((s) => "- " + s) : notes && key in notes ? [] : [ph]);
const body = [
  "## One-liner",
  notes?.one_liner ?? "<一行摘要:做了什么、用什么 —— 要具体,禁空话>",
  "",
  "## Accomplishments",
  ...items("accomplishments", "- <交付了什么,用户视角>"),
];
for (const [key, header] of NOTES_SECTION) {
  if (!notes || !(key in notes)) continue;   // 生成的草稿缺节按模板字面补建(只补 notes 给了的节)
  body.push("", header, ...notes[key].map((s) => "- " + s));
}
writeFileSync(summaryPath, `---
phase: "${phase}"
plan: "${plan}"
status: complete
commits: ${commits}
requirements-completed: []
---

${body.join("\n")}
`);
console.log(`✓ ${summaryPath} 已生成(commits 实测 ${commits},提交主题全量 ${subjects.length} 条)`);
if (warn) console.log(warn);
console.log("  One-liner / Accomplishments 是占位,填写后才算完整;frontmatter 其余字段(batch/batch-check-rounds 等)照 templates/summary.md 补齐。");
process.exit(0);
