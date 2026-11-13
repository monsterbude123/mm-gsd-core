// deferred 处置台账解析模块 —— .planning/deferred-LEDGER.md 的四列表格(条目 / 处置 / 指向 / 说明)。
//
// 为什么单独成文件:清零战役(25-02/25-03)写台账、债面板(buildDebt overlay)读台账,
// 键生成与处置判读必须同一套口径 —— 键写两侧各一份必然漂(同 debt-panel/req-ledger 拆出的理由)。
//
// 纯函数,顶层零 I/O:不读文件、不写文件、不 exit、不打日志。文件文本由调用方传进来。
// 导出名一律不以 check/validate 开头:以 check 开头会被 R-16 要求登记进 tools/gate-cases.json。
//
// 口径来源(25-CONTEXT D-01 + 25-01 预审修订,这里只搬运不另发明):
// - append-only:同键多行**末行胜出**(误判可追加新行纠正),matchRow 取命中的最后一行。
// - 处置列**前缀匹配**枚举:「升级REQ-N」「dismissed +证据」这类带修饰写法按前缀归类;
//   前缀不中 → null(照未分类,不给拼写漂移留销账逃生门,对照 reqState 的未知值先例)。
// - 条目原文含半角管道符会破台账表格列:keyFor 与写行双侧同规则归一(半角 | → 全角 ｜)。

/** 拆一行 markdown 表格成单元格(与 debt-panel/req-ledger 同形;解析模块自含,不互 import 私有件)。 */
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** 分隔行判定:所有格都是 --- 或 :---: 这类横线。 */
function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/** 键归一:trim 后把半角管道符替换为全角「｜」(条目原文含管道会破台账表格列,双侧同规则保证键一致)。 */
function normalizeKeyText(text) {
  return String(text ?? "").trim().replace(/\|/g, "｜");
}

/**
 * deferred 条目的台账键:basename(source)(取斜杠后段)+ `#` + 条目文本规范化前 40 字符。
 * @param {{text?: string, source?: string}} entry parseDeferred 的条目形状
 * @returns {string} 形如「01-01-SUMMARY.md#预算余 69 行(2931/3000)。」
 */
export function keyFor(entry) {
  const base = String(entry?.source ?? "").split("/").pop();
  return `${base}#${normalizeKeyText(entry?.text).slice(0, 40)}`;
}

/**
 * 解析 deferred 处置台账(只读)。
 *
 * 只认首格含 `#` 的表格行 —— 表头行(「条目」)与 --- 分隔行天然不命中,不算条目;
 * 首格同样管道归一后提取键(写行侧已归一,这里兜底双侧一致)。
 *
 * @param {string} text deferred-LEDGER.md 全文
 * @returns {Array<{key:string, disposition:string, ref:string, note:string}>}
 *   key/disposition/ref/note 对应 条目 / 处置 / 指向 / 说明 四列。
 */
export function parseDeferredLedger(text) {
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = splitRow(line);
    if (cells.length < 2) continue;
    if (isSeparatorRow(cells)) continue;
    const key = normalizeKeyText(cells[0]);
    if (!key.includes("#")) continue;
    out.push({ key, disposition: cells[1] ?? "", ref: cells[2] ?? "", note: cells[3] ?? "" });
  }
  return out;
}

/**
 * 条目在台账里的生效行:同键多行取**命中的最后一行**(append-only 追加修正语义,
 * 后写胜出 —— 误判可追加新行纠正);无命中 → null。
 *
 * @param {{text?: string, source?: string}} entry parseDeferred 的条目形状
 * @param {Array<{key:string}>} rows parseDeferredLedger 的结果
 * @returns {{key:string, disposition:string, ref:string, note:string}|null}
 */
export function matchRow(entry, rows) {
  const key = keyFor(entry);
  let hit = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && r.key === key) hit = r;
  }
  return hit;
}

/** 处置枚举(前缀匹配;顺序无关 —— 五个前缀首字互不相同)。 */
const DISPOSITIONS = ["升级", "可做", "挂条件", "关闭", "dismissed"];

/**
 * 处置列前缀匹配枚举:「升级REQ-N」「dismissed +证据」这类带修饰写法按前缀归类;
 * 前缀不中(含处置列空)→ null —— 照未分类,不静默归入任何处置。
 *
 * @param {{disposition?: string}|null|undefined} row parseDeferredLedger 的行
 * @returns {"升级"|"可做"|"挂条件"|"关闭"|"dismissed"|null}
 */
export function dispositionOf(row) {
  const disp = String(row?.disposition ?? "").trim();
  if (!disp) return null;
  return DISPOSITIONS.find((d) => disp.startsWith(d)) ?? null;
}
