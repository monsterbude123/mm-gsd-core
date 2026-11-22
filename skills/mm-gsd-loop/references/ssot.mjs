// 结构化单一事实源解析(phase 32,REQ-67):五契约的解析只住这里。
// 消费方(gsd-state-check / mm-gsd-web / mmc / selftests)一律 import,不再各抄一份正则
// —— 每加一种工件形态只改本文件(#34 列表形 depends_on / I-008 全角括号 / 「无」语义
// 都是「一处改了别处没改」的实证)。
// 纯函数、顶层零副作用:看板此前「不 import checker」的原因是顶层 MODE 分流与 process.exit
// (预审 F8 已知取舍)—— 本模块没有这些,看板第一次能安全共享解析。
// 判据:输出与被搬移的既有实现逐字一致(--selfcheck 全绿 + health 31/31 是验收,不是口号)。

import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseReqLedger } from "./req-ledger.mjs";
import { parseAccounting } from "./artifact-ledger.mjs";

/** ssot.json 的 schema 版本 —— 不匹配时回落 Markdown(旧路径永远可用) */
export const SSOT_SCHEMA = 1;

/** ssot.json 文件名(在 .planning 下) */
export const SSOT_FILE = "ssot.json";

/** 内容指纹:源文件当前内容的 SHA-256 前 16 hex(D-03:不用 mtime,git checkout/复制会改 mtime → 假报陈旧) */
export function contentSha(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex").slice(0, 16);
}

/**
 * 读结构化镜像(.planning/ssot.json):不存在 → null;schema 版本不符 → null(回落 Markdown)。
 * 镜像里每份契约带 sha(源文件内容指纹)—— 读取时指纹对不上 = 陈旧 = 回落 + 报 warning,
 * 绝不静默用旧值(双真相比只有 Markdown 更坏 —— phase 33 CONTEXT 的靶心)。
 */
export function loadMirror(planningDir) {
  const p = join(planningDir, SSOT_FILE);
  if (!existsSync(p)) return null;
  let j;
  try { j = JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
  if (!j || j.schema !== SSOT_SCHEMA || typeof j.contracts !== "object" || !j.contracts) return null;
  return j;
}

/** 镜像里某契约的值;陈旧(源文件 sha 不匹配)→ null */
export function mirrorValue(mirror, contract, sourceFile, currentText) {
  if (!mirror) return null;
  const c = mirror.contracts[contract];
  if (!c || c.source !== sourceFile) return null;
  if (c.sha && currentText !== undefined && c.sha !== contentSha(currentText)) return null; // 陈旧
  return c.value ?? null;
}

/** 陈旧清单:哪些契约的镜像与源文件脱节(供 --check 与 warning 用) */
export function staleContracts(mirror, planningDir) {
  const out = [];
  if (!mirror) return out;
  for (const [contract, c] of Object.entries(mirror.contracts ?? {})) {
    if (!c?.source || !c?.sha) continue;
    const p = join(planningDir, c.source);
    if (!existsSync(p)) { out.push({ contract, source: c.source, reason: "源文件已删除" }); continue; }
    if (contentSha(readFileSync(p, "utf8")) !== c.sha) out.push({ contract, source: c.source, reason: "源文件已改动(镜像陈旧)" });
  }
  return out;
}

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

/**
 * tier 档位归一化(REQ-73,phase 35):STATE/PLAN frontmatter 的 tier 值 → "L1"|"L2"|"L3";
 * 缺省/非法 → null(消费方按 L3 全环处理 —— 历史 .planning 零回归,[AUTO] 35-02)。
 * tier 随 frontmatter kv 解析在镜像与 Markdown 两条读路径里透传,唯一要新增的解析就是值的合法归一;
 * SSOT_SCHEMA 不 bump:fm 形状未变,存量镜像加 tier 声明后按 sha 陈旧自然回落重导出。
 */
export function normalizeTier(v) {
  const t = String(v ?? "").trim().toUpperCase();
  return ["L1", "L2", "L3"].includes(t) ? t : null;
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

/** REQUIREMENTS.md 文本 → REQ 号集合(baseline 行过滤与 checkReqCoverage 同口径;全角括号与半角同权,G-35-1) */
export function reqIdsFromText(reqText) {
  return String(reqText ?? "")
    .split(/\r?\n/)
    .filter((line) => !/(?:\(|（)baseline/i.test(line))
    .flatMap((line) => [...line.matchAll(/REQ-\d+/gi)].map((m) => m[0].toUpperCase()));
}

/** REQ 抽取(全文,无 baseline 过滤)—— checkReqClaims 的「凭空认领」对账口径 */
export function reqIdsWholeText(text) {
  return [...String(text ?? "").matchAll(/REQ-\d+/gi)].map((m) => m[0].toUpperCase());
}

/**
 * REQ 处置台账(markdown 表)→ [{req, disposition, successor, evidence}]
 * **转发到 req-ledger.mjs 的规范实现**(phase 33 T1 收拢:此前 ssot 自带一份,
 * 形状都不一样(3 列 note vs 4 列 successor/evidence,REQ 模式也不同)—— 这正是
 * phase 32 要消灭的「两份实现漂移」,phase 33 发现它没被消灭干净,如实记)。
 */
export { parseReqLedger } from "./req-ledger.mjs";

/** artifact-ledger(markdown 表)→ [{file, gap, commit}];转发 artifact-ledger.mjs 的规范实现(同上) */
export { parseAccounting } from "./artifact-ledger.mjs";

/** PLAN 文本 → frontmatter kv(四件套/depends_on/wave 的唯一取值口);无法解析返回 null */
export function parsePlanFrontmatter(text) {
  return parseFrontmatterRaw(String(text ?? ""));
}

/**
 * 附加校验入口(供 scripts/ssot-check.mjs 调用):对 .planning 树跑全部契约解析,
 * 返回结构化报告 —— 每份契约的解析结果与问题清单。非法结构由调用方决定退出码。
 */export function ssotReport(planningDir) {  const report = { planningDir, contracts: [], problems: [] };
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
      ? parseReqLedger(readFileSync(p, "utf8"))
      : parseAccounting(readFileSync(p, "utf8"));
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

// ---- 结构化镜像的派生(写读共用 —— 写出与读出若用两套逻辑就会漂移,那是另一条双真相路径)----

/** 五契约从 Markdown 派生的结构化值(镜像的 value 与 fallback 都用它) */
export function deriveContracts(planningDir) {
  const out = { contracts: {} };
  const put = (contract, source, value) => {
    const p = join(planningDir, source);
    if (!existsSync(p)) return;
    out.contracts[contract] = { source, sha: contentSha(readFileSync(p, "utf8")), value };
  };
  const statePath = join(planningDir, "STATE.md");
  if (existsSync(statePath)) put("STATE", "STATE.md", parseFrontmatterRaw(readFileSync(statePath, "utf8")) ?? {});
  const reqPath = join(planningDir, "REQUIREMENTS.md");
  if (existsSync(reqPath)) {
    const t = readFileSync(reqPath, "utf8");
    const d = deriveRequirements(t);
    put("REQUIREMENTS", "REQUIREMENTS.md", { ...d, entries: deriveRequirementEntries(t) });
  }
  const rlPath = join(planningDir, "req-ledger.md");
  if (existsSync(rlPath)) put("req-ledger", "req-ledger.md", parseReqLedger(readFileSync(rlPath, "utf8")));
  const alPath = join(planningDir, "artifact-ledger.md");
  if (existsSync(alPath)) put("artifact-ledger", "artifact-ledger.md", parseAccounting(readFileSync(alPath, "utf8")));
  for (const f of (existsSync(planningDir) ? readdirSync(planningDir) : [])) {
    if (!f.endsWith("-PLAN.md")) continue;
    const fm = parsePlanFrontmatter(readFileSync(join(planningDir, f), "utf8"));
    if (fm) put("PLAN:" + f, f, fm);
  }
  return out;
}

/** REQUIREMENTS.md 全文 → { ids, idsAll, texts }
 * ids = 剔 baseline 行后的 REQ 号(**逐条等价于 reqIdsFromText**,含重复 ——
 * 门禁按数组逐条报,去重会改报错条数);idsAll = 全文 REQ 号(等价 reqIdsWholeText);
 * texts = 每个 REQ 的一句话描述(给人与工具看,门禁不依赖)。
 * 陷阱:REQ 的正则必须与 reqIdsFromText 同为 REQ-\d+ —— 用 REQ-[\w.-]+ 会把
 * "REQ-# 无人认领" 这类说明文字里的 REQ-# 也抓进来(实测多 5 条,行为会变)。 */
export function deriveRequirements(text) {
  const ids = [];
  const idsAll = [];
  const texts = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const baseline = /(?:\(|（)baseline/i.test(line);
    for (const m of line.matchAll(/REQ-\d+/gi)) {
      const id = m[0].toUpperCase();
      idsAll.push(id);
      if (baseline) continue;
      ids.push(id);
      if (texts[id] === undefined) texts[id] = line.slice(line.indexOf(m[0]) + m[0].length).trim().replace(/^[:：]\s*/, "");
    }
  }
  return { ids, idsAll, texts };
}

/** 构建完整镜像对象(schema 版本 + 契约值 + 指纹) */
export function buildMirror(planningDir) {
  const d = deriveContracts(planningDir);
  return { schema: SSOT_SCHEMA, generatedAt: new Date().toISOString(), contracts: d.contracts };
}

// ---- 写入原语(phase 34 REQ-69 收拢):此前原子写内联在 ssot-migrate.mjs —— 写入通道分散
// 就是双口风险(读侧 phase 32 已收拢,写侧补齐)。所有 ssot.json 落盘一律走 writeContracts。

/** 原子写 JSON:先写同目录临时文件再 renameSync(同目录 ⇒ 同卷 ⇒ rename 原子,不留半截状态)。
 * 失败时清理临时文件后**原样抛出** —— 错误处理归调用方(它知道该对用户说什么)。 */
export function atomicWriteJson(targetPath, data) {
  const text = JSON.stringify(data, null, 2) + "\n";
  const tmp = targetPath + ".tmp";
  try {
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, targetPath);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* 临时文件清理失败不掩盖主错误 */ }
    throw e;
  }
}

/** ssot.json 的唯一写入入口:从 Markdown 派生(buildMirror,与读侧同一派生路径)并原子落盘。 */
export function writeContracts(planningDir) {
  atomicWriteJson(join(planningDir, SSOT_FILE), buildMirror(planningDir));
}

// ---- format-aware 读:JSON 新鲜则用 JSON,陈旧/无 JSON 则回落 Markdown(老项目零变化)----

/** STATE 契约读:镜像新鲜 → JSON 值;否则 → Markdown 解析(stale=true 表示镜像陈旧) */
export function readStateContract(planningDir) {
  const p = join(planningDir, "STATE.md");
  if (!existsSync(p)) return { fm: null, stale: false, source: "none" };
  const text = readFileSync(p, "utf8");
  const mirror = loadMirror(planningDir);
  const v = mirrorValue(mirror, "STATE", "STATE.md", text);
  if (v) return { fm: v, stale: false, source: "json" };
  return { fm: parseFrontmatterRaw(text), stale: !!mirror, source: "markdown" };
}

/** PLAN frontmatter 契约读(按文件名) */
export function readPlanContract(planningDir, fileName) {
  const p = join(planningDir, fileName);
  if (!existsSync(p)) return { fm: null, stale: false, source: "none" };
  const text = readFileSync(p, "utf8");
  const mirror = loadMirror(planningDir);
  const v = mirrorValue(mirror, "PLAN:" + fileName, fileName, text);
  if (v) return { fm: v, stale: false, source: "json" };
  return { fm: parseFrontmatterRaw(text), stale: !!mirror, source: "markdown" };
}

/** 契约派发器:按文件名选契约读取路径(STATE / PLAN 走 format-aware;其余走纯解析) */
export function contractFrontmatter(planningDir, filePath) {
  const name = filePath.split(/[\\/]/).pop();
  if (name === "STATE.md") return readStateContract(planningDir).fm;
  if (name.endsWith("-PLAN.md")) return readPlanContract(planningDir, name).fm;
  return parseFrontmatterFile(filePath);
}

/**
 * REQUIREMENTS 的**条目列表**(行锚定 `- REQ-N: 描述`)—— 与 deriveRequirements 的
 * 「ID 集合」是两个不同契约,别混:门禁要的是「文件里提到了哪些 REQ」(全文扫),
 * 看板要的是「有几条需求、各是什么」(只认条目行)。两套语义各自命名、各自实现,
 * 但都住本文件(phase 33:看板自含解析退役)。
 */
export function deriveRequirementEntries(text) {
  const re = /- (REQ-[\w.-]+)(\(baseline[^)]*\))?:\s*(.*)/;
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.match(re);
    if (m) out.push({ id: m[1], baseline: Boolean(m[2]), text: m[3].trim() });
  }
  return out;
}

/** REQUIREMENTS 契约读:返回 { ids, idsAll, texts }(与文本路径逐条等价) */
export function readRequirementsContract(planningDir) {
  const p = join(planningDir, "REQUIREMENTS.md");
  if (!existsSync(p)) return { reqs: { ids: [], idsAll: [], texts: {} }, stale: false, source: "none" };
  const text = readFileSync(p, "utf8");
  const mirror = loadMirror(planningDir);
  const v = mirrorValue(mirror, "REQUIREMENTS", "REQUIREMENTS.md", text);
  if (v) return { reqs: v, stale: false, source: "json" };
  return { reqs: deriveRequirements(text), stale: !!mirror, source: "markdown" };
}

/** REQUIREMENTS 条目列表读(看板用):镜像里带 entries 就用,否则现解析 */
export function readRequirementEntries(planningDir) {
  const p = join(planningDir, "REQUIREMENTS.md");
  if (!existsSync(p)) return [];
  const text = readFileSync(p, "utf8");
  const mirror = loadMirror(planningDir);
  const v = mirrorValue(mirror, "REQUIREMENTS", "REQUIREMENTS.md", text);
  if (v && Array.isArray(v.entries)) return v.entries;
  return deriveRequirementEntries(text);
}

