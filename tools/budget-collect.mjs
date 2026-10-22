// 预算统计的收集部分 —— 只算数字,不做判定。
//
// 为什么独立:判定(超没超、报什么)要留在 mmc.mjs 里,因为它依赖 report 的输出形态;
// 而「扫哪些文件、每个多少行」是纯粹的按需引用内容 —— 每次 health 都要重算一遍,
// 但只有这一处用它。按 references 化的判据(主流程不需要每行都读),
// 它该住在外面。mmc.mjs 已长期贴着 700 上限,本仓先例是 gh-issues / rule-baseline /
// module-registry / fat-advice 四个同样因顶破而抽出的模块。

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** 收集目录下所有受管文件(用于预算统计),返回仓库相对路径 */
export function collectFiles(root, skillsDir, toolsDir) {
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
  walk(join(root, skillsDir));
  walk(join(root, toolsDir));
  return out;
}

/** 找出 skills/ 与 tools/ 下所有 .mjs —— 语法检查与零依赖检查都要用 */
export function collectScripts(root, skillsDir, toolsDir) {
  return collectFiles(root, skillsDir, toolsDir).filter((p) => p.endsWith(".mjs"));
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
