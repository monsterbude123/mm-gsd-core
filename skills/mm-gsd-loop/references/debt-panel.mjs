// 债面板解析模块 —— 本地账 open 问题 + 未消化批注 + deferred 条目,三源归一。
//
// 为什么单独成文件:看板(mm-gsd-web.mjs)与自测(selftests/debt-panel.selftest.mjs)要用同一套口径。
// 口径写在两处必然漂 —— 一处按台账、一处按原件状态,同一个「open 问题数」在屏上互相打架,
// 读的人只会挑一个信,另一个就是欠账(22-CONTEXT D-02)。
//
// 纯函数,顶层零 I/O:不读文件、不写文件、不 exit、不打日志。只读文件由调用方把文本传进来。
// 顶层 I/O 在被 R-16 真导入时是要命的:缺路径会抛错(被当成「未登记的门禁模块」报红),
// 顶层 exit 会让整场 health 假绿 —— 这两种失败都跟本模块的质量无关,只是把别人的检查搅黄。
//
// 口径来源(D-02/D-05 已钉死,这里只做搬运,不另发明):
// - 本地账现状以 .planning/issues/LEDGER.md 的「处置」列为唯一权威;台账无行才回退原件 I-*.md 的「## 状态」。
// - deferred 条目来自四类工件段落,归一为 {text, kind, condition, owner, source};
//   「分类 / 触发条件(或关闭理由)/ 归属」三列不许归一成纯文本丢掉 —— 丢了就答不出「什么时候做、谁做、为什么现在不做」。
//
// 导出名一律不以 check/validate 开头:以 check 开头会被 R-16 要求登记进 tools/gate-cases.json 的
// _modules(本轮不新增 mmc 门禁,登记了也只是空壳)。

/** 无三列信息时的分类占位:面板上要能看出「这条没登记分类」,不能显示成空格子。 */
const UNCLASSIFIED = "未分类";

/** 只有这四类工件段落是 deferred 的来源(D-05)。PLAN/STATE 等文件里的散文提及不算。 */
const DEBT_SOURCE_FILE = /(?:^|[-\/])(?:CONTEXT|SUMMARY|SHIP|VERIFICATION)\.md$/i;

/**
 * 拆一行 markdown 表格成单元格。
 * @param {string} line 以 | 开头的一行
 * @returns {string[]} 去掉首尾竖线后的各格(已 trim)
 */
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
 * 取一行无序列表条目的文本,含其缩进续行。
 * 真实工件里条目常跨多行(续行缩进 2 空格),只取首行会把条目截断成半句。
 * @param {string[]} lines 全文行
 * @param {number} i 当前行号
 * @returns {{text: string, next: number}|null} 不是条目时返回 null
 */
function parseListItem(lines, i) {
  const m = /^(\s*)[-*+]\s+(.*)$/.exec(lines[i]);
  if (!m) return null;
  let text = m[2].trim();
  let j = i + 1;
  while (j < lines.length) {
    const l = lines[j];
    if (/^\s*[*+-]\s+/.test(l)) break; // 下一个条目
    if (/^\s*#/.test(l)) break; // 标题
    if (/^\s*\|/.test(l)) break; // 表格
    if (/^\s+\S/.test(l)) {
      text += " " + l.trim();
      j += 1;
      continue;
    }
    break;
  }
  return { text, next: j };
}

/**
 * 解析一个 <deferred> 段的内容(表格与无序列表都认)。
 * @param {string} block 段内文本
 * @param {string} source 来源标识
 * @returns {Array<{text:string,kind:string,condition:string,owner:string,source:string}>}
 */
function parseDeferredBlock(block, source) {
  const out = [];
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    if (/^\s*\|/.test(lines[i])) {
      const group = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        group.push(lines[i]);
        i += 1;
      }
      const rows = group.map(splitRow);
      // 头行 + 分隔行不算条目:标准形状是「头行、分隔行、数据行…」
      const sepAt = rows.findIndex(isSeparatorRow);
      const headerAt = sepAt === 1 ? 0 : -1;
      for (let k = 0; k < rows.length; k += 1) {
        if (k === headerAt) continue;
        if (isSeparatorRow(rows[k])) continue;
        const [text, kind, condition, owner] = [rows[k][0] ?? "", rows[k][1] ?? "", rows[k][2] ?? "", rows[k][3] ?? ""];
        if (!text) continue;
        out.push({ text, kind: kind || UNCLASSIFIED, condition, owner, source });
      }
      continue;
    }
    const item = parseListItem(lines, i);
    if (item) {
      out.push({ text: item.text, kind: UNCLASSIFIED, condition: "", owner: "", source });
      i = item.next;
      continue;
    }
    i += 1;
  }
  return out;
}

/**
 * 取某个标题下的正文(到下一个同级或更高级标题为止)。
 * @param {string[]} lines 全文行
 * @param {number} headingAt 标题行号
 * @returns {string[]} 正文行
 */
function sectionBody(lines, headingAt) {
  const level = (/^(\s*#)/.exec(lines[headingAt]) || ["", ""])[1].length;
  const body = [];
  for (let j = headingAt + 1; j < lines.length; j += 1) {
    const h = /^(\s*#)/.exec(lines[j]);
    if (h && h[1].length <= level) break;
    body.push(lines[j]);
  }
  return body;
}

/**
 * 解析 deferred 条目(只读,四种来源)。
 *
 * 认的来源(D-05):①CONTEXT 的 <deferred> 段(四列表格与无序列表)②SUMMARY 的 `## Deferred Issues` 段
 * ③SHIP 的 `Deferred:` 行 ④VERIFICATION 的 `## Deferred Follow-Ups` 段。
 * SUMMARY 里的裸 `## Deferred` 标题(10-01/10-02/11-01/13-02/18 五份 SUMMARY 真实存在)按同一形状一并认,
 * 否则这类真实欠账会被漏报。
 *
 * @param {string} text 工件文本
 * @param {string} [source] 来源标识(通常是文件相对路径);缺省时为空串
 * @returns {Array<{text:string,kind:string,condition:string,owner:string,source:string}>}
 */
export function parseDeferred(text, source = "") {
  const out = [];
  const lines = String(text ?? "").split(/\r?\n/);

  // ① CONTEXT 的 <deferred> 段(标签必须独占一行,否则会抓到正文散文里的行内提及)
  const openRe = /^[ \t]*<deferred>[ \t]*$/;
  const closeRe = /^[ \t]*<\/deferred>[ \t]*$/;
  for (let i = 0; i < lines.length; i += 1) {
    if (!openRe.test(lines[i])) continue;
    let j = i + 1;
    const body = [];
    while (j < lines.length && !closeRe.test(lines[j])) {
      body.push(lines[j]);
      j += 1;
    }
    if (j >= lines.length) break; // 没有闭合标签:不猜
    out.push(...parseDeferredBlock(body.join("\n"), source));
    i = j;
  }

  // ② SUMMARY 的 `## Deferred Issues` 段与裸 `## Deferred` 段;④VERIFICATION 的 `## Deferred Follow-Ups` 段
  let hasSection = false;
  for (let i = 0; i < lines.length; i += 1) {
    const h = /^#{1,6}\s+(.*)$/.exec(lines[i]);
    if (!h) continue;
    const title = h[1].trim();
    const isSummary = /^Deferred Issues\b/.test(title) || /^Deferred$/.test(title);
    const isVerification = /^Deferred Follow-Ups\b/.test(title);
    if (!isSummary && !isVerification) continue;
    hasSection = true;
    const body = sectionBody(lines, i);
    let k = 0;
    while (k < body.length) {
      const item = parseListItem(body, k);
      if (item) {
        out.push({ text: item.text, kind: UNCLASSIFIED, condition: "", owner: "", source });
        k = item.next;
        continue;
      }
      k += 1;
    }
  }

  // ③ SHIP 的 `Deferred:` 行
  for (const line of lines) {
    const m = /^\s*([-*])?\s*Deferred\s*[:：]\s*(.+)$/.exec(line);
    if (!m) continue;
    // 文件里已经有 Deferred 段时,「- Deferred:xxx」多半就是该段里的一条列表项,
    // 再按 SHIP 形状收一遍就是同一条数两次 —— 欠账面板宁可少报也不虚报,跳过。
    // 只跳带列表符的:裸 `Deferred:` 行不是列表项,上面那段收不走它。
    if (hasSection && m[1]) continue;
    const t = m[2].trim();
    if (!t) continue;
    out.push({ text: t, kind: UNCLASSIFIED, condition: "", owner: "", source });
  }

  return out;
}

/**
 * 解析豁免台账(LEDGER.md)的「处置」列。
 *
 * @param {string} text LEDGER.md 全文
 * @returns {Record<string, {id:string, disposition:string, mount:string, note:string}>}
 *   按件号(去 .md 后缀)索引;件号带 .md 后缀也能用 I-001 命中。
 */
export function readLedger(text) {
  const rows = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = splitRow(line);
    if (cells.length < 2) continue;
    if (isSeparatorRow(cells)) continue;
    const raw = cells[0];
    if (!/^[A-Za-z0-9][\w.-]*$/.test(raw)) continue; // 表头「件」等非件号行
    const id = raw.replace(/\.md$/i, "").toUpperCase();
    if (!id) continue;
    rows[id] = {
      id,
      disposition: cells[1] ?? "",
      mount: cells[2] ?? "",
      note: cells[3] ?? "",
    };
  }
  return rows;
}

/**
 * 判定一个本地账问题的现状(D-02 钉死的口径)。
 *
 * 台账处置列出现 closed / fixed 即不再计入 open;处置列为空或标 open 才计入 open;
 * 台账无该行才回退原件状态,原件状态为 open 才计入 open。
 *
 * @param {{disposition?: string}|null|undefined} ledgerRow 台账行(无行传 null/undefined)
 * @param {string} originalStatus 原件 I-*.md 的「## 状态」值
 * @returns {{open: boolean, state: string, source: "ledger"|"original"}}
 */
export function issueState(ledgerRow, originalStatus) {
  if (ledgerRow) {
    const disp = String(ledgerRow.disposition ?? "").trim();
    if (/closed/i.test(disp)) return { open: false, state: "closed", source: "ledger" };
    if (/fixed/i.test(disp)) return { open: false, state: "fixed", source: "ledger" };
    if (!disp) return { open: true, state: "open", source: "ledger" };
    if (/open/i.test(disp)) return { open: true, state: "open", source: "ledger" };
    // 认不出的处置值不当作欠账 —— 宁可少报也不虚报
    return { open: false, state: "unknown", source: "ledger" };
  }
  const word = (String(originalStatus ?? "").trim().split(/\s+/)[0] || "").toLowerCase();
  if (word === "open") return { open: true, state: "open", source: "original" };
  if (word === "fixed") return { open: false, state: "fixed", source: "original" };
  if (word === "closed") return { open: false, state: "closed", source: "original" };
  return { open: false, state: "unknown", source: "original" };
}

/**
 * 汇总本地账未清项。
 *
 * @param {string} ledgerText LEDGER.md 全文
 * @param {Array<{id: string, title?: string, status?: string, file?: string}>} originals 原件解析结果
 * @returns {Array<object>} 只含按 D-02 口径仍算 open 的问题
 */
export function openIssues(ledgerText, originals) {
  const ledger = readLedger(ledgerText);
  const out = [];
  for (const o of originals ?? []) {
    const id = String(o?.id ?? "").replace(/\.md$/i, "").toUpperCase();
    if (!id) continue;
    const row = ledger[id] ?? null;
    const st = issueState(row, o?.status ?? "");
    if (!st.open) continue;
    out.push({
      id,
      title: o?.title ?? "",
      file: o?.file ?? "",
      originalStatus: o?.status ?? "",
      disposition: row ? row.disposition : "",
      state: st.state,
      source: st.source,
    });
  }
  return out;
}

/**
 * 把 planningDir 归一成 [{path, text}]。
 * 接受两种形状:路径 → 文本 的映射,或 [{path, text}] 数组。
 */
function normalizeFiles(planningDir) {
  const out = [];
  if (Array.isArray(planningDir)) {
    for (const f of planningDir) {
      const path = String(f?.path ?? f?.name ?? "").replace(/\\/g, "/");
      if (!path) continue;
      out.push({ path, text: String(f?.text ?? f?.content ?? "") });
    }
    return out;
  }
  for (const [path, text] of Object.entries(planningDir ?? {})) {
    out.push({ path: String(path).replace(/\\/g, "/"), text: String(text ?? "") });
  }
  return out;
}

/** 批注输入归一:数组或 JSON 串都行。 */
function normalizeAnnotations(annotations) {
  if (Array.isArray(annotations)) return annotations;
  if (typeof annotations === "string") {
    try {
      const parsed = JSON.parse(annotations);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * 三源归一:本地账 open 问题 + 未消化批注 + deferred 条目。
 *
 * 目录与文件内容由调用方传入(模块自己不碰文件系统)。
 *
 * deferred 分类感知(23-CONTEXT D-03):kind ∈ {挂条件, 关闭} 的条目已有机器可读的处置理由
 * (触发条件 / 关闭理由),移入 parked 折叠区**不计数**;kind ∈ {未分类, 可做, 候选} 是
 * 没人回答过「什么时候做、谁做」的欠账,诚实计入。counts.deferred / counts.total 只算未清偿口径。
 * parseDeferred 本身不改(解析全量,分类在这里切);parked 条目 condition/owner/source 原样。
 *
 * @param {{planningDir?: Record<string,string>|Array<{path:string,text:string}>, annotations?: Array<object>|string}} input
 * @returns {{localIssues: object[], openAnnotations: object[], deferred: object[], parked: object[], counts: {openIssues:number, openAnnotations:number, deferred:number, parked:number, total:number}}}
 */
export function buildDebt(input = {}) {
  const { planningDir = {}, annotations = [] } = input ?? {};
  const files = normalizeFiles(planningDir);

  const ledgerFile = files.find((f) => /(^|\/)LEDGER\.md$/i.test(f.path));
  const ledgerText = ledgerFile ? ledgerFile.text : "";

  const originals = [];
  for (const f of files) {
    if (!/(^|\/)I-[^/]+\.md$/i.test(f.path)) continue;
    const id = f.path.split("/").pop().replace(/\.md$/i, "");
    const status = (f.text.match(/##\s*状态\s*\n+([^\n]+)/) || [])[1]?.trim() ?? "";
    const title = (f.text.match(/^#\s+(.+)$/m) || [])[1]?.trim() ?? id;
    originals.push({ id, title, status, file: f.path });
  }

  const localIssues = openIssues(ledgerText, originals);
  const openAnnotations = normalizeAnnotations(annotations).filter((a) => a && a.status === "open");

  const PARKED_KINDS = new Set(["挂条件", "关闭"]);
  const deferred = [];
  const parked = [];
  for (const f of files) {
    if (!DEBT_SOURCE_FILE.test(f.path)) continue;
    for (const d of parseDeferred(f.text, f.path)) (PARKED_KINDS.has(d.kind) ? parked : deferred).push(d);
  }

  const counts = {
    openIssues: localIssues.length,
    openAnnotations: openAnnotations.length,
    deferred: deferred.length,
    parked: parked.length,
    total: localIssues.length + openAnnotations.length + deferred.length,
  };
  return { localIssues, openAnnotations, deferred, parked, counts };
}
