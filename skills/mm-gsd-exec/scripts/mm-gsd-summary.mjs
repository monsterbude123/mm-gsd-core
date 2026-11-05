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
  node mm-gsd-summary.mjs --ticket <NN-MM>

  --ticket <NN-MM>   票号,如 14-02(必需)
  --help             本说明

行为:
  1. git log --format=%s 全量取回提交主题,数出含 \`(<NN-MM>):\` scope 的条目
  2. 零命中 → 按 <NN-MM> 前缀兜底重匹配,并 WARN 提示补 scope
  3. 仍零 → commits: 0 并 WARN(有代码变更但 commits=0 属非法)
  4. 生成 .planning/<NN-MM>-SUMMARY.md 草稿(One-liner/Accomplishments 留占位待填);
     已存在则拒绝覆盖(退出 1,手工改)

SUMMARY 落盘不 commit —— 流程记忆属本地工件(exec SKILL「SUMMARY 原子块」)。`);
  process.exit(0);
}

const ticket = val("--ticket");
if (!ticket || !/^\d+-\d+$/.test(ticket)) {
  console.error("✗ 用法:node mm-gsd-summary.mjs --ticket <NN-MM>(--help 看详情)");
  process.exit(1);
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
writeFileSync(summaryPath, `---
phase: "${phase}"
plan: "${plan}"
status: complete
commits: ${commits}
requirements-completed: []
---

## One-liner
<一行摘要:做了什么、用什么 —— 要具体,禁空话>

## Accomplishments
- <交付了什么,用户视角>
`);
console.log(`✓ ${summaryPath} 已生成(commits 实测 ${commits},提交主题全量 ${subjects.length} 条)`);
if (warn) console.log(warn);
console.log("  One-liner / Accomplishments 是占位,填写后才算完整;frontmatter 其余字段(batch/batch-check-rounds 等)照 templates/summary.md 补齐。");
process.exit(0);
