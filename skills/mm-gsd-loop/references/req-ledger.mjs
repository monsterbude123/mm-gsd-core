// REQ 处置台账解析模块 —— .planning/req-ledger.md 的四列表格(REQ / 处置 / 指向 / 说明)。
//
// 为什么单独成文件:覆盖门(verification-gates 的 checkReqCoverage)与看板(mm-gsd-web.mjs)
// 要用同一套台账口径,口径写在两处必然漂(同 debt-panel 拆出的理由)。
//
// 纯函数,顶层零 I/O:不读文件、不写文件、不 exit、不打日志。文件文本由调用方传进来。
// 导出名一律不以 check/validate 开头:以 check 开头会被 R-16 要求登记进 tools/gate-cases.json。
//
// 口径来源(23-CONTEXT D-01,这里只搬运不另发明):
// - 处置值:delivered(vX.Y.Z)/ superseded(→REQ-M)/ obsolete(挂 D-NN 或批注 id)。
// - 台账无行的 REQ 照旧受覆盖门管辖(照红);认不出的处置值 → active —— 不给拼写漂移留销红
//   逃生门(对照 debt-panel issueState 对未知值显式钉死的先例,23 预审 W7)。

/** 拆一行 markdown 表格成单元格(与 debt-panel 同形;本仓解析模块自含,不互 import 私有件)。 */
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

/**
 * 解析 REQ 处置台账(只读)。
 *
 * 只认首格是 REQ-N 形状的表格行 —— 表头行(「REQ」)与 --- 分隔行天然不命中,不算条目。
 *
 * @param {string} text req-ledger.md 全文
 * @returns {Array<{req:string, disposition:string, successor:string, evidence:string}>}
 *   req 为归一后的大写件号;disposition/successor/evidence 对应 处置 / 指向 / 说明 三列原样。
 */
export function parseReqLedger(text) {
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = splitRow(line);
    if (cells.length < 2) continue;
    if (isSeparatorRow(cells)) continue;
    if (!/^REQ-[\w.-]+$/i.test(cells[0])) continue;
    out.push({
      req: cells[0].toUpperCase(),
      disposition: cells[1] ?? "",
      successor: cells[2] ?? "",
      evidence: cells[3] ?? "",
    });
  }
  return out;
}

/**
 * 判定一个 REQ 的处置状态(D-01)。
 *
 * 处置列取首串 ASCII 词、大小写不敏感(delivered 0.5.0 → delivered;Delivered → delivered)。
 * 认不出的处置值 → active(与「台账无行照红」同向,拼写漂移不销红);台账无行或处置列空 → active。
 *
 * @param {Array<{req:string, disposition:string}>|null|undefined} rows parseReqLedger 的结果
 * @param {string} reqId REQ 件号(大小写不敏感)
 * @returns {"active"|"delivered"|"superseded"|"obsolete"}
 */
export function reqState(rows, reqId) {
  const id = String(reqId ?? "").trim().toUpperCase();
  const row = (Array.isArray(rows) ? rows : []).find((r) => r.req === id);
  if (!row) return "active";
  const word = (String(row.disposition ?? "").trim().match(/[A-Za-z]+/)?.[0] ?? "").toLowerCase();
  if (word === "delivered") return "delivered";
  if (word === "superseded") return "superseded";
  if (word === "obsolete") return "obsolete";
  return "active";
}

/**
 * superseded 行的继任者缺席名单(D-02 闸二:杜绝假销账)。
 *
 * 返回 superseded 行里继任 REQ(指向列的 REQ-M)在 requirementsText 里不存在的 req 名单
 * (空数组 = 全部存在)。superseded 行没写 REQ-M 也算缺席 —— D-01 的台账形状是
 * superseded(→REQ-M),缺指向等于没有继任者,放行就是假销账逃生门。
 *
 * @param {Array<{req:string, disposition:string, successor:string}>} rows parseReqLedger 的结果
 * @param {string} requirementsText REQUIREMENTS.md 全文
 * @returns {string[]}
 */
export function successorExists(rows, requirementsText) {
  const text = String(requirementsText ?? "");
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (reqState(rows, row.req) !== "superseded") continue;
    const m = String(row.successor ?? "").match(/REQ-[\w.-]+/i);
    // 件号不以其语法上的点/连字符收尾;捕获带上了说明性标点时剥掉(REQ-3. 不等于 REQ-3)
    const target = (m ? m[0] : "").toUpperCase().replace(/[.-]+$/, "");
    if (target && new RegExp(`\\b${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) continue;
    out.push(row.req);
  }
  return out;
}
