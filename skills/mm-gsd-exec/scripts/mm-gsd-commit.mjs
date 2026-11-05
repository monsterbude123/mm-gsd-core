#!/usr/bin/env node
// mm-gsd-commit.mjs —— 受限放行提交(phase 14 D-02,#18)
//
//   node mm-gsd-commit.mjs --ticket <NN-MM> --message <text|@file>
//   node mm-gsd-commit.mjs --help
//
// 流程:① 按票面 files_modified 精确暂存(同 stage 语义,:(literal) pathspec,
// 绝不 git add .);② git commit 不带 --no-verify(正常提交优先);③ 失败时提取
// 失败项与该票 PLAN frontmatter 的 red_windows 清单做**精确串**比对 —— 全落清单 →
// --no-verify 快路径重试并注明受控放行;任何清单外失败 → exit 2 停下(真缺陷,不提交)。
// 提取总数为 0 → UNPARSEABLE_FAILURE exit 2 停下:空集 ⊆ 清单恒真,绝不当「全部命中」
// 放行(预审 F1);清单是放行白名单,不是提取器配置,认不出的输出格式一律停下不猜。
// 提取形状(必须匹配 core 实际输出):dangerous-git 守卫 `guard '<名>'`、core pre-commit
// 的 fail() 行 `mm-gsd pre-commit: <原因>`、常见 runner 的 `FAIL <路径>` 行。
// red_windows 的 wave 字段只做展示。零依赖,只认 node: 内置;解析一律 /\r?\n/。

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined; };

if (has("--help") || has("-h")) {
  console.log(`mm-gsd-commit —— 受限放行提交(红窗全落清单才 --no-verify)

用法:
  node mm-gsd-commit.mjs --ticket <NN-MM> --message <text|@file>

  --ticket <NN-MM>     票号,如 14-02(必需)
  --message <text|@file>  提交信息;@<路径> 表示从文件读全文(必需)
  --help               本说明

流程:
  1. 按票面 PLAN 的 files_modified 精确暂存(:(literal) pathspec,同 stage 语义)
  2. git commit 不带 --no-verify —— 正常提交优先,门禁全过就此结束
  3. 失败时提取失败项:guard '<名>' / mm-gsd pre-commit: <原因> / FAIL <路径>
     · 提取总数为 0 → UNPARSEABLE_FAILURE,exit 2 停下(空集 ⊆ 清单恒真,绝不当全部命中)
     · 与该票 PLAN 的 red_windows 清单首列精确串比对:
       全落清单 → 打印 FAST_PATH 标记,--no-verify 重试(受控放行,兑现票见 red_windows)
       任何清单外失败 → 列出清单外项,exit 2 停下(真缺陷,不提交)

red_windows 格式(PLAN frontmatter):- <守卫或测试路径> | wave <N> | ticket <NN-MM> | close <判据>`);
  process.exit(0);
}

const ticket = val("--ticket");
let message = val("--message");
if (!ticket || !/^\d+-\d+$/.test(ticket) || message === undefined) {
  console.error("✗ 用法:node mm-gsd-commit.mjs --ticket <NN-MM> --message <text|@file>(--help 看详情)");
  process.exit(1);
}
if (message.startsWith("@")) {
  const mf = message.slice(1);
  if (!existsSync(mf)) {
    console.error(`✗ --message 指向的文件不存在:${mf}`);
    process.exit(1);
  }
  message = readFileSync(mf, "utf8");
}
const planPath = join(".planning", `${ticket}-PLAN.md`);
if (!existsSync(planPath)) {
  console.error(`✗ 找不到 PLAN:${planPath} —— commit 按 --ticket 读该票 red_windows,先 cd 到项目根`);
  process.exit(1);
}
const planText = readFileSync(planPath, "utf8");

// ---- frontmatter 解析(与 stage/summary 同一套;块式列表 + 单值,兼容 CRLF) ----
function frontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") { end = i; break; }
  if (end < 0) return null;
  return lines.slice(1, end);
}

function parseFilesModified(lines) {
  const out = [];
  let inList = false;
  for (const l of lines) {
    if (!inList) { if (/^files_modified:\s*$/.test(l)) inList = true; continue; }
    const m = l.match(/^\s+-\s+(.+?)\s*$/);
    if (m) out.push(m[1]);
    else break;
  }
  return out;
}

// red_windows 条目:- <守卫或测试路径> | wave <N> | ticket <NN-MM> | close <判据>
// wave/ticket/close 只做展示,放行比对只认首列精确串。
function parseRedWindows(lines) {
  const out = [];
  let inList = false;
  for (const l of lines) {
    if (!inList) { if (/^red_windows:\s*$/.test(l)) inList = true; continue; }
    const m = l.match(/^\s+-\s+(.+?)\s*$/);
    if (m) { const cells = m[1].split("|").map((c) => c.trim()); out.push({ first: cells[0], full: m[1] }); }
    else break;
  }
  return out;
}

const fm = frontmatter(planText);
if (!fm) {
  console.error(`✗ ${planPath} 没有 frontmatter 块 —— 没法读 files_modified / red_windows`);
  process.exit(1);
}

// ---- ① 精确暂存(同 stage 语义) ----
const git = (args, extra = {}) => spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...extra });

const paths = parseFilesModified(fm);
if (!paths.length) {
  console.error(`✗ ${planPath} 的 frontmatter 没有 files_modified 列表 —— 没法精确暂存`);
  process.exit(1);
}
let staged = 0;
const skipped = [];
for (const p of paths) {
  if (!existsSync(p)) {
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

// ---- ② 正常提交优先(不带 --no-verify) ----
const commit = (extraFlags) => git(["commit", ...extraFlags, "-F", "-"], { input: message, stdio: ["pipe", "pipe", "pipe"] });
let r = commit([]);
if (r.error) {
  console.error(`✗ git 跑不起来:${r.error.message}`);
  process.exit(1);
}
if (r.status === 0) {
  console.log("✓ 提交完成(正常通道,门禁全过)");
  process.exit(0);
}

// ---- ③ 失败项提取(三形状;解析一律 /\r?\n/) ----
const output = String(r.stdout || "") + String(r.stderr || "");
const items = [];
for (const m of output.matchAll(/guard '([^']+)'/g)) items.push(m[1]);
for (const m of output.matchAll(/mm-gsd pre-commit:\s*(.+)/g)) items.push(m[1].trim());
for (const m of output.matchAll(/^FAIL\s+(\S+)/gm)) items.push(m[1]);
const uniq = [...new Set(items)];

if (!uniq.length) {
  console.error("✗ UNPARSEABLE_FAILURE —— commit 失败,但提取不到任何已知形状的失败项(guard '…' / mm-gsd pre-commit: … / FAIL …)");
  console.error("  提取总数为 0 → 空集 ⊆ 清单恒真,绝不当「全部命中」放行;清单是放行白名单,不是提取器配置,认不出的格式停下不猜。");
  console.error("  --- git 原始输出(前 15 行)---");
  for (const l of output.split(/\r?\n/).filter((x) => x.trim()).slice(0, 15)) console.error("  | " + l);
  process.exit(2);
}

// ---- ④ 清单比对(精确串匹配,不做模糊包含) ----
const redWindows = parseRedWindows(fm);
const outOfList = uniq.filter((i) => !redWindows.some((w) => w.first === i));
if (outOfList.length) {
  console.error(`✗ 清单外失败(真缺陷,不提交):${outOfList.join(", ")}`);
  console.error(`  该票 red_windows 清单 ${redWindows.length} 条:${redWindows.map((w) => w.first).join(", ") || "(空)"}`);
  console.error("  清单外失败必须先修缺陷,或由计划期把红窗登记进 red_windows(带兑现票),不走 --no-verify。");
  process.exit(2);
}

const matched = redWindows.filter((w) => uniq.includes(w.first));
console.log("FAST_PATH:失败项全部落在已登记红窗清单");
for (const w of matched) console.log("  - " + w.full + "(wave 字段仅展示)");
console.log("  这是受控门禁绕过:--no-verify 重试,兑现票见 red_windows(close 判据收尾对账)。");

const r2 = commit(["--no-verify"]);
if (r2.status !== 0) {
  console.error(`✗ --no-verify 重试仍失败:${(r2.stderr || r2.stdout || "").trim()}`);
  process.exit(1);
}
console.log("✓ 提交完成(FAST_PATH --no-verify 重试)");
process.exit(0);
