// 自测族模块(phase 30 T2 从 gate-selftest.mjs 拆出):计划门与台账/REQ 族(批图与票预算 / 计划可信度 / 需求覆盖 / baseline 跳过 / REQ 处置台账 / 本地账三选一 / 票号后缀 / 批次圈定 / 引号 / root 布局)
// 断言工具与共享输入由 runSelfTest 显式传入(不自建断言器 —— 失败数必须聚合到同一个 st);
// 时序契约(遥测隔离/env 还原)仍由 runSelfTest 统一持有,本文件不做任何环境操作。

import { checkResearchSummary } from "./research-gates.mjs";
import { checkIssueLedger, checkReqClaims, checkReqCoverage, checkTicketLoad, checkTicketPremises } from "./verification-gates.mjs";
import { checkBatchGraph, checkTicketBudget } from "./worktree-view.mjs";
import { parsePlanFrontmatter } from "./ssot.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
  // ---- Wiring Ticket 拦停(phase 36 T3,REQ-76/D-02):聚合出口/接线点碰撞引导拆后置接线票(孪生:红例 + 不误伤绿例) ----
  {
    const w = checkBatchGraph([{ id: "A", files: ["src/index.ts"], depends: [] }, { id: "B", files: ["src/index.ts"], depends: [] }]);
    eqN(w.length, 1, "同波两票共触 index.ts 聚合出口 → 判红");
    eqN(w.length === 1 && w[0].includes("Wiring Ticket"), true, "聚合出口碰撞引导拆后置 Wiring Ticket(不是普通拆批话术)");
    const plain = checkBatchGraph([{ id: "A", files: ["a.js"], depends: [] }, { id: "B", files: ["a.js"], depends: [] }]);
    eqN(plain.length === 1 && plain[0].includes("拆批或补依赖") && !plain[0].includes("Wiring Ticket"), true, "普通文件碰撞仍走旧口径(聚合出口话术不误标)");
    const decl = checkBatchGraph([{ id: "A", files: ["a.ts"], wiring: ["agg.ts"], depends: [] }, { id: "B", files: ["b.ts"], wiring: ["agg.ts"], depends: [] }]);
    eqN(decl.length === 1 && decl[0].includes("Wiring Ticket"), true, "两票显式标明同一 wiring 共享点(文件不重叠)→ 判红引导接线票");
    eqN(checkBatchGraph([{ id: "A", files: ["src/a/index.ts"], depends: [] }, { id: "B", files: ["src/b/index.ts"], depends: [] }]).length, 0, "不同目录各自的 barrel 出口 → 不误伤");
    eqN(checkBatchGraph([{ id: "A", files: ["a.ts"], wiring: ["agg.ts"], depends: [] }, { id: "B", files: ["b.ts"], wiring: ["other.ts"], depends: [] }]).length, 0, "wiring 声明不相交 → 转绿");
  }
  // ---- G-36-1:wiring 声明通道走生产链路(ssot parsePlanFrontmatter → parsePlanFile → batchPlans → checkBatchGraph) ----
  {
    // 解析孪生(解析唯一实现住 ssot,REQ-67):内联与块式都认
    eqArr(parsePlanFrontmatter('---\nphase: "14"\nwiring: [agg.ts, routes.ts] # 注释剥\n---\n').wiring, ["agg.ts", "routes.ts"], "wiring 内联列表解析(注释剥、括号剥)");
    eqArr(parsePlanFrontmatter('---\nphase: "14"\nwiring:\n  - agg.ts\n  - "other.ts"\nfiles_modified:\n  - a.ts\n---\n').wiring, ["agg.ts", "other.ts"], "wiring 块式列表解析(列表项逐条收,遇新键停)");
    // 生产链路孪生:夹具 PLAN 标 wiring → CHECKER --plan 门禁判红引导 Wiring Ticket;无声明对照不误标
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-wiring-"));
    mkdirSync(join(d, ".planning"), { recursive: true });
    writeFileSync(join(d, "agg.ts"), "x\n"); writeFileSync(join(d, "a.ts"), "x\n"); writeFileSync(join(d, "b.ts"), "x\n");
    const mk = (n, own, w) => '---\nphase: "14"\nplan: "' + n + '"\n' + (w ? 'wiring: [agg.ts]\n' : '') + 'goal: g\nrollback: r\nfiles_modified:\n  - ' + own + '\n  - agg.ts\ndepends_on: []\n---\n\n### T1 事\n- **files**: ' + own + ', agg.ts\n- **read_first**: ' + own + '\n- **action**: 做\n- **verify**: node ' + own + '\n- **fails_when**: 退出码非 0(无 ok)\n- **done**: ok\n';
    writeFileSync(join(d, ".planning", "14-01-PLAN.md"), mk("01", "a.ts", true));
    writeFileSync(join(d, ".planning", "14-02-PLAN.md"), mk("02", "b.ts", true));
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [CHECKER, "--plan", join(d, ".planning", "14-01-PLAN.md"), join(d, ".planning", "14-02-PLAN.md")], { cwd: d, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
    eqN(code === 1 && out.includes("Wiring Ticket"), true, "wiring 声明经生产 --plan 门禁判红(声明通道全链:解析→批图→拦停)");
    writeFileSync(join(d, ".planning", "14-01-PLAN.md"), mk("01", "a.ts", false));
    writeFileSync(join(d, ".planning", "14-02-PLAN.md"), mk("02", "b.ts", false));
    try { out = execFileSync(process.execPath, [CHECKER, "--plan", join(d, ".planning", "14-01-PLAN.md"), join(d, ".planning", "14-02-PLAN.md")], { cwd: d, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
    eqN(code === 1 && out.includes("撞了文件") && !out.includes("Wiring Ticket"), true, "无声明对照不误标(agg.ts 非聚合形状 → 仍走旧口径,声明与形状通道分工)");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- 并发隔离真跑用例(phase 36 T1,REQ-75/D-01):临时真仓里跑 stage/commit 脚本本尊 ----
  // 断言共享主索引零踩踏、.commit.lock 持锁提交与孤儿锁回收、兄弟票先行提交不被交错回滚。
  {
    const STAGE = fileURLToPath(new URL("../../mm-gsd-exec/scripts/mm-gsd-stage.mjs", import.meta.url));
    const COMMIT = fileURLToPath(new URL("../../mm-gsd-exec/scripts/mm-gsd-commit.mjs", import.meta.url));
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-conc-"));
    mkdirSync(join(d, ".planning"), { recursive: true });
    const g = (args) => {
      try { return { code: 0, out: execFileSync("git", args, { cwd: d, encoding: "utf8", stdio: "pipe" }) }; }
      catch (e) { return { code: e.status ?? 1, out: String(e.stdout || "") + String(e.stderr || "") }; }
    };
    const runTool = (script, args) => {
      try { return { code: 0, out: execFileSync(process.execPath, [script, ...args], { cwd: d, encoding: "utf8", stdio: "pipe" }) }; }
      catch (e) { return { code: e.status ?? 1, out: String(e.stdout || "") + String(e.stderr || "") }; }
    };
    g(["init"]); g(["config", "user.name", "t"]); g(["config", "user.email", "t@t"]);
    writeFileSync(join(d, "base.txt"), "base\n");
    g(["add", "base.txt"]); g(["commit", "-q", "-m", "init"]);
    const mkPlan = (n, f) => writeFileSync(join(d, ".planning", `14-${n}-PLAN.md`), `---\nphase: "14"\nplan: "${n}"\nfiles_modified:\n  - ${f}\ndepends_on: []\n---\n\n### T1 事\n- **files**: ${f}\n`);
    mkPlan("01", "a.txt"); mkPlan("02", "b.txt");
    writeFileSync(join(d, "a.txt"), "a\n"); writeFileSync(join(d, "b.txt"), "b\n");
    const s1 = runTool(STAGE, ["--ticket", "14-01"]);
    const s2 = runTool(STAGE, ["--ticket", "14-02"]);
    eqN(s1.code === 0 && s2.code === 0 && g(["diff", "--cached", "--name-only"]).out.trim() === "", true, "stage 走票级隔离 GIT_INDEX_FILE:共享主索引零暂存(并发 add 不踩踏)");
    eqN(readdirSync(tmpdir()).filter((n) => n.startsWith("mm-gsd-stage-")).length, 0, "stage 临时索引 finally 清理,Temp 无残留");
    const c1 = runTool(COMMIT, ["--ticket", "14-01", "--message", "feat(14-01): a"]);
    eqN(c1.code === 0 && !existsSync(join(d, ".planning", ".commit.lock")) && g(["show", "--name-only", "--format=", "HEAD"]).out.includes("a.txt"), true, "commit 持 .commit.lock 正常 git commit:提交落地且锁 finally 清理");
    const c2 = runTool(COMMIT, ["--ticket", "14-02", "--message", "feat(14-02): b"]);
    const tree = g(["ls-tree", "-r", "--name-only", "HEAD"]).out;
    eqN(c2.code === 0 && tree.includes("a.txt") && tree.includes("b.txt"), true, "兄弟票先行提交后本票提交不回滚对方变更(持锁内以当时 HEAD 重建基线)");
    writeFileSync(join(d, "a.txt"), "a2\n");
    writeFileSync(join(d, ".planning", ".commit.lock"), "2147483000 " + (Date.now() - 60000) + "\n");
    const c3 = runTool(COMMIT, ["--ticket", "14-01", "--message", "feat(14-01): a2"]);
    eqN(c3.code === 0 && !existsSync(join(d, ".planning", ".commit.lock")), true, "孤儿锁(>30s 且 PID 已退出)自动回收后照常提交");
    rmSync(d, { recursive: true, force: true });
  }
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
    // worktree 局部 PLAN 集(#34):全局账的历史 REQ 不在本检出 → 只判 contextText 提及的
    const d4w = mkdtempSync(join(tmpdir(), "mm-gsd-wt-"));
    mkdirSync(join(d4w, ".planning"), { recursive: true });
    const REQWT = "- REQ-1: 本 phase 的\n- REQ-2: 别的 phase 的(认领 PLAN 在主检出)\n- REQ-3: 本 phase 漏认领的\n";
    const PLANWT = '---\nphase: "42"\n---\n\n- **covers**: REQ-1\n';
    writeFileSync(join(d4w, ".planning", "REQUIREMENTS.md"), REQWT);
    writeFileSync(join(d4w, ".planning", "42-01-PLAN.md"), PLANWT);
    writeFileSync(join(d4w, ".planning", "42-CONTEXT.md"), "本 phase 涉及 REQ-1 与 REQ-3(REQ-2 属别的检出)\n");
    const wtLegacy = checkReqCoverage({ root: d4w, plansDir: join(d4w, ".planning") });
    eqN(wtLegacy.some((p) => p.includes("REQ-2")), true, "wt-legacy 不传 contextText → 全局账照判(旧口径不变,REQ-2 无人认领判红)");
    const wtScoped = checkReqCoverage({ root: d4w, plansDir: join(d4w, ".planning"), contextText: "本 phase 涉及 REQ-1 与 REQ-3" });
    eqN(wtScoped.some((p) => p.includes("REQ-2")), false, "wt-1 传 contextText → 只判本 phase 上下文提及的 REQ(REQ-2 跳过)");
    eqN(wtScoped.some((p) => p.includes("REQ-3")), true, "wt-2 本 phase 真漏认领仍判红(作用域不放走真信号)");
    eqN(wtScoped.some((p) => p.includes("REQ-1")), false, "wt-3 已认领的 REQ 不误红");
    rmSync(d4w, { recursive: true, force: true });
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
