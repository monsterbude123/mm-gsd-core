// 遥测聚合 —— observe 环的诊断入口。
//
// 为什么独立成文件:聚合逻辑只在 --stats 模式才需要,是典型的「按需引用的内容」。
// 留在主脚本里时它推着主脚本顶破 700 上限(本轮实测 731)。
//
// 它回答三个问题:失败率多高、哪处反复失败(死锁嫌疑)、报得最多的错误类型(最该修的地方)。
// 第三个问题要求 failures **带原因** —— 所以早退路径必须也把原因写进遥测
// (见 gsd-state-check.mjs 的 die()),否则排行里 97% 是「无消息」,整个入口失明。

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
 * --stats 模式:读用户级遥测日志,打印聚合视图。
 *
 * 为什么搬到这里:它判/读的就是遥测聚合,规则与执行它的扫描放一起名实相符;
 * 主脚本贴着 700 上限(它还要装别的门禁),这段是纯 IO,搬走腾行数。
 */
export function runStats({ path, scope, all, log = console.log }) {
  const rows = readRows(path);
  if (!rows.length) {
    log("尚无运行记录(" + path + ")。");
    log("  检查器每跑一次会自动记一行;跑一次任意模式(默认/--plan/--phases/--worktrees)即产生。");
    return 0;
  }
  log(render(aggregate(rows, { scope, all }), path));
  log("");
  return 0;
}

/**
 * phase 的过程健康三数:票数 / 受阻票数 / 缺口数。
 *
 * **量的来源是 phase 自己的工件历史(`.planning/` 下已落盘的文件),不是遥测**:
 * 用户 2026-10-22 的口径是「遥测不记状态机的推导结果,declared/derived/phase 保持 null」,
 * 而按 phase 统计恰恰需要 phase 维度 —— 所以这里数工件,不去给遥测加维度。
 *
 * **它测的是过程健康,不是质量** —— 代理指标与真目标之间有偏差,打印时必须带这个标注,
 * 否则半年后它会被当成质量分用。
 *
 * 「首次过门禁的轮数」不做:重跑验收会覆盖同一份 VERIFICATION,拿不到轮数;
 * 拿一个假的轮数比不报更坏(它会让人以为「轮数」已经被测过了)。
 */
export function phaseHealth(root, phase) {
  const dir = join(root, ".planning");
  let names = [];
  try { names = readdirSync(dir); } catch { return { tickets: 0, blocked: 0, gaps: 0 }; }
  const own = (f) => f.startsWith(phase + "-");
  const read = (f) => readFileSync(join(dir, f), "utf8");
  let blocked = 0;
  for (const f of names.filter((f) => own(f) && f.endsWith("-SUMMARY.md"))) {
    const st = read(f).match(/^status:\s*"?([^"\n]*)"?\s*$/m)?.[1]?.trim();
    if (st === "halted") blocked++;              // 受阻的票:进过一次 exec 却没走完
  }
  let gaps = 0;
  for (const f of names.filter((f) => own(f) && f.endsWith("-VERIFICATION.md"))) {
    gaps += new Set([...read(f).matchAll(/\bG-\d+-\d+\b/g)].map((m) => m[0])).size;
  }
  return { tickets: names.filter((f) => own(f) && f.endsWith("-PLAN.md")).length, blocked, gaps };
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
