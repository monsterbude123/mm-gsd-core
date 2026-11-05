#!/usr/bin/env node
// mm-gsd-stage.mjs —— 按票面 files_modified 精确暂存(phase 14 D-04,#19)
//
//   node mm-gsd-stage.mjs --ticket <NN-MM> [--plan <PLAN 路径>]
//   node mm-gsd-stage.mjs --help
//
// PLAN 缺省找 .planning/<NN-MM>-PLAN.md。对 files_modified 每条路径
// `git add -- ":(literal)<path>"` —— :(literal) 是 [locale] 这类形状被当 glob
// 吞掉的官方解法;绝不 git add .(exec SKILL 明令禁止)。
// 路径不在磁盘且不在 git 索引 → 跳过不报错(新文件还没落盘属正常)。
// 零依赖,只认 node: 内置;行解析一律 /\r?\n/(Git for Windows 的 CRLF)。

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined; };

if (has("--help") || has("-h")) {
  console.log(`mm-gsd-stage —— 按票面 files_modified 精确暂存

用法:
  node mm-gsd-stage.mjs --ticket <NN-MM> [--plan <PLAN 路径>]

  --ticket <NN-MM>   票号,如 14-02(必需)
  --plan <路径>      PLAN 文件;缺省找 .planning/<NN-MM>-PLAN.md
  --help             本说明

行为:
  1. 解析 PLAN frontmatter 的 files_modified(列表逐条,兼容 CRLF)
  2. 每条路径 git add -- ":(literal)<路径>" —— 精确暂存,[locale] 不被当 glob
  3. 不在磁盘且不在 git 索引的路径 → 跳过(新文件暂不存在属正常),不报错
  4. 结束打印暂存计数与 git status --porcelain 摘要

绝不 git add . / -A;退出码 0 = 暂存动作完成(跳过不算失败)。`);
  process.exit(0);
}

const ticket = val("--ticket");
if (!ticket || !/^\d+-\d+$/.test(ticket)) {
  console.error("✗ 用法:node mm-gsd-stage.mjs --ticket <NN-MM> [--plan <PLAN 路径>](--help 看详情)");
  process.exit(1);
}
const planPath = val("--plan") || join(".planning", `${ticket}-PLAN.md`);
if (!existsSync(planPath)) {
  console.error(`✗ 找不到 PLAN:${planPath} —— 用 --plan 显式指定`);
  process.exit(1);
}

// frontmatter 的 files_modified 块列表(只认块式 `- <path>`,与 plan 模板一致)
function parseFilesModified(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return [];
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") { end = i; break; }
  if (end < 0) return [];
  const out = [];
  let inList = false;
  for (const l of lines.slice(1, end)) {
    if (!inList) { if (/^files_modified:\s*$/.test(l)) inList = true; continue; }
    const m = l.match(/^\s+-\s+(.+?)\s*$/);
    if (m) out.push(m[1]);
    else break;
  }
  return out;
}

const paths = parseFilesModified(readFileSync(planPath, "utf8"));
if (!paths.length) {
  console.error(`✗ ${planPath} 的 frontmatter 没有 files_modified 列表 —— 没法精确暂存`);
  process.exit(1);
}

const git = (args) => spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let staged = 0;
const skipped = [];
for (const p of paths) {
  if (!existsSync(p)) {
    // 不在磁盘:只有已在索引里的路径暂存得动(如已暂存的删除);两者皆否 → 还没落盘的新文件,跳过
    const ls = git(["ls-files", "--", `:(literal)${p}`]);
    if (ls.status !== 0 || !ls.stdout.trim()) { skipped.push(p); continue; }
  }
  const r = git(["add", "--", `:(literal)${p}`]);
  if (r.status !== 0) {
    console.error(`✗ git add 失败(${p}):${(r.stderr || r.stdout || "").trim()}`);
    process.exit(1);
  }
  staged++;
}

console.log(`✓ 暂存 ${staged}/${paths.length} 条` + (skipped.length ? `;跳过 ${skipped.length} 条(不在磁盘也不在索引):${skipped.join(", ")}` : ""));
const st = git(["status", "--porcelain"]);
if (st.status === 0 && st.stdout.trim()) {
  console.log("git status --porcelain:");
  for (const l of st.stdout.split(/\r?\n/)) if (l.trim()) console.log("  " + l);
}
process.exit(0);
