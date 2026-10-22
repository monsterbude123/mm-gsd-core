// 参考系对照表的核对 —— 路径失效的参考表比没有参考表更坏。
//
// 为什么需要它:skills/mm-gsd-loop/references/reference-map.md 指向 GSD Core 的具体文件(本机的参考系)。
// 那些路径会失效:GSD 改了目录、本机换了位置、文件被删。
// 一张引用了不存在文件的对照表,读的人会以为「已经查过上游」而直接照着编造 ——
// 那比没有表更坏,因为它提供了虚假的安心。
//
// 所以:表里引用的每个路径都必须真的存在,且引用的必须是**文件**不是目录。

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, isAbsolute } from "node:path";

/** 从 reference-map.md 里抽出所有形如 `src/xxx.cts` / `docs/adr/xxx.md` / `agents/xxx.md` 的路径引用 */
export function extractRefs(md) {
  const out = new Set();
  // 只认反引号里的路径(散文里的普通词不会误伤)
  for (const m of md.matchAll(/`([A-Za-z0-9_./-]+\.(?:cts|md|mjs|json|ts|cts\.cjs))`/g)) {
    const p = m[1];
    // 排除本仓自己的文件(那些由本仓的门禁核对)
    if (p.startsWith("tools/") || p.startsWith("skills/") || p.startsWith("docs/theory")) continue;
    out.add(p);
  }
  return [...out];
}

/**
 * 核对这些路径在 GSD Core 根下是否存在。
 *
 * @param gsdRoot GSD Core 仓库根;不存在时返回 {available:false, reason}
 * @returns {available, missing: [...], checked: n}
 */
export function checkRefs(refs, gsdRoot) {
  if (!gsdRoot || !existsSync(gsdRoot)) {
    return { available: false, reason: "GSD Core 不在本机(参考系不可用)", missing: [], checked: 0 };
  }
  const missing = [];
  for (const r of refs) {
    const abs = isAbsolute(r) ? r : join(gsdRoot, r);
    if (!existsSync(abs)) { missing.push(r); continue; }
    // 目录也算失效:引用要指向具体实现,不是一个可以随便翻的目录
    if (statSync(abs).isDirectory()) missing.push(r + "(是目录,不是具体实现)");
  }
  return { available: true, missing, checked: refs.length };
}

/** GSD Core 根的位置:环境变量优先,其次是本机默认路径 */
export function resolveGsdRoot(env = process.env) {
  return env.GSD_CORE_ROOT || "D:/workspace/gsd-monster/gsd-core";
}

/** 读本仓的参考系对照表 */
export function readMap(mdPath) {
  try { return readFileSync(mdPath, "utf8"); } catch { return null; }
}

/**
 * R-17 门禁本体 —— 核对对照表里的路径在 GSD Core 里真的存在。
 *
 * GSD Core 不在本机时**不判红**:参考系是可选的外部依赖,缺它不是本仓的错。
 * 但要显式说出来,否则「表核过了」的绿灯是假的。
 */
export async function runReferenceMapCheck({ mapPath, gsdRoot, report }) {
  const md = readMap(mapPath);
  if (!md) { report.fail("读不到 skills/mm-gsd-loop/references/reference-map.md —— 参考系对照表没了,概念模糊时就没有上游可查"); return false; }
  const refs = extractRefs(md);
  if (!refs.length) { report.fail("对照表里一个路径引用都没抽到 —— 抽取器坏了,这张表等于没被核对过"); return false; }
  const r = checkRefs(refs, gsdRoot);
  if (!r.available) {
    report.info(`参考系对照表有 ${refs.length} 条路径引用,但 GSD Core 不在本机(${r.reason})—— 这次没核对。装到 ${gsdRoot} 或设 GSD_CORE_ROOT 后可核对`);
    return true;
  }
  if (r.missing.length) {
    report.fail(`对照表里 ${r.missing.length} 条路径在 GSD Core 里不存在:${r.missing.join("、")} —— 引用失效的对照表比没有表更坏`);
    return false;
  }
  report.pass(`参考系对照表的 ${r.checked} 条路径引用全部有效`);
  return true;
}
