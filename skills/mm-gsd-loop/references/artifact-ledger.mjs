// 工件记账 —— 历史工件的三态判定,以及「做完了却没记账」的记账门。
//
// 为什么独立成文件:decision-gates.mjs 管「决策有没有被执行」(核销/可逆性/漂移),
// 本文件管「这件工件的账记全了没有」。两种关注面;而且 references/*.mjs 有 200 行上限 ——
// decision-gates.mjs 已经 183 行,三态判定塞不进去(05-01 PLAN 的 [AUTO] 说「放得下」,实测已失效)。
//
// 三态(D-01):过时 / 未完成 / 没记账。第三种最容易被误判成前两种,
// 而「重做一遍」是对已完成工作的最大浪费 —— 它把已验证的成果变成未验证的,
// 还丢掉中间那些当时才知道的上下文。
//
// 判据只取**可机器判定**的事实(SUMMARY 存在性、status、commits),
// 不用 mtime —— mtime 只说明改过,不说改的是决策还是格式。
//
// **决策核销不在这里判**(2026-10-22 退役)。这里曾经自己判一遍「PLAN 零 D-NN 引用」,
// 那是同一个判定的第二个 owner,而判据还更糙(扫全文 D-NN,不是 covers 字段):
// D-03 允许的纯实现票(covers: 无)照样被它判红 —— 实测过,phase union 已覆盖的 phase 里,
// 一张什么都不认领的合法票仍然报红。判定只能有一个 owner:核销归 phase 级 union 门
// (decision-gates.mjs 的 checkPhaseCoverage + ticket-alive.mjs 的 phaseCovered),这里只管记账。

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/** 记账台账文件名。原件不动,新件说清关系(D-01 的补充) */
export const ACCOUNTING_FILE = "artifact-ledger.md";

/** 三态 + 「三样毛病都没有」。accounted 不需要任何处置 */
export const STATES = ["overdue", "incomplete", "unaccounted", "accounted"];

/**
 * 三态判定 —— 一张票(PLAN + 它的 SUMMARY)属于哪一态。**只返回一态**,互斥是硬要求:
 * 两种毛病同时存在时若能返回两种,调用方就得自己决定先修哪个,判定就退化成建议。
 *
 * @param hasSummary     有没有 SUMMARY
 * @param summaryStatus  SUMMARY 的 status(缺 status 也算 incomplete)
 * @param commits        SUMMARY 的 commits 字段(字符串或数字)
 * @param stale          CONTEXT 的决策已改 —— **外部事实**,不由本函数判:
 *                       机器能判的代理(PLAN 引用的 D-NN 已不在 CONTEXT 里)属 G-08,归 02-06
 * @param fourPieceOk    四件套(verify/fails_when/done/read_first)是否齐全
 */
export function classifyArtifact({ hasSummary, summaryStatus, commits, stale = false, fourPieceOk = true }) {
  if (!hasSummary || !summaryStatus) return { state: "incomplete", reasons: ["缺 SUMMARY,或 SUMMARY 缺 status"] };
  if (stale) return { state: "overdue", reasons: ["CONTEXT 的决策已改,本工件实现的是旧决策"] };
  const reasons = [];
  if (!/^\d+$/.test(String(commits ?? "").trim()) || Number(commits) === 0) reasons.push("commits");
  if (!fourPieceOk) reasons.push("done");
  return { state: reasons.length ? "unaccounted" : "accounted", reasons };
}

/**
 * 解析记账台账。表格形:
 *   | 件 | 缺口 | 记账 commit | 说明 |
 *   |---|---|---|---|
 *   | 02-01-SUMMARY.md | commits | c5c64f9 | 该 commit 引入了 02-01 声称的产物 |
 *
 * 记账必须指向一个**真实存在**的 commit —— 否则「记账」就是一句空话,门禁等于白写。
 *
 * 缺口名只认记账门自己判的那几种。「dnn」已退役(核销归 phase 级 union 门),
 * 旧台账里那几行不再被读 —— 它们记的是一条已经不存在的判定。
 */
export function parseAccounting(text) {
  const rows = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.match(/^\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([0-9a-f]{7,40})\s*\|/);
    if (!m) continue;
    const [file, gap, commit] = [m[1], m[2], m[3]];
    if (!/^[\w.-]+\.md$/.test(file)) continue;      // 表头 / 分隔行不作数
    if (!["commits", "done"].includes(gap)) continue;
    rows.push({ file, gap, commit });
  }
  return rows;
}

/** commit 是否真实存在。git 缺席或不是仓库 → false(fail-closed:不核对的记账不算记账) */
export function commitExists(root, sha) {
  try { execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: root, stdio: "pipe" }); return true; }
  catch { return false; }
}

/** 极简 frontmatter 解析 */
function frontmatter(text) {
  const m = String(text ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "").replace(/\s+#.*$/, "");
  }
  return out;
}

function walk(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    const p = join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else if (d.isFile()) out.push(p);
  }
  return out;
}

/** 收齐 .planning 下的工件。SUMMARY 的票号取 frontmatter(phase + plan),不猜文件名 */
function collect(dir) {
  const plans = new Map(), summaries = new Map();
  for (const f of walk(dir)) {
    const base = f.split(/[\\/]/).pop();
    if (base.endsWith("-PLAN.md")) {
      plans.set(base.slice(0, -"-PLAN.md".length), base);
    } else if (base.endsWith("-SUMMARY.md")) {
      const fm = frontmatter(readFileSync(f, "utf8"));
      const ph = fm.phase || base.slice(0, 2);
      // plan 字段存的是票号后缀;缺了才退回文件名(只覆盖第一张票,够用)
      const suf = fm.plan ? String(fm.plan).split(/[,、\s]+/).filter(Boolean) : [base.slice(3, 5)];
      for (const s of suf) if (s) summaries.set(`${ph}-${s}`, { file: base, fm });
    }
  }
  return { plans, summaries };
}

/**
 * 记账完整性门禁(R-18)—— 判一件事:SUMMARY 声称 complete 却 commits 为 0/缺失,
 * 也就是「做完了却没记账」。**决策核销不在这里判**(见文件头)。
 *
 * 处置路径是 D-01 的补充:**原件不动**,在 .planning/artifact-ledger.md 记一行,
 * 指向一个真实存在的 commit。原件是审计痕迹,改它就毁了痕迹。
 *
 * @param report {pass, fail, info} —— mmc 的报告接口
 */
export function checkArtifactLedger({ root, report }) {
  const dir = join(root, ".planning");
  if (!existsSync(dir)) { report.info("没有 .planning/ —— 还没有工件,记账门无事可判"); return true; }

  const acc = new Map();
  const accPath = join(dir, ACCOUNTING_FILE);
  if (existsSync(accPath))
    for (const r of parseAccounting(readFileSync(accPath, "utf8"))) acc.set(`${r.file}|${r.gap}`, r);
  const accounted = (file, gap) => {
    const r = acc.get(`${file}|${gap}`);
    if (!r) return null;
    return commitExists(root, r.commit) ? r : { ...r, broken: true };
  };

  const { plans, summaries } = collect(dir);
  const problems = [], seen = new Set();
  for (const sum of summaries.values()) {
    const v = classifyArtifact({ hasSummary: true, summaryStatus: sum.fm.status, commits: sum.fm.commits });
    if (v.state !== "unaccounted") continue;
    // 「零 commit」只在**声称完成**时才算毛病:一个 halted 的工件本来就没有 commit,
    // 说它「做完了却没记账」是冤枉它。
    if (sum.fm.status !== "complete") continue;
    const file = sum.file, key = `${file}|commits`;
    if (seen.has(key)) continue;              // 一份 SUMMARY 覆盖多票时,同一件只报一次
    seen.add(key);
    const ok = accounted(file, "commits");
    if (ok && !ok.broken) { report.info(`${file}: 零 commit 已记账(${ok.commit})`); continue; }
    if (ok?.broken) { problems.push({ msg: `${file}: 记账指向的 commit ${ok.commit} 不存在 —— 记账不算数`, fix: "改成真实存在的 commit;或撤掉这行记账" }); continue; }
    problems.push({ msg: `${file}: SUMMARY 声称 status=${sum.fm.status} 却 commits 为 ${sum.fm.commits ?? "(缺)"} —— 说做完了,却拿不出一个 commit`,
      fix: `在 .planning/${ACCOUNTING_FILE} 记一行(件 ${file} | 缺口 commits | 记账 commit <真实 sha>),原件不动(D-01 的补充:原件是审计痕迹);sha 必须是真实存在的 commit` });
  }

  for (const p of problems) report.fail(`${p.msg}\n      → ${p.fix}`);
  if (problems.length) return false;
  report.pass(`工件记账完整(${plans.size} 份 PLAN / ${summaries.size} 张票已记账;记账台账 ${acc.size} 条)`);
  return true;
}
