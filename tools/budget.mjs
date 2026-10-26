// 体积统计 —— 数文件数行数,给 check-budget 报告用。
//
// 2026-10-26:「超限诊断」(原 fat-advice)随体积硬顶一起退役 —— 没有上限就没有「超了怎么办」,
// 留着它就是一份没人调用的说明书。想拆文件时该看的是 docs/theory.md T-11,不是它。
//
// 本文件只做测量,不做判断:判断在 mmc 的 check-budget,这里只给它数字。

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** 收集目录下所有受管文件(用于预算统计),返回仓库相对路径 */
export function collectFiles(root, ...dirs) {
  const out = [];
  const walk = (dir) => {
    if (!dir) return;
    let names;
    try { names = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|mjs|ts|json)$/.test(e.name) || e.name === "pre-commit") out.push(p);
    }
  };
  for (const d of dirs) walk(join(root, d));
  // 根级文件(README.md / AGENTS.md 等)也算 —— budget.json 的 docGlobs 里有 "*.md"
  try { for (const e of readdirSync(root, { withFileTypes: true })) if (e.isFile() && /\.(md|mjs|ts|json)$/.test(e.name)) out.push(join(root, e.name)); } catch {}
  return out;
}

/** 找出 skills/ 与 tools/ 下所有 .mjs —— 语法检查与零依赖检查都要用 */
export function collectScripts(root, ...dirs) {
  return collectFiles(root, ...dirs).filter((p) => p.endsWith(".mjs"));
}

/** 每个文件的行数,以及总行数 */
export function countLines(root, files) {
  const counts = {};
  let total = 0;
  for (const f of files) {
    let n = 0;
    try { n = readFileSync(f, "utf8").split(/\r?\n/).length - 1; } catch { n = 0; }
    total += n;
    counts[relative(root, f).split(sep).join("/")] = n;
  }
  return { counts, total };
}
