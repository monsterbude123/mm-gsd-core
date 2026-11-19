// 自测族模块(phase 30 T2 从 gate-selftest.mjs 拆出):计划门与台账/REQ 族(批图与票预算 / 计划可信度 / 需求覆盖 / baseline 跳过 / REQ 处置台账 / 本地账三选一 / 票号后缀 / 批次圈定 / 引号 / root 布局)
// 断言工具与共享输入由 runSelfTest 显式传入(不自建断言器 —— 失败数必须聚合到同一个 st);
// 时序契约(遥测隔离/env 还原)仍由 runSelfTest 统一持有,本文件不做任何环境操作。

import { checkResearchSummary } from "./research-gates.mjs";
import { checkIssueLedger, checkReqClaims, checkReqCoverage, checkTicketLoad, checkTicketPremises } from "./verification-gates.mjs";
import { checkBatchGraph, checkTicketBudget } from "./worktree-view.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function runPlanGateCases(t, x) {
  const { eq, eqN, eqArr } = t;
  const { CHECKER } = x;

  // ---- 批图与票预算(phase 08 D-02/D-03/D-04):能并行的票不许撞文件;票级 verify 不许是全量套件 ----
  eqN(checkBatchGraph([{ id: "A", files: ["x.js"], depends: [] }, { id: "B", files: ["x.js"], depends: [] }]).length, 1, "同批两票撞文件 → 判红(并行必冲突)");
  eqN(checkBatchGraph([{ id: "A", files: ["x.js"], depends: [] }, { id: "B", files: ["y.js"], depends: [] }]).length, 0, "同批两票不撞文件 → 转绿");
  eqN(checkBatchGraph([{ id: "A", files: ["x.js"], depends: ["B"] }, { id: "B", files: ["x.js"], depends: ["A"] }]).length, 1, "票间依赖成环 → 判红(批图没有入口)");
  eqN(checkTicketBudget([{ id: "T1", verify: "npm test" }]).length, 1, "票级 verify 是全量套件 → 判红(全量属于批级 batch_verify)");
  eqN(checkTicketBudget([{ id: "T1", verify: "node --test test/x.test.mjs" }]).length, 0, "票级 verify 是单文件 → 转绿");
  eqN(checkResearchSummary("## 摘要\n" + Array.from({ length: 20 }, (_, i) => "- 第" + (i + 1) + "行").join("\n")).length, 1, "研究摘要 20 行 → 判红(主上下文会被灌)");
  eqN(checkResearchSummary("## 摘要\n- 一句话结论\n\n## 正文\n细节").length, 0, "研究摘要够短 → 转绿");
  // ---- 计划可信度(phase 09 D-07):前提存在性 / 载量 / 需求反核销 ----
  const d4 = mkdtempSync(join(tmpdir(), "mm-gsd-prem-"));
  mkdirSync(join(d4, "src"), { recursive: true }); writeFileSync(join(d4, "src", "a.mjs"), "x"); mkdirSync(join(d4, ".planning"), { recursive: true }); writeFileSync(join(d4, ".planning", "REQUIREMENTS.md"), "- REQ-1: 真需求\n");
  eqN(checkTicketPremises([{ id: "T1", files: [], readFirst: ["src/a.mjs"], verify: "node --test t.test.mjs" }], d4).length, 1, "票引用不存在的文件 → 判红(假前提 = 执行者空转)");
  eqN(checkTicketPremises([{ id: "T1", files: ["t.test.mjs"], readFirst: ["src/a.mjs"], verify: "node --test t.test.mjs" }], d4).length, 0, "存在 + 这票自己产出 → 转绿");
  eqN(checkTicketLoad([{ id: "T1", readFirst: Array.from({ length: 9 }, (_, i) => "f" + i) }]).length, 1, "read_first 9 条 → 判红(一个子代理读不完这一张票)");
  eqN(checkReqClaims([{ id: "T1", covers: ["REQ-99"] }], d4).length, 1, "认领不存在的 REQ → 判红(凭空认领)");
  eqN(checkReqClaims([{ id: "T1", covers: ["REQ-1"] }], d4).length, 0, "认领真实存在的 REQ → 转绿");
  // ---- 需求覆盖门(phase 17 D-03,issue #21):checkReqClaims 的正方向 —— REQ 落盘了但全部计划无人认领 ----
  writeFileSync(join(d4, ".planning", "REQUIREMENTS.md"), "- REQ-1: 真需求\n- REQ-2: 另一条需求\n");
  writeFileSync(join(d4, ".planning", "09-01-PLAN.md"), "---\nphase: \"09\"\n---\n\n### T1 事\n- **covers**: REQ-1\n");
  eqN(checkReqCoverage({ root: d4, plansDir: join(d4, ".planning") }).length, 1, "REQ 无人认领 → 判红(REQ-2 存在但没有任何票的 covers 认领)");
  writeFileSync(join(d4, ".planning", "09-02-PLAN.md"), "---\nphase: \"09\"\n---\n\n### T1 事\n- **covers**: D-01, REQ-2\n");
  eqN(checkReqCoverage({ root: d4, plansDir: join(d4, ".planning") }).length, 0, "REQ 有人认领 → 转绿(每条 REQ 都有票认领)");
  {
    const d4b = mkdtempSync(join(tmpdir(), "mm-gsd-covnr-"));
    mkdirSync(join(d4b, ".planning"), { recursive: true });
    writeFileSync(join(d4b, ".planning", "09-01-PLAN.md"), "---\nphase: \"09\"\n---\n\n### T1 事\n- **covers**: REQ-1\n");
    eqN(checkReqCoverage({ root: d4b, plansDir: join(d4b, ".planning") }).length, 0, "REQUIREMENTS.md 不存在 → 跳过(空)");
    rmSync(d4b, { recursive: true, force: true });
  }
  // ---- baseline 跳过(phase 19 D-11):REQUIREMENTS.md 晚于部分能力诞生,标 (baseline 的 REQ 不进覆盖集 ----
  {
    const d5 = mkdtempSync(join(tmpdir(), "mm-gsd-basecov-"));
    mkdirSync(join(d5, ".planning"), { recursive: true });
    writeFileSync(join(d5, ".planning", "09-01-PLAN.md"), "---\nphase: \"09\"\n---\n\n### T1 事\n- **covers**: REQ-2\n");
    writeFileSync(join(d5, ".planning", "REQUIREMENTS.md"), "- REQ-1(baseline,0.4.x): 基线能力\n- REQ-2: 新需求\n");
    eqN(checkReqCoverage({ root: d5, plansDir: join(d5, ".planning") }).length, 0, "baseline 标记的 REQ 跳过覆盖集(REQ-1 标 (baseline,0.4.x),无人认领不判红)");
    writeFileSync(join(d5, ".planning", "REQUIREMENTS.md"), "- REQ-1: 基线能力\n- REQ-2: 新需求\n");
    eqN(checkReqCoverage({ root: d5, plansDir: join(d5, ".planning") }).length, 1, "未标 baseline 的 REQ 照判红(同一 REQ-1 无人认领 → 红)");
    rmSync(d5, { recursive: true, force: true });
  }
  // ---- REQ 处置台账 × 覆盖门(23-CONTEXT D-01/D-02,phase 23):处置行跳过、继任者缺席判红、
  //      obsolete 证据闸;台账口径经 references/req-ledger.mjs。上面的 d4/d5 夹具刻意不写 req-ledger.md
  //      —— 它们就是「零台账不废门」的回归证据(闸四:文件不存在时判红集合与旧口径一致)。
  {
    const dRL = mkdtempSync(join(tmpdir(), "mm-gsd-reqled-"));
    mkdirSync(join(dRL, ".planning"), { recursive: true });
    writeFileSync(join(dRL, ".planning", "REQUIREMENTS.md"), "- REQ-1: 需求一\n- REQ-2: 需求二\n");
    writeFileSync(join(dRL, ".planning", "23-01-PLAN.md"), "---\nphase: \"23\"\n---\n\n### T1 事\n- **covers**: REQ-2\n");
    const ledger = (row) => writeFileSync(join(dRL, ".planning", "req-ledger.md"), "| REQ | 处置 | 指向 | 说明 |\n|---|---|---|---|\n" + row);
    const cov = () => checkReqCoverage({ root: dRL, plansDir: join(dRL, ".planning") });
    eqN(cov().length, 1, "台账文件不存在 → REQ-1 照判红(零台账不废门的基线,d4/d5 同款形状)");
    ledger("| REQ-1 | superseded | → REQ-2 | 由 REQ-2 承接 |\n");
    eqN(cov().length, 0, "superseded REQ → 覆盖门跳过");
    ledger("| REQ-2 | delivered | v0.6.0 | 已交付 |\n");
    eqN(cov().some((p) => p.startsWith("REQ-1")), true, "台账无行 REQ 照判红(零台账不废门)");
    ledger("| REQ-1 | superseded | → REQ-9 | 由 REQ-9 承接 |\n");
    eqN(cov().some((p) => p.includes("取代者不存在 —— 记账不算数(假销账)")), true, "superseded 继任者缺席 → 判红");
    ledger("| REQ-1 | obsolete | — |  |\n");
    eqN(cov().some((p) => p.includes("obsolete 无证据")), true, "obsolete 无证据 → 判红");
    ledger("| REQ-1 | obsolete | — | 挂 D-01 |\n");
    eqN(cov().length, 0, "obsolete 挂 D-01 → 跳过");
    rmSync(dRL, { recursive: true, force: true });
  }
  // ---- 本地账三选一门(phase 19 D-11,RC2 解药):诊断过的坑不许裸放 ----
  {
    const d6 = mkdtempSync(join(tmpdir(), "mm-gsd-iledger-"));
    const isd = join(d6, ".planning", "issues");
    mkdirSync(isd, { recursive: true });
    writeFileSync(join(isd, "I-001.md"), "# I-001 事\n\n## 状态\n\nopen\n\n## 证据\n\n跑了几次都红\n");
    eqN(checkIssueLedger({ root: d6 }).length, 1, "本地账 open 无 REQ 无门名无 LEDGER → 判红(诊断后裸放 = RC2 复发)");
    writeFileSync(join(isd, "LEDGER.md"), "| 件 | 处置 | 挂靠 | 说明 |\n|---|---|---|---|\n| I-001.md | open | — | 已登记,重开条件:同一红再挂 |\n");
    eqN(checkIssueLedger({ root: d6 }).length, 0, "LEDGER 有行 → 转绿(豁免台账先例,同 artifact-ledger)");
    // 别误杀合法形态:fixed 待 distill 第三态 / 挂 REQ / 挂门名
    writeFileSync(join(isd, "I-002.md"), "# I-002 事\n\n## 状态\n\nfixed (待 distill)\n");
    writeFileSync(join(isd, "I-003.md"), "# I-003 事\n\n## 状态\n\nopen\n\n挂 REQ-9 承接\n");
    writeFileSync(join(isd, "I-004.md"), "# I-004 事\n\n## 状态\n\nopen\n\n挂 check-req-coverage 门盯着\n");
    eqN(checkIssueLedger({ root: d6 }).length, 0, "closed/fixed 第三态、挂 REQ、挂门名不误杀(fixed 待 distill 是合法第三态)");
    rmSync(d6, { recursive: true, force: true });
    eqN(checkIssueLedger({ root: join(tmpdir(), "mm-gsd-no-issues-dir") }).length, 0, "issues 目录不存在 → 跳过(空)");
  }
  rmSync(d4, { recursive: true, force: true });
  // ---- 票号后缀(#11):T3b 是真票,不是隐形 ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-tsuf-"));
    mkdirSync(join(d, ".planning"), { recursive: true });
    writeFileSync(join(d, "a.mjs"), "x\n");
    const fm = '---\nphase: "14"\nplan: "02"\ngoal: g\nrollback: r\nfiles_modified:\n  - a.mjs\ndepends_on: []\n---\n\n';
    const full = '### T3b 事\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 做\n- **verify**: node a.mjs\n- **fails_when**: 退出码非 0(无 ok)\n- **done**: ok\n';
    writeFileSync(join(d, ".planning", "14-02-PLAN.md"), fm + full);
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [CHECKER, "--plan", join(d, ".planning", "14-02-PLAN.md")], { cwd: d, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
    eqN(code === 0 && !out.includes("T3b:"), true, "带字母后缀的票被认领(T3b 四件套照查)");
    writeFileSync(join(d, ".planning", "14-02-PLAN.md"), fm + "### T3b 事\n- **files**: a.mjs\n");
    try { out = execFileSync(process.execPath, [CHECKER, "--plan", join(d, ".planning", "14-02-PLAN.md")], { cwd: d, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
    eqN(code === 1 && out.includes("T3b"), true, "T3b 缺四件套判红不隐形");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- 批次圈定(#14):多路径进批图;未检查批次要说出口 ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-multi-"));
    mkdirSync(join(d, ".planning"), { recursive: true });
    writeFileSync(join(d, "a.mjs"), "x\n");
    const mk = (n, f) => '---\nphase: "14"\nplan: "' + n + '"\ngoal: g\nrollback: r\nfiles_modified:\n  - ' + f + '\ndepends_on: []\n---\n\n### T1 事\n- **files**: ' + f + '\n- **read_first**: ' + f + '\n- **action**: 做\n- **verify**: node ' + f + '\n- **fails_when**: 退出码非 0(无 ok)\n- **done**: ok\n';
    writeFileSync(join(d, ".planning", "14-01-PLAN.md"), mk("01", "a.mjs"));
    writeFileSync(join(d, ".planning", "14-02-PLAN.md"), mk("02", "a.mjs"));
    writeFileSync(join(d, ".planning", "14-03-PLAN.md"), mk("03", "b.mjs"));
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [CHECKER, "--plan", join(d, ".planning", "14-01-PLAN.md"), join(d, ".planning", "14-02-PLAN.md")], { cwd: d, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
    eqN(code === 1 && out.includes("14-01") && out.includes("14-02") && out.includes("撞了文件"), true, "--plan 收多路径(两份同 phase 计划撞文件 → 批图判红)");
    writeFileSync(join(d, ".planning", "STATE.md"), '---\nstatus: planning\nactive_phase: "14"\n---\n');
    writeFileSync(join(d, "c.mjs"), "y\n");
    writeFileSync(join(d, ".planning", "15-01-PLAN.md"), mk("01", "c.mjs").replace('phase: "14"', 'phase: "15"'));
    try { out = execFileSync(process.execPath, [CHECKER, "--plan"], { cwd: d, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); }
    eqN(out.includes("另有") && out.includes("15"), true, "无参时未检查的其它 phase 计划有显式提示");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- active_phase 带引号 vs 不带引号(#20):引号必须被 frontmatter() 剥掉 ----
  {
    const d3 = mkdtempSync(join(tmpdir(), "mm-gsd-aph-"));
    mkdirSync(join(d3, ".planning"), { recursive: true });
    writeFileSync(join(d3, ".planning", "STATE.md"), "---\nstatus: executing\nactive_phase: '01'\n---\n---\n---");
    writeFileSync(join(d3, ".planning", "01-01-PLAN.md"), "---\nphase: '01'\n---\n---");
    writeFileSync(join(d3, ".planning", "02-01-PLAN.md"), "---\nphase: '02'\n---\n---");
    let o3 = "";
    try { o3 = execFileSync(process.execPath, [CHECKER, "--json"], { cwd: d3, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { o3 = String(e.stdout || "") + String(e.stderr || ""); }
    const j3 = JSON.parse(o3.slice(o3.indexOf("{")));
    eqN(j3.artifacts && j3.artifacts.plans, 1, "active_phase 带引号(#20):工件按引号剥离后的值选择,不回退到别的 phase");
    rmSync(d3, { recursive: true, force: true });
  }
  // ---- #9:root 布局推导按 active_phase 计数(历史工件不淹没) ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-root9-"));
    mkdirSync(join(d, ".planning"), { recursive: true });
    writeFileSync(join(d, ".planning", "STATE.md"), '---\nstatus: executing\nactive_phase: "07"\n---\n');
    writeFileSync(join(d, ".planning", "01-01-PLAN.md"), '---\nphase: "01"\n---\n');
    writeFileSync(join(d, ".planning", "01-01-SUMMARY.md"), '---\nphase: "01"\nplan: "01"\nstatus: complete\ncommits: 3\n---\n');
    writeFileSync(join(d, ".planning", "07-01-PLAN.md"), '---\nphase: "07"\n---\n');
    let out = "";
    try { out = execFileSync(process.execPath, [CHECKER, "--json"], { cwd: d, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); }
    const j = JSON.parse(out.slice(out.indexOf("{")));
    eqN(j.artifacts && j.artifacts.plans, 1, "root 布局推导按 active_phase 计数(历史工件不淹没)");
    rmSync(d, { recursive: true, force: true });
  }
}
