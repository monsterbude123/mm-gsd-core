// 工具遥测看板视图 —— 把本机遥测行聚成「按天柱状图 + 工具分布」所需的纯数据。
//
// 为什么单独成文件:看板要的是**按本地日**的序列(22-CONTEXT D-03),
// checker --stats --tools 要的是运行/派发统计(按次、按角色)。两套口径混在一个文件里,
// 迟早有一边被另一边的归一规则污染 —— 所以这里只放看板这一套。
//
// 为什么不叫 aggregate:references/telemetry-aggregate.mjs 已导出 aggregate(运行/失败口径),
// 同名不同义会让两个模块的 import 混在一起(22-01 PLAN ③ 明令)。
//
// 纯函数、顶层零 I/O:本模块在 references/ 下,会被 R-16 真导入(tools/module-registry.mjs:57-68),
// 顶层有副作用会把整场 health 搞假绿(顶层 exit → 后面所有门禁都没跑却显示全绿)。
// 读文件在调用方做(看板 scripts/mm-gsd-web.mjs 现读现算,不缓存、不外发)。
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
