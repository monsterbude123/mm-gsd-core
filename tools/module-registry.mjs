// 门禁模块登记表 + 台账基线演进检查。
//
// 为什么从 mmc.mjs 抽出来:mmc.mjs 顶过 700 上限两次(实测 git 历史峰值 714),
// 修 G-03 时又超了 11 行。本仓的先例是 gh-issues.mjs 与 rule-baseline.mjs ——
// 同样是顶破才抽。按 budget.json 自己的规矩办。
//
// 这里放的是**登记类核对**:它们要读别的文件的导出、要比对两份记录,
// 而这三件事共同点是「判定依据在别的文件里」,所以天然住在一起。

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 门禁↔台账↔用例登记表的三向核对(R-16)。
 *
 * 三条方向各堵一种腐化路径,缺一条就有一整族绕过:
 *   1. 门禁 → 用例登记   「新增门禁没登记会红用例」→ 门禁坏了没人知道
 *   2. 用例登记 → 门禁   「删了门禁忘了删登记」   → 本仓最常见的腐化路径
 *   3. 门禁 → active 规则「既没规则引用也没登记」→ 门禁安静地永远不执行
 * 单向会漏,所以必须三向一起看。
 *
 * `_` 是台账的元数据约定(`_why`/重开条件),门禁名用它就成了逃生舱:三处协同
 * 改名成 `_check-x` 后两侧的 startsWith("_") 都跳过,门禁从此不必登记会红用例。
 *
 * @returns null 表示全过;否则返回可读的错误串数组
 */
export function registryGaps(checkNames, reg, driven) {
  const gaps = [];
  if (checkNames.some((k) => k.startsWith("_")))
    gaps.push(`门禁名不许以 _ 开头:${checkNames.filter((k) => k.startsWith("_")).join("、")}`);
  for (const k of checkNames)
    if (typeof reg[k] !== "string" || !reg[k].trim()) gaps.push(`门禁 ${k} 没登记会红用例`);
  for (const k of Object.keys(reg)) {
    if (k.startsWith("_")) continue;                    // `_modules` 是嵌套对象,不是门禁名
    if (!checkNames.includes(k)) gaps.push(`台账登记了 ${k},但 mmc.mjs 里没有这个门禁 —— 可能删了门禁忘了删台账`);
  }
  for (const k of checkNames)
    if (!driven.has(k)) gaps.push(`门禁 ${k} 没有 active 规则引用 —— 它永远不会被执行`);
  return gaps;
}

/**
 * references/ 下的门禁模块必须在 gate-cases.json 的 _modules 登记。
 *
 * **真导入模块枚举它的导出**,不靠正则去猜源码里怎么写的声明(G-03)。
 * 此前用 `/export function (check|validate)/` 匹配,于是 `export async function
 * checkNewThing` 一个词就绕过 —— 同一份未登记的门禁模块,写普通 function 被抓到、
 * 写 async 放行。声明怎么写是实现细节,导出**叫什么**才是契约;按实现细节做判定
 * 就会有一整族绕过:正则同时漏 `export const check = () => {}`、`export default
 * function`、`function x(){} export { x }`、双空格、大小写变体。
 *
 * @returns 未登记的模块名数组;空数组表示齐全
 */
export async function unregisteredModules(refDir, registered) {
  const out = [];
  for (const f of readdirSync(refDir).filter((f) => f.endsWith(".mjs"))) {
    let names;
    try { names = Object.keys(await import(pathToFileURL(join(refDir, f)).href)); }
    // 读不懂模块就当它是门禁模块 —— fail-closed,与 T-08 同向
    catch { out.push(f); continue; }
    if (!names.some((n) => /^(check|validate)/.test(n))) continue;
    if (!registered.includes(f)) out.push(f);
  }
  return out;
}

/**
 * 基线与台账必须**双向**一致。
 *
 * 单向(`基线 ⊆ 台账`)能把「删台账」堵住,但把洞挪到了基线那一层(G-02):
 * 只从 rule-baseline.mjs 删掉 R-16 而台账不动,health 照样 exit 0 ——
 * 原始失败形状原样复现,只是删除点从一处变成两处。
 *
 * 更硬的一条:基线是冻结快照,`missingRules` 只查基线⊆台账,反向不查。
 * 实测在台账加 R-17(不写基线)→ 再从台账删掉 → exit 0。
 * **任何基线之后新增的规则永久不受保护,且无人会发现。**
 *
 * 双向查则两条都堵:台账多出基线没有的规则 → 红(新增规则忘了登记基线);
 * 基线多出台账没有的规则 → 红(退役规则忘了从基线删)。前者正是新增规则的入口。
 *
 * @returns {extraInLedger: [...], missingInLedger: [...]} 两个数组都空表示一致
 */
export function baselineDrift(baseline, ledger) {
  const active = new Set((ledger?.rules ?? []).filter((r) => r.status === "active").map((r) => r.id));
  return {
    extraInLedger: [...active].filter((id) => !baseline.includes(id)).sort(),
    missingInLedger: baseline.filter((id) => !active.has(id)),
  };
}
