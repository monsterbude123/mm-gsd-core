// 结构化单一事实源解析(phase 32,REQ-67):五契约的解析只住这里。
// 消费方(gsd-state-check / mm-gsd-web / mmc / selftests)一律 import,不再各抄一份正则
// —— 每加一种工件形态只改本文件(#34 列表形 depends_on / I-008 全角括号 / 「无」语义
// 都是「一处改了别处没改」的实证)。
// 纯函数、顶层零副作用:看板此前「不 import checker」的原因是顶层 MODE 分流与 process.exit
// (预审 F8 已知取舍)—— 本模块没有这些,看板第一次能安全共享解析。
// 判据:输出与被搬移的既有实现逐字一致(--selfcheck 全绿 + health 31/31 是验收,不是口号)。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * frontmatter kv 解析 —— 逐字照抄 gsd-state-check.mjs 的 frontmatter()(REQ-67 唯一实现):
 * 键字符集 [A-Za-z_][\w-]*;必须有闭合 ---;行尾注释只在值不以引号开头时剥;
 * 剥引号(issue #20)。文本入参版;文件版见 parseFrontmatterFile。
 */
export function parseFrontmatterRaw(text) {
  const m = String(text ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    // 行尾注释:值本身不含 # 时才剥(commits: 3  # 说明 → "3")
    let v = kv[2].trim();
    const hash = v.indexOf("#");
    if (hash > 0 && !/^["']/.test(v)) v = v.slice(0, hash).trim();
    // 剥引号(issue #20):active_phase: "33" ⇒ "33"(不带引号)—— 同一包内 worktree-view 已剥,此处补齐口径
    v = v.replace(/^["']|["']$/g, "");
    out[kv[1]] = v;
  }
  return out;
}

/** 文件路径版:不存在 → null(与检查器 frontmatter(path) 契约一致) */
export function parseFrontmatterFile(path) {
  if (!existsSync(path)) return null;
  return parseFrontmatterRaw(readFileSync(path, "utf8"));
}

/** 剥引号(issue #20):active_phase: "33" ⇒ 33 */
export function unquoteFrontmatterValue(v) {
  return String(v ?? "").replace(/^["']|["']$/g, "");
}

/** STATE.md → { status, activePhase, lines, raw } */
export function parseStateFile(statePath, root) {
  const raw = readFileSync(statePath, "utf8");
  const fm = parseFrontmatterRaw(raw) ?? {};
  return {
    raw,
    fm,
    status: fm.status ?? "",
    activePhase: unquoteFrontmatterValue(fm.active_phase ?? "").trim(),
    lines: raw.split(/\r?\n/).length,
    path: statePath,
    root,
  };
}

/** REQUIREMENTS.md 文本 → REQ 号集合(baseline 行过滤与 checkReqCoverage 同口径) */
export function reqIdsFromText(reqText) {
  return String(reqText ?? "")
    .split(/\r?\n/)
    .filter((line) => !/\(baseline/i.test(line))
    .flatMap((line) => [...line.matchAll(/REQ-\d+/gi)].map((m) => m[0].toUpperCase()));
}

/** REQ 抽取(全文,无 baseline 过滤)—— checkReqClaims 的「凭空认领」对账口径 */
export function reqIdsWholeText(text) {
  return [...String(text ?? "").matchAll(/REQ-\d+/gi)].map((m) => m[0].toUpperCase());
}

/** REQ 处置台账(markdown 表)→ [{req, disposition, note}];与 req-ledger.mjs parseReqLedger 同口径 */
export function parseReqLedgerRows(text) {
  const rows = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.match(/^\|\s*REQ-(\d+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/);
    if (m) rows.push({ req: `REQ-${m[1]}`, disposition: m[2].trim(), note: m[3].trim() });
  }
  return rows;
}

/** artifact-ledger(markdown 表)→ [{file, disposition, note}] */
export function parseArtifactLedgerRows(text) {
  const rows = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.match(/^\|\s*([\w./-]+\.(?:md|mjs|js|json))\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/);
    if (m) rows.push({ file: m[1].trim(), disposition: m[2].trim(), note: m[3].trim() });
  }
  return rows;
}

/** PLAN 文本 → frontmatter kv(四件套/depends_on/wave 的唯一取值口);无法解析返回 null */
export function parsePlanFrontmatter(text) {
  return parseFrontmatterRaw(String(text ?? ""));
}

/**
 * 附加校验入口(供 scripts/ssot-check.mjs 调用):对 .planning 树跑全部契约解析,
 * 返回结构化报告 —— 每份契约的解析结果与问题清单。非法结构由调用方决定退出码。
 */
export function ssotReport(planningDir) {
  const report = { planningDir, contracts: [], problems: [] };
  const statePath = join(planningDir, "STATE.md");
  if (existsSync(statePath)) {
    try {
      const st = parseStateFile(statePath, planningDir);
      report.contracts.push({ contract: "STATE", file: "STATE.md", ok: true, fields: { status: st.status, activePhase: st.activePhase, lines: st.lines } });
      if (!st.status) report.problems.push({ contract: "STATE", message: "STATE.md frontmatter 缺 status" });
    } catch (e) {
      report.contracts.push({ contract: "STATE", file: "STATE.md", ok: false });
      report.problems.push({ contract: "STATE", message: "解析失败: " + e.message });
    }
  } else {
    report.contracts.push({ contract: "STATE", file: "STATE.md", ok: false, missing: true });
    report.problems.push({ contract: "STATE", message: "STATE.md 不存在(冷启动用 --init)" });
  }
  const reqPath = join(planningDir, "REQUIREMENTS.md");
  if (existsSync(reqPath)) {
    const ids = reqIdsFromText(readFileSync(reqPath, "utf8"));
    report.contracts.push({ contract: "REQUIREMENTS", file: "REQUIREMENTS.md", ok: true, reqCount: ids.length, reqs: ids });
  } else {
    report.contracts.push({ contract: "REQUIREMENTS", file: "REQUIREMENTS.md", ok: false, missing: true });
  }
  for (const [name, file] of [["req-ledger", "req-ledger.md"], ["artifact-ledger", "artifact-ledger.md"]]) {
    const p = join(planningDir, file);
    if (!existsSync(p)) continue;
    const rows = name === "req-ledger"
      ? parseReqLedgerRows(readFileSync(p, "utf8"))
      : parseArtifactLedgerRows(readFileSync(p, "utf8"));
    report.contracts.push({ contract: name, file, ok: true, rows: rows.length });
  }
  for (const f of (existsSync(planningDir) ? readdirSync(planningDir) : [])) {
    if (!f.endsWith("-PLAN.md")) continue;
    const fm = parsePlanFrontmatter(readFileSync(join(planningDir, f), "utf8"));
    if (!fm) { report.problems.push({ contract: "PLAN-FM", message: f + ": frontmatter 不完整(缺闭合 --- 或无键值行)" }); continue; }
    report.contracts.push({ contract: "PLAN-FM", file: f, ok: true, fields: { phase: fm.phase ?? "", plan: fm.plan ?? "", wave: fm.wave ?? "" } });
  }
  return report;
}

