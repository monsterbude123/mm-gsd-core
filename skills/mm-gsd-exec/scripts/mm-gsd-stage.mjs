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
// phase 36(REQ-75/D-01):add 走票级隔离 GIT_INDEX_FILE 临时索引(基线 = 当时 HEAD),
// 共享 .git/index 零写入 —— 同 wave 并发子代理的暂存互不踩踏;临时索引 finally 清理。
// 零依赖,只认 node: 内置;行解析一律 /\r?\n/(Git for Windows 的 CRLF)。

import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined; };

if (has("--help") || has("-h")) {
  console.log(`mm-gsd-stage —— 按票面 files_modified 精确暂存

用法:
  node mm-gsd-stage.mjs --ticket <NN-MM> [--plan <PLAN 路径>]

  --ticket <NN-MM>   票号,常规 14-02 / 点修 14-R1(必需)
  --plan <路径>      PLAN 文件;缺省找 .planning/<NN-MM>-PLAN.md
  --help             本说明

行为:
  1. 解析 PLAN frontmatter 的 files_modified(列表逐条,兼容 CRLF)
  2. 按票号派生隔离 GIT_INDEX_FILE 临时索引(基线 = 当时 HEAD),每条路径
     git add -- ":(literal)<路径>" —— 精确暂存,[locale] 不被当 glob;
     只写临时索引,共享 .git/index 零写入(同 wave 并发 add 互不踩踏,REQ-75/D-01)
  3. 不在磁盘且不在索引的路径 → 跳过(新文件暂不存在属正常),不报错
  4. 结束打印暂存计数与本票暂存视图;临时索引 finally 清理

提交必须走 mm-gsd-commit(持 .planning/.commit.lock 串行落盘):stage 只是
「宣言路径可暂存」的隔离预演,不落共享索引 —— stage 后手动 git commit 提交不到东西。

绝不 git add . / -A;退出码 0 = 暂存动作完成(跳过不算失败)。`);
  process.exit(0);
}

const ticket = val("--ticket");
if (!ticket || !/^\d+-(?:R\d+|\d+)$/.test(ticket)) {
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

const gitEnv = (args, env) => spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });

// 票级隔离索引(REQ-75/D-01):基线 = 当时 HEAD;绝不在 HEAD 已存在时拿空索引冒充基线
// (那会把本票之外的文件从树里删掉)。临时索引用完即清,共享 .git/index 零写入。
const idxPath = join(tmpdir(), `mm-gsd-stage-${ticket}-${process.pid}.index`);
const isoEnv = () => ({ ...process.env, GIT_INDEX_FILE: idxPath });

let staged = 0;
const skipped = [];
const statusLines = [];
let failMsg = null;
try {
  const hasHead = gitEnv(["rev-parse", "--verify", "HEAD"], process.env).status === 0;
  const seeded = gitEnv(["read-tree", hasHead ? "HEAD" : "--empty"], isoEnv());
  if (seeded.status !== 0) {
    failMsg = `✗ 重建票级隔离索引失败(GIT_INDEX_FILE):${(seeded.stderr || seeded.stdout || "").trim()}`;
  } else {
    for (const p of paths) {
      if (!existsSync(p)) {
        // 不在磁盘:只有已在索引里的路径暂存得动(如已暂存的删除);两者皆否 → 还没落盘的新文件,跳过
        const ls = gitEnv(["ls-files", "--", `:(literal)${p}`], isoEnv());
        if (ls.status !== 0 || !ls.stdout.trim()) { skipped.push(p); continue; }
      }
      const r = gitEnv(["add", "--", `:(literal)${p}`], isoEnv());
      if (r.status !== 0) {
        failMsg = `✗ git add 失败(${p}):${(r.stderr || r.stdout || "").trim()}`;
        break;
      }
      staged++;
    }
    if (!failMsg) {
      const st = gitEnv(["status", "--porcelain"], isoEnv());
      if (st.status === 0 && st.stdout.trim()) {
        for (const l of st.stdout.split(/\r?\n/)) if (l.trim()) statusLines.push(l);
      }
    }
  }
} finally {
  try { unlinkSync(idxPath); } catch {}
}
if (failMsg) {
  console.error(failMsg);
  process.exit(1);
}

console.log(`✓ 暂存 ${staged}/${paths.length} 条(隔离索引,共享 .git/index 零写入)` + (skipped.length ? `;跳过 ${skipped.length} 条(不在磁盘也不在索引):${skipped.join(", ")}` : ""));
if (statusLines.length) {
  console.log("本票暂存视图(git status --porcelain):");
  for (const l of statusLines) console.log("  " + l);
}
process.exit(0);
