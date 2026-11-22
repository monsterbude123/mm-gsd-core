// 工具遥测看板视图 —— 把本机遥测行聚成「按天柱状图 + 工具分布」所需的纯数据。
//
// 为什么单独成文件:看板要的是**按本地日**的序列(22-CONTEXT D-03),
// checker --stats --tools 要的是运行/派发统计(按次、按角色)。两套口径混在一个文件里,
// 迟早有一边被另一边的归一规则污染 —— 所以这里只放看板这一套。
// 34-02 起另放执行效率口径(耗时分位/resume 复用率/context-thrash):终端 --stats 与看板
// /api/state.telemetry 消费同一批纯函数(summarizeRunsWindow/computeEfficiency),口径只此一份。
//
// 为什么不叫 aggregate:references/telemetry-aggregate.mjs 已导出 aggregate(运行/失败口径),
// 同名不同义会让两个模块的 import 混在一起(22-01 PLAN ③ 明令)。
//
// 纯函数、顶层零 I/O:本模块在 references/ 下,会被 R-16 真导入(tools/module-registry.mjs:57-68),
// 顶层有副作用会把整场 health 搞假绿(顶层 exit → 后面所有门禁都没跑却显示全绿)。
// 读文件在调用方做(看板现读现算,不缓存、不外发)。
//
// 导出名避开 check/validate 前缀:那两个前缀在 references/ 里意味着「这是 mmc 门禁模块」,
// 要在 tools/gate-cases.json 的 _modules 登记 —— 本模块不是门禁。

/**
 * 路径归一:反斜杠转正斜杠、去尾斜杠、转小写。
 *
 * 为什么必须归一(D-03 钉死):遥测行里的 cwd 是宿主进程的 cwd,Windows 上同一个目录可能
 * 写成 `C:\Work\Proj`、`c:/work/proj`、`C:\Work\Proj\`。直接等值比较会把全部行滤掉,
 * 看板于是永远是一张空图 —— 空图会被读成「图坏了」。
 *
 * @param {unknown} p 路径
 * @returns {string} 归一后的路径(非字符串入参 → 空串)
 */
function normalizePath(p) {
  return String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * 本地日键:把遥测行的 ts(UTC ISO 串)转成本地日期 `YYYY-MM-DD`。
 *
 * 为什么先转本地时间再取日期(D-03 钉死):ts 是 UTC ISO 串,直接 slice(0,10) 取的是
 * **UTC 日**。UTC 夜里的调用会落到相邻日,面板的「天」与用户直觉差一天。
 * getFullYear/getMonth/getDate 走的就是本地时区,正是要的语义。
 *
 * @param {unknown} ts 遥测行的时间戳
 * @returns {string|null} `YYYY-MM-DD`(月/日补零);时间戳坏了 → null(不猜日期)
 */
function localDayKey(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/**
 * 按天聚合工具遥测行(只留本项目的)。
 *
 * 口径(D-03 钉死):
 *   1. 过滤:行 cwd 归一后与项目根**等值比较**,异 cwd 的行不计入(遥测是用户级的,
 *      里面混着别的项目的调用)。
 *   2. 切桶:命中行按**本地日**切(ts 是 UTC ISO 串,先转本地时间再取日期)。
 *   3. 桶键:`YYYY-MM-DD`,月/日补零(不补零时「2026-1-2」与「2026-01-02」是两个桶,
 *      前端按字符串排序也会错)。
 *   4. 空态:零命中时 series 为空且 empty=true —— 看板据此给文案,而不是画一张空图。
 *
 * @param {Array<{ts?: string, cwd?: string, tool?: string}>} rows 遥测行
 * @param {string} root 项目根(看板的 process.cwd())
 * @returns {{series: Array<{date: string, count: number}>, byTool: Record<string, number>, total: number, empty: boolean}}
 */
export function aggregateByDay(rows, root) {
  const want = normalizePath(root);
  const empty = { series: [], byTool: {}, total: 0, empty: true };
  if (!want) return empty; // 项目根没给 → 一行都不算(不拿空 cwd 去撞)

  const counts = new Map();
  const byTool = {};
  let total = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    if (normalizePath(r.cwd) !== want) continue; // 异 cwd 的行不计入
    const date = localDayKey(r.ts);
    if (!date) continue; // ts 坏了的行不计入(不猜日期,猜出来的桶是假的)
    total += 1;
    counts.set(date, (counts.get(date) ?? 0) + 1);
    const tool = String(r.tool ?? "").trim() || "(未标注)";
    byTool[tool] = (byTool[tool] ?? 0) + 1;
  }

  const series = [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, count]) => ({ date, count }));
  return { series, byTool, total, empty: total === 0 };
}

/**
 * 渲染「过程摩擦概览」区块（纯函数，零值安全降级）。
 * @param {{ totalCalls?: number, planningOps?: number, planningRatio?: number, grepCalls?: number, taskCalls?: number, consecutiveTaskDispatches?: number, maxConsecutiveTasks?: number }} [metrics]
 * @returns {string[]}
 */
export function renderFrictionOverview(metrics) {
  const m = metrics && typeof metrics === "object" ? metrics : {};
  const totalCalls = Number(m.totalCalls) || 0;
  const planningOps = Number(m.planningOps) || 0;
  const planningRatio = Number.isFinite(Number(m.planningRatio)) && totalCalls > 0
    ? Number(m.planningRatio)
    : 0;
  const grepCalls = Number(m.grepCalls) || 0;
  const taskCalls = Number(m.taskCalls) || 0;
  const consecutiveTaskDispatches = Number(m.consecutiveTaskDispatches) || 0;
  const maxConsecutiveTasks = Number(m.maxConsecutiveTasks) || 0;
  return [
    "  过程摩擦概览（观测面，不判红）:",
    `    · 过程工件操作次数占比: ${planningRatio}% (${planningOps}/${totalCalls})  [Read/Write/Edit .planning/]`,
    `    · 同项目连续独立代理派发次数: ${consecutiveTaskDispatches} 次（单段最长连派 ${maxConsecutiveTasks} 次，共 Task ${taskCalls} / Grep ${grepCalls}）`,
  ];
}

// ---- 34-02(REQ-70/71):执行效率与重复读 —— 纯数据聚合 + 文本呈现,终端 --stats 与看板同源 ----
// 宿主差异实测(34-02):ZCode 的子代理工具叫 Agent(mm-gsd-tools.jsonl 385 行 Agent / 0 行 Task),
// Claude Code 叫 Task —— 判子代理行两个名字都认。

const SUBAGENT_TOOLS = ["Task", "Agent"];
const THRASH_MIN_READS = 3;          // 同路径 Read≥3 次才算 thrash(REQ-70 口径)
const THRASH_TOP = 5;                // 呈现时只列最热的 5 处,总数另行报出
const SESSION_GAP_MS = 30 * 60 * 1000;

/**
 * 检查器自身运行耗时摘要(runs.jsonl 的 duration_ms)。
 * 分位用近邻秩(排序后取第 ceil(q/100·n) 个真实样本),不插值 —— 样本少时宁可给出真样本。
 * @returns {{measured: number, p50: number|null, p95: number|null, slow: Array<{ts, mode, cwd, duration_ms}>}}
 */
export function summarizeRunsWindow(rows, root = null, { topN = 5 } = {}) {
  const want = root ? normalizePath(root) : null;
  const hit = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === "object"
    && (!want || normalizePath(r.cwd) === want) && Number.isFinite(Number(r.duration_ms)));
  const ds = hit.map((r) => Number(r.duration_ms)).sort((a, b) => a - b);
  const q = (p) => (ds.length ? ds[Math.min(ds.length - 1, Math.max(0, Math.ceil((p / 100) * ds.length) - 1))] : null);
  const slow = [...hit]
    .sort((a, b) => Number(b.duration_ms) - Number(a.duration_ms))
    .slice(0, topN)
    .map((r) => ({ ts: r.ts, mode: r.mode, cwd: r.cwd, duration_ms: Number(r.duration_ms) }));
  return { measured: ds.length, p50: q(50), p95: q(95), slow };
}

/**
 * 子代理复用率与同路径重复读(context-thrash)。
 *
 * 复用率只在 resume_src 来源键真实出现过时才计算(预审 34-F5):宿主是否在 tool_input 传
 * 续跑键无仓内证据,没观测到键时 reuseRate = null —— 呈现层标「不可得」,绝不输出假的 0%。
 *
 * thrash 分组口径(预审 34-F6,行内无会话/进程标识):cwd × 归一化 target_path;
 * 「会话」用活动间隙近似 —— 同 cwd 的 Read 行间隔超 30 分钟即切新段(标准会话化启发式),
 * 每段内同路径 Read≥3 次记一处热点。历史行无 target_path 字段,自然不参与(不是丢数据)。
 */
export function computeEfficiency(rows, root = null) {
  const want = root ? normalizePath(root) : null;
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === "object"
    && (!want || normalizePath(r.cwd) === want));
  const agents = list.filter((r) => SUBAGENT_TOOLS.includes(String(r.tool ?? "")));
  const srcSeen = agents.filter((r) => r.resume_src).length;
  const resumed = agents.filter((r) => r.is_resume === true).length;
  const reuseRate = srcSeen > 0 && agents.length > 0 ? Math.round((resumed / agents.length) * 100) : null;
  const thrash = [];
  const readsByCwd = new Map();
  for (const r of list) {
    if (r.tool !== "Read" || !r.target_path) continue;
    const t = Date.parse(r.ts);
    if (Number.isNaN(t)) continue;
    const k = String(r.cwd ?? "(未知项目)");
    if (!readsByCwd.has(k)) readsByCwd.set(k, []);
    readsByCwd.get(k).push({ t, path: String(r.target_path) });
  }
  for (const [cwd, reads] of readsByCwd) {
    reads.sort((a, b) => a.t - b.t);
    const cur = new Map();
    let prev = null;
    const flush = () => {
      for (const [p, c] of cur) if (c >= THRASH_MIN_READS) thrash.push({ cwd, path: p, reads: c });
      cur.clear();
    };
    for (const r of reads) {
      if (prev !== null && r.t - prev > SESSION_GAP_MS) flush();
      cur.set(r.path, (cur.get(r.path) ?? 0) + 1);
      prev = r.t;
    }
    flush();
  }
  thrash.sort((a, b) => b.reads - a.reads);
  return { agents: agents.length, resumed, reuseRate, thrashAll: thrash.length, thrash: thrash.slice(0, THRASH_TOP) };
}

/** --stats --tools 的执行效率文本块(与 renderFrictionOverview 并排;空数据也照印,标「不可得/暂无」) */
export function renderEfficiencyOverview(eff) {
  const e = eff && typeof eff === "object" ? eff : { agents: 0, resumed: 0, reuseRate: null, thrashAll: 0, thrash: [] };
  const L = ["  执行效率概览（观测面，不判红）:"];
  L.push(e.reuseRate === null
    ? `    · Agent resume 复用率: 不可得 —— ${e.agents} 次派发均未观测到续跑来源键(resume_src),不计 0%(预审 34-F5)`
    : `    · Agent resume 复用率: ${e.reuseRate}%(${e.resumed}/${e.agents} 次派发为 resume)`);
  if (!e.thrash?.length) {
    L.push("    · 同路径重复读(context-thrash): 暂无热点 —— target_path 自 34-02 起采集,历史行无此字段");
  } else {
    L.push(`    · 同路径重复读告警(Read≥${THRASH_MIN_READS}/会话;口径 cwd×归一化路径,会话=同 cwd 30 分钟无活动切分;共 ${e.thrashAll} 处,列前 ${e.thrash.length}):`);
    for (const t of e.thrash) L.push(`      ${t.reads}×  ${t.path}  (${t.cwd})`);
  }
  return L;
}

/** --stats(runs.jsonl)的耗时文本块;duration_ms 未积累时标「暂无数据」而不是 0 */
export function renderRunsEfficiency(rs) {
  const r = rs && typeof rs === "object" ? rs : { measured: 0, p50: null, p95: null, slow: [] };
  const L = ["  执行耗时(检查器自身 runs.jsonl;观测面,不判红):"];
  L.push(r.measured > 0
    ? `    · 耗时 P50 ${r.p50}ms / P95 ${r.p95}ms(${r.measured} 次含时长)`
    : "    · P50/P95 耗时: 暂无数据 —— duration_ms 自 34-02 起采集,历史行无此字段");
  for (const s of r.slow ?? []) L.push(`      慢模式 ${s.duration_ms}ms · ${s.mode} · ${s.cwd} · ${new Date(s.ts).toLocaleString()}`);
  return L;
}

