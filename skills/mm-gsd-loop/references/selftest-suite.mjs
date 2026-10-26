// 自测套件 —— 断言工具 + 长到塞不进 gate-selftest.mjs 的用例组(原名 selftest-helpers.mjs,只装断言工具;
// 文件名要跟内容对上,文件名骗人比文件超限更难查)。用例从 gate-selftest.mjs 搬来是因为那儿 200/200 顶着上限,
// 而用例只会继续长:断言只有一份实现(mkAssert),用例可以分文件 —— 抄一份断言就是抄一份会走偏的判据。
// 三种断言:eq(正则)、eqN(单值)、eqArr(数组)。全部把失败计入 st.bad。

import { classifyArtifact, parseAccounting, commitExists, checkArtifactLedger } from "./artifact-ledger.mjs";
import { checkPlanReady, REVIEW_PROMPT } from "./plan-ready.mjs";
import { checkPhaseCoverage } from "./decision-gates.mjs";
import { staleDecisions, coveredDecisions, phaseCovered, staleNote, planExists, runDecisionContracts, checkPlanCheckArtifacts } from "./ticket-alive.mjs";
import { phaseHealth } from "./telemetry-aggregate.mjs";
import { checkRoutes, routeSection } from "./agent-routing.mjs";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
 * 互斥是硬要求:两种毛病同时存在时若能返回两种态,调用方就得自己决定先修哪个,判定就退化成建议。
 */
export function runArtifactCases({ eqN, eqArr }) {
  const HEALTHY = { hasSummary: true, summaryStatus: "complete", commits: 2 };
  eqN(classifyArtifact(HEALTHY).state, "accounted", "三样齐全 → accounted(不需要任何处置)");
  eqN(classifyArtifact({ ...HEALTHY, hasSummary: false }).state, "incomplete", "缺 SUMMARY → incomplete");
  eqN(classifyArtifact({ ...HEALTHY, summaryStatus: "" }).state, "incomplete", "SUMMARY 缺 status → incomplete");
  eqN(classifyArtifact({ ...HEALTHY, stale: true }).state, "overdue", "CONTEXT 决策已改 → overdue");
  eqN(classifyArtifact({ ...HEALTHY, commits: 0 }).state, "unaccounted", "零 commit → unaccounted");
  eqN(classifyArtifact({ ...HEALTHY, fourPieceOk: false }).state, "unaccounted", "四件套不齐全 → unaccounted");
  eqArr(classifyArtifact({ ...HEALTHY, commits: 0, fourPieceOk: false }).reasons, ["commits", "done"], "两种毛病同时在 → 理由是两个,态仍是一个");
  // 退役回归(2026-10-22):「零 D-NN 引用」不再是毛病 —— 核销归 phase 级 union 门(D-03)。谁把 per-plan 判定塞回分类器,这里立刻红。
  eqN(classifyArtifact({ ...HEALTHY, planDecisionRefs: [], ctxDecisionIds: ["D-01"] }).state, "accounted", "零 D-NN 引用不再产生理由(核销归 phase 级 union)");
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

/** 路由门禁用例组(D-05):小节在不在、小节点名的技能存不存在 */
export function runRouteCases({ eqN }) {
  const dir = mkdtempSync(join(tmpdir(), "mm-gsd-routes-"));
  const sk = join(dir, "skills");
  const mk = (n, b) => { mkdirSync(join(sk, n), { recursive: true }); writeFileSync(join(sk, n, "SKILL.md"), b); };
  for (const [n, b] of [["mm-gsd-a", "# A\n\n## 完成后\n\n- 下一步:调用 `mm-gsd-b`\n"], ["mm-gsd-b", "# B\n\n## 完成后\n\n- 下一步:调用 `mm-gsd-a`\n"],
    ["mm-gsd-c", "# C\n\n## 干活\n\n- 没什么可说的\n"], ["mm-gsd-d", "# D\n\n## 完成后\n\n- 下一步:调用 `mm-gsd-zzz`\n"]]) mk(n, b);
  const ps = checkRoutes(sk);
  eqN(ps.length, 2, "缺「完成后」小节与点名不存在的技能,各报一条");
  eqN(ps.some((p) => p.skill === "mm-gsd-c"), true, "缺小节要指名是哪个技能");
  eqN(ps.some((p) => p.problem.includes("mm-gsd-zzz")), true, "点名不存在的技能要打出那个名字");
  eqN(ps.every((p) => p.fix && p.fix.length > 8), true, "每条问题都要带改法(三种问题要改的东西不一样)");
  eqN(ps.some((p) => p.skill === "mm-gsd-a"), false, "齐全的技能不该被报");
  eqN(routeSection("## 完成后\n- x\n\n## 别的\n- mm-gsd-zzz\n").includes("mm-gsd-zzz"), false, "「完成后」只到下一个标题为止");
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
  const problems = () => {
    const out = [];
    checkArtifactLedger({ root: dir, report: { pass: () => {}, fail: (m) => out.push(m), info: () => {} } });
    return out;
  };
  eqN(problems().length, 1, "零 commit 的 complete SUMMARY 判红");
  // 预审工件契约(phase 09 D-08):开工了却没预审结论 → 判红(不许静默跳过);还没开工 → 不判红
  const pre = (plans, summaries) => checkPlanCheckArtifacts({ dir: pl, plans, summaries, frontmatter: () => ({ status: "passed" }) });
  eqN(pre(["06-01-PLAN.md"], ["06-01-SUMMARY.md"]).length, 1, "开工却没有 PLAN-CHECK → 判红"); eqN(pre(["06-01-PLAN.md"], []).length, 0, "还没开工 → 不判红");
  writeFileSync(join(pl, "06-01-PLAN-CHECK.md"), '---\nstatus: passed\n---\n'); eqN(pre(["06-01-PLAN.md"], ["06-01-SUMMARY.md"]).length, 0, "预审工件在且 passed → 转绿");
  // 退役回归(2026-10-22):纯实现票(covers: 无)不再是「没记账」—— D-03 之后核销由 phase 级 union 门判,记账门若还按 per-plan 判这里会是 2 条。
  writeFileSync(join(pl, "06-02-PLAN.md"), '---\nphase: "06"\nplan: "02"\n---\n\n### T1 干活\n- **covers**: 无\n');
  writeFileSync(join(pl, "06-02-SUMMARY.md"), '---\nphase: "06"\nplan: "02"\nstatus: complete\ncommits: 2\n---\n');
  eqN(problems().length, 1, "纯实现票(零 D-NN 引用)不进问题清单 —— 核销归 phase 级 union");
  // 豁免台账:记一行指向真实存在的 commit → 免单
  writeFileSync(join(pl, "artifact-ledger.md"), `| 件 | 缺口 | 记账 commit | 说明 |\n|---|---|---|---|\n| 06-01-SUMMARY.md | commits | ${sha} | 这批改动在别处 |\n`);
  eqN(problems().length, 0, "台账记了一行且 sha 真实存在 → 免单");
  // sha 不存在 → 记账不算数
  writeFileSync(join(pl, "artifact-ledger.md"), `| 件 | 缺口 | 记账 commit | 说明 |\n|---|---|---|---|\n| 06-01-SUMMARY.md | commits | 0000000 | 假的 sha |\n`);
  eqN(problems().length, 1, "台账行的 sha 不存在 → 照红(一句「已知悉」不算记账)");
  // halted 的工件本来就没有 commit —— 不能冤枉它
  writeFileSync(join(pl, "06-01-SUMMARY.md"), '---\nphase: "06"\nplan: "01"\nstatus: halted\ncommits: 0\n---\n');
  eqN(problems().length, 0, "halted 的工件零 commit 不算毛病(它没声称完成)");
  rmSync(dir, { recursive: true, force: true });
}

// ---- 显式开工判定(--plan-check 的判定核心):fail-closed,看不清的状态一律不能开工 ----
export function runPlanReadyCases(st) {
  const { eqN } = st;
  const dir = mkdtempSync(join(tmpdir(), "mm-gsd-planready-"));
  const plan = join(dir, "07-01-PLAN.md");
  const check = join(dir, "07-01-PLAN-CHECK.md");
  writeFileSync(plan, "---\nphase: \"07\"\n---\n");
  const ready = () => checkPlanReady({ planPath: plan });
  const put = (body) => writeFileSync(check, body);
  try {
    eqN(ready().state, "missing", "没有预审工件 → missing(不是默认可行)");
    eqN(ready().problems.length, 1, "没有预审工件 → 报一条");
    put('---\nstatus: 看情况\n---\n');
    eqN(ready().state, "invalid", "status 非法 → invalid(fail-closed)");
    put('---\nstatus: blocked\nblockers: 1\nwarnings: 0\nplan: "07-01"\n---\n');
    eqN(ready().state, "blocked", "status=blocked → 不能开工");
    eqN(ready().problems.length, 1, "blocked → 报一条");
    put('---\nstatus: passed\nblockers: 1\nwarnings: 0\nplan: "07-01"\n---\n');
    eqN(ready().problems.length, 1, "status=passed 却 blockers≠0 → 自相矛盾,照红");
    put('---\nstatus: passed\nblockers: 0\nwarnings: 2\nplan: "07-01"\n---\n');
    eqN(ready().problems.length, 1, "status=passed 却 warnings≠0 → 自相矛盾,照红");
    put('---\nstatus: passed\nblockers: 0\nwarnings: 0\nplan: "07-02"\n---\n');
    eqN(ready().problems.length, 1, "预审结论指向别的票 → 照红(别复用别人的结论)");
    put('---\nstatus: passed\nblockers: 0\nwarnings: 0\nplan: "07-01"\n---\n');
    eqN(ready().state, "passed", "工件在、结论 passed、票号对得上 → 可以开工");
    eqN(ready().problems.length, 0, "可以开工 → 没有问题项");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
// ---- 端到端:用户敲的那条命令,真跑一遍,断言退出码与结论(phase 10 预审 B2/B3/W1) ----
// 只测单元级函数是不够的:bin → checker → 判定 → 渲染 → 退出码,任何一环断掉,单元用例照样全绿。
export function runPlanCheckE2ECases(st) {
  const { eqN } = st;
  const dir = mkdtempSync(join(tmpdir(), "mm-gsd-e2e-"));
  const checker = fileURLToPath(new URL("../scripts/gsd-state-check.mjs", import.meta.url));
  const plan = "---\nphase: \"01\"\nplan: \"01\"\ngoal: 夹具计划:跑通 --plan-check 的机器判据\nrollback: 删掉夹具即可\nfiles_modified:\n  - a.mjs\n---\n\n# 01-01 PLAN\n\n### T1 改一个常量\n\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 把常量改成 2,然后跑测试。\n- **verify**: node test.js\n- **fails_when**: 测试退出码非 0(输出里没有 ok)\n- **done**: 测试输出 ok\n";
  const run = (args) => {
    try { return { code: 0, out: execFileSync(process.execPath, [checker, ...args], { cwd: dir, encoding: "utf8", stdio: "pipe" }) }; }
    catch (e) { return { code: e.status ?? 1, out: String(e.stdout || "") + String(e.stderr || "") }; }
  };
  try {
    mkdirSync(join(dir, ".planning"), { recursive: true });
    writeFileSync(join(dir, ".planning", "STATE.md"), "---\nstatus: discussing\nactive_phase: \"01\"\n---\n");
    writeFileSync(join(dir, "a.mjs"), "export const a = 1;\n");
    writeFileSync(join(dir, "test.js"), "console.log(\"ok\");\n");
    writeFileSync(join(dir, ".planning", "01-01-PLAN.md"), plan);
    // 体检模式不要求预审 —— 缺预审时它必须还是绿的(D-01:两个模式问的不是同一个问题)
    const p1 = run(["--plan", ".planning/01-01-PLAN.md"]);
    eqN(p1.code, 0, "缺预审时 --plan 仍是绿的(体检模式不绑架预审)");
    // 显式校验:缺预审 → 不能开工,并且把该派什么打印出来(D-03)
    const p2 = run(["--plan-check", ".planning/01-01-PLAN.md"]);
    eqN(p2.code, 1, "缺预审时 --plan-check 退出码 1(不能开工)");
    eqN(p2.out.includes("不能开工"), true, "缺预审时输出「不能开工」");
    eqN(p2.out.includes(REVIEW_PROMPT.split("\n")[0]), true, "缺预审时把该派的预审提示词打印出来(D-03)");
    // D-04:检查器只读不写 —— 跑完,预审工件仍然不存在
    eqN(existsSync(join(dir, ".planning", "01-01-PLAN-CHECK.md")), false, "--plan-check 自己不写预审工件(D-04)");
    // 预审工件在且 passed → 机器判据全过 → 可以开工
    writeFileSync(join(dir, ".planning", "01-01-PLAN-CHECK.md"), "---\nstatus: passed\nplan: \"01-01\"\nblockers: 0\nwarnings: 0\n---\n");
    const p3 = run(["--plan-check", ".planning/01-01-PLAN.md"]);
    eqN(p3.code, 0, "机器判据全过 + 预审 passed → 退出码 0");
    eqN(p3.out.includes("可以开工"), true, "机器判据全过 + 预审 passed → 输出「可以开工」");
    // D-06:用户真正敲的那条命令(mm-gsd check --plan-check)也要跑通 —— bin 那一跳同样会断
    const bin = fileURLToPath(new URL("../../../bin/mm-gsd.mjs", import.meta.url));
    let p4 = { code: 1, out: "" };
    try { p4 = { code: 0, out: execFileSync(process.execPath, [bin, "check", "--plan-check", ".planning/01-01-PLAN.md"], { cwd: dir, encoding: "utf8", stdio: "pipe" }) }; }
    catch (e) { p4 = { code: e.status ?? 1, out: String(e.stdout || "") + String(e.stderr || "") }; }
    eqN(p4.code, 0, "用户侧命令 mm-gsd check --plan-check 退出码 0(D-06)");
    eqN(p4.out.includes("可以开工"), true, "用户侧命令 mm-gsd check --plan-check 输出「可以开工」");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
