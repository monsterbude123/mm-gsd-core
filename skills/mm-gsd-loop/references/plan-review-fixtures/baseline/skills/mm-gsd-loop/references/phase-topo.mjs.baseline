// phase 依赖拓扑纯函数(24-01 T1a,D-01)—— 看板 /api/state 的分层与边唯一口径。
// 顶层零 I/O:纯函数模块,import 无副作用(req-ledger.mjs 同款纪律)。
// depends_on 解析逐字照抄 checker 基线(gsd-state-check.mjs 的 DEP_RE + splitDeps:
// 全角括号/全角冒号合法;无/无依赖/none/n/a/- → 空数组,形状由 gate-selftest 锁死)——
// 同一份 STATE 行,--phases 与看板必须同答案,另造窄正则会让全角写法被看板静默丢边(预审 W1)。

// checker 基线正则(gsd-state-check.mjs:110),一字不改 —— 改了就是两套口径
const DEP_RE = /[（(]\s*depends_on\s*[:：]\s*([^）)]*)[）)]/i;
const unquote = (s) => String(s ?? "").replace(/^["']|["']$/g, "").trim();

/** 从 phase 行文本(标题 + 行尾注记)解析 depends_on;无注记/「无、none」→ [](正负路径见 board-probe 自测) */
export function parseDepends(text) {
  const raw = DEP_RE.exec(String(text ?? ""))?.[1] ?? "";
  return raw.split(/[,\s]+/).map(unquote)
    .filter((d) => d && !/^(无|无依赖|none|n\/a|-)$/i.test(d));
}

// phase 号比较:两边都是纯数字按数值比(「9」<「21」,字典序会答反),否则字典序 —— 剪环选边与层内排序共用
const cmpId = (a, b) => {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b) || 0;
  return a < b ? -1 : a > b ? 1 : 0;
};

// 沿边方向 from→to,from 能走到 to 吗;环上的边 = to 能绕回 from(自环另算)
function reaches(adj, start, target) {
  const seen = new Set([start]);
  for (const q = [start]; q.length;) {
    const cur = q.pop();
    if (cur === target) return true;
    for (const nxt of adj.get(cur) ?? []) if (!seen.has(nxt)) { seen.add(nxt); q.push(nxt); }
  }
  return false;
}

/**
 * 分层 = 最长路。入参 phases = [{id, depends_on}];出参 { levels: [[id,...],...], edges: [[from,to],...] }。
 * 边方向:from = 被依赖(先做,上层),to = 依赖方(后做,下层)—— 渲染端箭头自上而下,无回边。
 * 防御三则(行为级用例在 board-probe.selftest.mjs,24-01 T1a):
 * ① 幽灵引用(指向不存在的 phase)的边直接丢弃,不悬空;
 * ② 环边确定性剪除:每轮丢「参与环的边里 (from,to) 最大者」(边已升序,自末位起找的第一条即最大),
 *    剪后重算直至无环 —— 每轮恰丢一条边,有穷且确定,渲染端不会挂死;
 * ③ 孤立节点(不在任何边里)落在 level 0,照常进 levels,不因无边而丢失。
 */
export function topoLevels(phases) {
  const ids = (phases ?? []).map((p) => String(p.id));
  const idSet = new Set(ids);
  const seen = new Set();
  let edges = [];
  for (const p of phases ?? []) {
    const to = String(p.id);
    for (const d of p.depends_on ?? []) {
      const from = String(d);
      if (!idSet.has(from)) continue; // 防御①幽灵引用
      const key = from + "\u0000" + to;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([from, to]);
    }
  }
  edges.sort((a, b) => cmpId(a[0], b[0]) || cmpId(a[1], b[1]));
  // 防御②确定性剪环
  while (true) {
    const adj = new Map(ids.map((i) => [i, []]));
    for (const [f, t] of edges) adj.get(f).push(t);
    let drop = null;
    for (let i = edges.length - 1; i >= 0 && !drop; i--) {
      const [f, t] = edges[i];
      if (t === f || reaches(adj, t, f)) drop = edges[i];
    }
    if (!drop) break;
    edges = edges.filter((e) => e !== drop);
  }
  // 分层 = 最长路:level(n) = 依赖里最深者 + 1,无依赖 = 0;DAG 最长路 ≤ n-1 条边,轮数封顶必收敛
  const level = new Map(ids.map((i) => [i, 0]));
  for (let round = 0; round < ids.length; round++) {
    let changed = false;
    for (const [f, t] of edges) {
      const next = level.get(f) + 1;
      if (next > level.get(t)) { level.set(t, next); changed = true; }
    }
    if (!changed) break;
  }
  const levels = [];
  for (const id of ids) (levels[level.get(id)] ??= []).push(id);
  return { levels: levels.filter((g) => g).map((g) => g.sort(cmpId)), edges };
}
