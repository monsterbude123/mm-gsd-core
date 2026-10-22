// 自测套件 —— 断言工具 + 长到塞不进 gate-selftest.mjs 的用例组。
//
// 为什么改名:它原本叫 selftest-helpers.mjs,只装断言工具(mkAssert)。
// 现在它同时装着用例组,文件名要跟内容对上 —— 文件名骗人比文件超限更难查。
//
// 为什么用例要从 gate-selftest.mjs 里搬出来:那个文件现 200/200 顶着 references/ 的上限,
// 而门禁自测的用例只会继续长 —— 每加一条契约就要加用例。
// 断言只有一份实现(mkAssert),用例可以分文件;抄一份断言就是抄一份会走偏的判据,
// 而「判据走偏」正是自测存在的理由。
//
// 三种断言:eq(正则)、eqN(单值)、eqArr(数组)。全部把失败计入 st.bad。

import { classifyArtifact, parseAccounting, commitExists, checkArtifactLedger } from "./artifact-ledger.mjs";
import { checkPhaseCoverage } from "./decision-gates.mjs";
import { staleDecisions, coveredDecisions, phaseCovered, staleNote, planExists, runDecisionContracts } from "./ticket-alive.mjs";
import { phaseHealth } from "./telemetry-aggregate.mjs";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** 造一组断言。返回的 st.bad 是失败条数 —— 调用方自己决定怎么汇报 */
export function mkAssert() {
  const st = { bad: 0 };
  const eq = (re, s, want, why) => {
    const got = re.test(s), good = got === want;
    if (!good) st.bad++;
    console.log(`  ${good ? "✓" : "✗"} ${why}: ${JSON.stringify(s)} → ${got}`);
  };
  const eqN = (got, want, why) => {
    const good = got === want;
    if (!good) st.bad++;
    console.log(`  ${good ? "✓" : "✗"} ${why}: ${got} → ${good ? "" : want}`);
  };
  const eqArr = (got, want, why) => {
    const good = JSON.stringify(got) === JSON.stringify(want);
    if (!good) st.bad++;
    console.log(`  ${good ? "✓" : "✗"} ${why}: ${JSON.stringify(got)} → ${good ? "" : JSON.stringify(want)}`);
  };
  return { eq, eqN, eqArr, st };
}

/**
 * 工件三态 + 记账台账用例组(原在 gate-selftest.mjs,现搬到这里给新用例腾位置)。
 *
 * 互斥是硬要求:两种毛病同时存在时若能返回两种态,调用方就得自己决定先修哪个,
 * 判定就退化成建议 —— 那正是「建议」与「判定」的分界。
 */
export function runArtifactCases({ eqN, eqArr }) {
  const HEALTHY = { hasSummary: true, summaryStatus: "complete", commits: 2, planDecisionRefs: ["D-01"], ctxDecisionIds: ["D-01", "D-02"] };
  eqN(classifyArtifact(HEALTHY).state, "accounted", "三样齐全 → accounted(不需要任何处置)");
  eqN(classifyArtifact({ ...HEALTHY, hasSummary: false }).state, "incomplete", "缺 SUMMARY → incomplete");
  eqN(classifyArtifact({ ...HEALTHY, summaryStatus: "" }).state, "incomplete", "SUMMARY 缺 status → incomplete");
  eqN(classifyArtifact({ ...HEALTHY, stale: true }).state, "overdue", "CONTEXT 决策已改 → overdue");
  eqN(classifyArtifact({ ...HEALTHY, commits: 0 }).state, "unaccounted", "零 commit → unaccounted");
  eqN(classifyArtifact({ ...HEALTHY, planDecisionRefs: [] }).state, "unaccounted", "零 D-NN 引用 → unaccounted");
  eqArr(classifyArtifact({ ...HEALTHY, commits: 0, planDecisionRefs: [] }).reasons, ["commits", "dnn"], "两种毛病同时在 → 理由是两个,态仍是一个");
  eqN(classifyArtifact({ ...HEALTHY, commits: 0, planDecisionRefs: [] }).state, "unaccounted", "同时缺两样不得判成两种态");
  // 记账台账解析:表头 / 分隔行 / 不认的缺口 / 不像 sha 的值,一律不作数
  const accRows = parseAccounting([
    "| 件 | 缺口 | 记账 commit | 说明 |", "|---|---|---|---|",
    "| 02-01-SUMMARY.md | commits | c5c64f9 | 真记账 |",
    "| 02-02-SUMMARY.md | 瞎写 | c5c64f9 | 缺口不认 |",
    "| 02-03-SUMMARY.md | commits | zzzz | 不是 sha |",
  ].join("\n"));
  eqArr(accRows, [{ file: "02-01-SUMMARY.md", gap: "commits", commit: "c5c64f9" }], "记账台账只认合法行");
  // 记账指向不存在的 commit → 不算记账。git 缺席时同样为 false(fail-closed)
  eqN(commitExists(process.cwd(), "0000000000000000000000000000000000000000"), false, "不存在的 commit 不算记账");
}

/**
 * 决策核销用例组(D-01 反向核销 + D-03 phase 级 union + 批注免单)。
 *
 * fixture 用本仓真实工件格式:phase 与 plan 分两个字段,plan 存票号后缀。
 */
export function runCoverageCases({ eqN, eqArr }) {
  const CTX = "<decisions>\n### [D-01] reversible — 用 JWT\n### [D-02] reversible — 用 Postgres\n</decisions>";
  // covers 只认 covers 字段:正文里提到 D-NN 不算认领(G-08 前半段)
  const plan = (covers, body = "") =>
    `---\nphase: "06"\nplan: "01"\n---\n\n### T1 干活\n- **covers**: ${covers}\n${body}`;
  eqArr(coveredDecisions(plan("D-01")), ["D-01"], "covers 字段里的决策算认领");
  eqArr(coveredDecisions(plan("D-01", "正文里提到 D-02 但那不是认领")), ["D-01"], "正文提到 D-NN 不算认领");
  eqArr(coveredDecisions("没有 covers 字段"), [], "没有 covers 字段 → 认领零条");
  // 反向核销:票认领的决策不在 CONTEXT 里 → 过时信号
  eqArr(staleDecisions(CTX, ["D-01"]), [], "认领的决策还在 CONTEXT 里 → 不过时");
  eqArr(staleDecisions(CTX, ["D-01", "D-09"]), ["D-09"], "认领了 CONTEXT 里没有的决策 → 过时");
  // phase 级 union:并集齐了才绿,少一条指名
  const covErrs = (ids) => { const errs = []; checkPhaseCoverage({ name: "t", ctxText: CTX, coveredIds: ids, e: (m) => errs.push(m) }); return errs; };
  eqN(covErrs(["D-01", "D-02"]).length, 0, "union 覆盖全部决策 → 不判红");
  eqN(covErrs(["D-01"]).length, 1, "union 少一条 → 判红");
  eqN(covErrs(["D-01"]).join().includes("D-02"), true, "少的那条要指名");
  // 批注:stale_note 是免单凭据,但接替票必须真实存在
  eqN(staleNote('---\nstale_note: "D-09 已于 2026-10-22 推翻,本票由 06-02 接替"\n---\n'), "D-09 已于 2026-10-22 推翻,本票由 06-02 接替", "批注要读得出来");
  eqN(staleNote('---\nphase: "06"\n---\n'), null, "没有批注 → null");

  // 端到端:一张活票引用了被推翻的决策 → 报红;加了有效批注 → 免单;接替票不存在 → 照红
  const dir = mkdtempSync(join(tmpdir(), "mm-gsd-stale-"));
  const planning = join(dir, ".planning");
  mkdirSync(planning, { recursive: true });
  writeFileSync(join(planning, "06-CONTEXT.md"), CTX);
  const mkPlan = (name, covers, note = "") =>
    writeFileSync(join(planning, name), `---\nphase: "06"\nplan: "${name.slice(3, 5)}"\n${note}---\n\n### T1 干活\n- **covers**: ${covers}\n`);
  const run = (name) => {
    const errs = [], warns = [];
    runDecisionContracts({
      name, planPath: join(planning, name), ctxs: [{ file: "06-CONTEXT.md", path: join(planning, "06-CONTEXT.md") }],
      root: dir, readFile: (p) => readFileSync(p, "utf8"),
      check: { checkReversibility: () => {}, checkPhaseCoverage: () => {}, checkDrift: () => {} },
      e: (m) => errs.push(m), w: (m) => warns.push(m),
    });
    return { errs, warns };
  };
  mkPlan("06-01-PLAN.md", "D-01, D-09");
  eqN(run("06-01-PLAN.md").errs.length, 1, "活票认领了被推翻的决策 → 报红");
  mkPlan("06-02-PLAN.md", "D-01, D-09", 'stale_note: "D-09 已于 2026-10-22 推翻,本票由 06-01 接替"\n');
  eqN(run("06-02-PLAN.md").errs.length, 0, "批注有效且接替票真实存在 → 免单");
  mkPlan("06-03-PLAN.md", "D-01, D-09", 'stale_note: "D-09 已于 2026-10-22 推翻,本票由 06-99 接替"\n');
  eqN(run("06-03-PLAN.md").errs.length, 1, "批注点名的接替票不存在 → 照红(免单不成立)");
  // phase 级 union 的输入:并集来自本 phase 全部票的 covers
  eqArr(phaseCovered(dir, "06").sort(), ["D-01", "D-09"], "phase union 取本 phase 各票 covers 的并集");
  eqN(planExists(dir, "06-01"), true, "接替票存在性:真实存在的 PLAN 算存在");
  eqN(planExists(dir, "06-99"), false, "不存在的票不算存在");
  rmSync(dir, { recursive: true, force: true });
}

/**
 * phase 过程健康三数(D-04):票数 / 受阻票数 / 缺口数,数的是工件不是遥测。
 */
export function runPhaseHealthCases({ eqN }) {
  const dir = mkdtempSync(join(tmpdir(), "mm-gsd-health-"));
  const pl = join(dir, ".planning");
  mkdirSync(pl, { recursive: true });
  writeFileSync(join(pl, "06-01-PLAN.md"), "x");
  writeFileSync(join(pl, "06-02-PLAN.md"), "x");
  writeFileSync(join(pl, "06-01-SUMMARY.md"), '---\nphase: "06"\nplan: "01"\nstatus: complete\ncommits: 2\n---\n');
  writeFileSync(join(pl, "06-02-SUMMARY.md"), '---\nphase: "06"\nplan: "02"\nstatus: halted\ncommits: 0\n---\n');
  writeFileSync(join(pl, "06-VERIFICATION.md"), "缺口 G-06-1 与 G-06-2,还有重复提到的 G-06-1\n");
  writeFileSync(join(pl, "05-01-PLAN.md"), "别的 phase 不算数");
  const h = phaseHealth(dir, "06");
  eqN(h.tickets, 2, "票数 = 本 phase 的 PLAN 件数");
  eqN(h.blocked, 1, "受阻票数 = status=halted 的 SUMMARY 件数");
  eqN(h.gaps, 2, "缺口数 = VERIFICATION 里的 G-NN-N 个数(重复的只算一次)");
  eqN(phaseHealth(dir, "05").tickets, 1, "别的 phase 的票不算进本 phase");
  rmSync(dir, { recursive: true, force: true });
}

/**
 * 记账纪律进分发包(D-02):「声称完成却零 commit」判红,豁免台账能免单。
 *
 * fixture 是个真的 git 仓库 —— 豁免条件是「记账 commit 真实存在」,
 * 不真的建一个仓库,这条豁免路径就测不到(测的是「不存在的 sha → 照红」那一半)。
 */
export function runLedgerGateCases({ eqN }) {
  const dir = mkdtempSync(join(tmpdir(), "mm-gsd-ledger-"));
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "记账用"], { cwd: dir, stdio: "pipe" });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  const pl = join(dir, ".planning");
  mkdirSync(pl, { recursive: true });
  writeFileSync(join(pl, "06-CONTEXT.md"), "<decisions>\n### [D-01] reversible — 甲\n</decisions>");
  writeFileSync(join(pl, "06-01-PLAN.md"), '---\nphase: "06"\nplan: "01"\n---\n\n### T1 干活\n- **covers**: 无\n');
  writeFileSync(join(pl, "06-01-SUMMARY.md"), '---\nphase: "06"\nplan: "01"\nstatus: complete\ncommits: 0\n---\n');
  const run = (gaps) => {
    const fails = [], infos = [];
    checkArtifactLedger({ root: dir, report: { pass: () => {}, fail: (m) => fails.push(m), info: (m) => infos.push(m) }, gaps });
    return { fails, infos };
  };
  eqN(run(["commits"]).fails.length, 1, "只判 commits:零 commit 的 complete SUMMARY 判红");
  eqN(run(["commits", "dnn"]).fails.length, 2, "两样都判:零 D-NN 引用也进问题清单");
  eqN(run(["dnn"]).fails.length, 1, "只判 dnn:零 commit 那条不进问题清单");
  // 豁免台账:记一行指向真实存在的 commit → 免单
  writeFileSync(join(pl, "artifact-ledger.md"), `| 件 | 缺口 | 记账 commit | 说明 |\n|---|---|---|---|\n| 06-01-SUMMARY.md | commits | ${sha} | 这批改动在别处 |\n`);
  eqN(run(["commits"]).fails.length, 0, "台账记了一行且 sha 真实存在 → 免单");
  // sha 不存在 → 记账不算数
  writeFileSync(join(pl, "artifact-ledger.md"), `| 件 | 缺口 | 记账 commit | 说明 |\n|---|---|---|---|\n| 06-01-SUMMARY.md | commits | 0000000 | 假的 sha |\n`);
  eqN(run(["commits"]).fails.length, 1, "台账行的 sha 不存在 → 照红(一句「已知悉」不算记账)");
  // halted 的工件本来就没有 commit —— 不能冤枉它
  writeFileSync(join(pl, "06-01-SUMMARY.md"), '---\nphase: "06"\nplan: "01"\nstatus: halted\ncommits: 0\n---\n');
  eqN(run(["commits"]).fails.length, 0, "halted 的工件零 commit 不算毛病(它没声称完成)");
  rmSync(dir, { recursive: true, force: true });
}
