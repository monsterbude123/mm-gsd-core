// 遥测聚合 —— observe 环的诊断入口。
//
// 为什么独立成文件:聚合逻辑只在 --stats 模式才需要,是典型的「按需引用的内容」。
// 留在主脚本里时它推着主脚本顶破 700 上限(本轮实测 731)。
//
// 它回答三个问题:失败率多高、哪处反复失败(死锁嫌疑)、报得最多的错误类型(最该修的地方)。
// 第三个问题要求 failures **带原因** —— 所以早退路径必须也把原因写进遥测
// (见 gsd-state-check.mjs 的 die()),否则排行里 97% 是「无消息」,整个入口失明。

import { readFileSync, existsSync } from "node:fs";

/** 读遥测文件;读不到返回空数组 */
export function readRows(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * 聚合并返回可打印的结论。
 *
 * 沙箱记录单独算:自测沙箱里的失败是**正常的**(那是在故意造失败),
 * 混进「最该修的地方」排行会把诊断入口淹掉。靠 sandbox 标记区分,不靠猜路径。
 */
export function aggregate(rows, { scope, all }) {
  // 沙箱判定:优先看显式标记(sandbox:true),再看路径特征作为**兜底**。
  // 兜底是为历史记录准备的 —— 标记只从引入之后生效,之前几千条没有标记。
  // 兜底宁可误判:把一条真项目记录当成沙箱排除,只是少看一次;
  // 反过来把沙箱当真项目,会让「反复失败」排行被自测噪声淹掉。
  const isSandbox = (r) => r.sandbox === true || /[\\/]Temp[\\/]mm(c|gsd)[-/\\]|[\\/]tmp[\\/]mm/i.test(r.cwd ?? "");
  const sandbox = rows.filter(isSandbox);
  const real = rows.filter((r) => !isSandbox(r));
  const only = all ? real : real.filter((r) => r.cwd === scope);
  const bad = only.filter((r) => r.exit === 1);
  const byMode = {};
  for (const r of only) byMode[r.mode] = (byMode[r.mode] ?? 0) + 1;
  const stuck = {};
  for (const r of bad) stuck[r.cwd] = (stuck[r.cwd] ?? 0) + 1;
  const top = {};
  for (const r of bad) for (const m of r.errors ?? []) { const k = m.replace(/"[^"]*"/g, '"…"').slice(0, 40); top[k] = (top[k] ?? 0) + 1; }
  const silent = bad.filter((r) => !(r.errors ?? []).length && !(r.warnings ?? []).length);
  return {
    sandboxCount: sandbox.length, only, bad, byMode, stuck, top, silent,
    scopeName: all ? "全部项目" : "当前项目",
  };
}

/**
 * 把聚合结果渲染成人读的诊断视图。
 *
 * 三样最有用的东西:失败率、反复失败的项目(死锁嫌疑)、高频报错类型(最该修的地方)。
 * 另加一条「零消息失败」计数 —— 它是**可观测性缺陷**的信号,不是内容问题,
 * 但它会让上面的排行失真,所以必须显式报出来而不是混在失败率里。
 */
export function render(a, logPath) {
  const { only, bad, byMode, stuck, top, silent, sandboxCount } = a;
  const L = [];
  L.push(`\nmm-gsd 运行记录(${only.length} 次,${a.scopeName};日志 ${logPath})`);
  if (sandboxCount) L.push(`  (另有 ${sandboxCount} 次沙箱自测记录已排除 —— 那是在故意造失败,不算项目问题)`);
  L.push("  模式分布:   " + Object.entries(byMode).map(([k, v]) => k + "×" + v).join("  "));
  L.push(`  门禁失败:   ${bad.length}/${only.length} 次 (${((bad.length / only.length) * 100).toFixed(0)}%)  —— 连续失败的位置就是它卡住的地方`);
  for (const [cwd, c] of Object.entries(stuck).filter(([, c]) => c >= 3))
    L.push(`  ⚠ 反复失败: ${cwd} 连挂 ${c} 次 —— 大概率是门禁要的东西这一步做不到(死锁),不是内容质量问题`);
  const topList = Object.entries(top).sort((x, y) => y[1] - x[1]).slice(0, 5);
  if (topList.length) { L.push("  高频报错:"); for (const [m, c] of topList) L.push("    " + c + "×  " + m); }
  if (silent.length)
    L.push(`  ⚠ ${silent.length} 次失败没留下原因(占失败的 ${((silent.length / bad.length) * 100).toFixed(0)}%)—— 门禁失明,上面的排行已失真`);
  const last = only[only.length - 1];
  if (last) L.push("  最近一次:   " + new Date(last.ts).toLocaleString() + " · " + last.mode + " · exit=" + last.exit + (last.derived ? " · 推导=" + last.derived : ""));
  return L.join("\n");
}
