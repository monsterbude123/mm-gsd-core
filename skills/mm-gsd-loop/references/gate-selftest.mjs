// 门禁自测 —— 独立成文件,不塞进 gsd-state-check.mjs(自测是"门禁对自己的检查",不是"对项目的检查";混在一起行数很快顶破 700 上限)。跟 template-gates.mjs 一个套路:按需 import,主文件不胖。
// 为什么必须有:GitHub #6/#7/#8 三条都是"门禁看起来在跑、实际判错"(VAGUE_FILE 的 N\/A 无左右断言 /
// depends_on 只认半角括号 / derived 只判 SHIP 文件存在不读 status)—— 不是崩溃,是安静地给错答案。

import { validateVerification, checkTicketPremises, checkTicketLoad, checkReqClaims, checkReqCoverage, checkIssueLedger, checkDiscriminatingLints, checkZeroMatchErrors, checkBatchVerifyLints } from "./verification-gates.mjs";
import { checkDecisions, locateContexts, checkDrift, checkConclusionDrift } from "./decision-gates.mjs";
import { ticketsCovered } from "./ticket-alive.mjs";
import { mmGsdVersion, splitByVersion } from "./version.mjs";
import { runContractCases } from "./selftest-contracts.mjs";
import { runPlanGateCases } from "./selftest-plan-gates.mjs";
import { runAntiFalseGreenCases } from "./selftest-antifalsegreen.mjs";
import { mkAssert, runArtifactCases, runCoverageCases, runLedgerGateCases, runPhaseHealthCases, runRouteCases, runPlanReadyCases, runPlanCheckE2ECases, runBoundaryCases, runPremiseLocateCases, runWaveFromDagCases, runReviewGateCases, runConvergenceCases, runPackCases, runTelemetryViewCases, runCoreBoundaryCases, runRequirementMiningCases, runDecisionScopeCases, runWebTemplateGateCases, runUpdateGateCases } from "./selftest-suite.mjs";
import { researchRequired, researchCompliant, checkResearchConsumed, checkResearchSummary } from "./research-gates.mjs";
import { checkBatchGraph, checkTicketBudget, isFullSuite } from "./worktree-view.mjs";
import { buildRouteBrief, pointerCard, listSkills } from "./agent-routing.mjs";
import { extractTemplateBlock } from "./template-gates.mjs";
import { buildDebt } from "./debt-panel.mjs";
import { runToolStats } from "./telemetry-aggregate.mjs";
import { aggregateByDay } from "./telemetry-view.mjs";
import { mkdtempSync, writeFileSync, rmSync, utimesSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHECKER = fileURLToPath(new URL("../scripts/gsd-state-check.mjs", import.meta.url));

/** 跑一遍自测,返回失败条数 */
// 断言总数基线(phase 30 T3):与 --selfcheck 的总断言数一致;有意增删断言时人工 bump。
const SELFTEST_CASES_TOTAL = 436;

export function runSelfTest(VAGUE_FILE, DEP_RE, splitDeps) {
  const { eq, eqN, eqArr, st } = mkAssert();
  // 自测必须声明自己的沙箱身份(26-06 / D-11 / REQ-39):自测故意造的失败写进共享遥测文件,
  // 会让 observe 的诊断排行被自己的噪声淹没 —— 实测 1488 条门禁失败里 1303 条(87.6%)来自这里。
  // 声明式标记:由跑沙箱的一方声明,不猜路径(gsd-state-check.mjs:44-48 的既定语义)。
  const SELFTEST_TMP = mkdtempSync(join(tmpdir(), "mm-gsd-selftest-"));
  const SELFTEST_TELEMETRY = join(SELFTEST_TMP, "telemetry.jsonl");
  const ENV_BACKUP = { GSD_SANDBOX: process.env.GSD_SANDBOX, GSD_TELEMETRY: process.env.GSD_TELEMETRY, GSD_TELEMETRY_PATH: process.env.GSD_TELEMETRY_PATH };
  process.env.GSD_SANDBOX = "1";
  process.env.GSD_TELEMETRY_PATH = SELFTEST_TELEMETRY;
  // 第三个不可省:用户环境里若已 export GSD_TELEMETRY=0(本仓教用户这么设),
  // 子进程的 TELEMETRY 会是 false → 压根不写文件 → 下面「临时文件非空」恒红。
  process.env.GSD_TELEMETRY = "1";
  console.log("\n=== mm-gsd 门禁自测 ===");
  // N\/A 要左右断言:\b 挡不住 admin/auth —— n 是词字符、/ 不是,边界本就存在
  eq(VAGUE_FILE, "src/app/[locale]/admin/admin.css", false, "admin 路径不该被判模糊");
  eq(VAGUE_FILE, "messages/en/adminConsole.json", false, "adminConsole 不该被判模糊");
  eq(VAGUE_FILE, "config/N/A", true, "N/A 本身是模糊写法");
  eq(VAGUE_FILE, "docs/等等.md", true, "等等是模糊写法");
  eq(VAGUE_FILE, "src/app/相关.tsx", true, "相关是模糊写法");
  eq(VAGUE_FILE, "src/a/b/N/Ax.ts", false, "N/Ax 不是 N/A");
  // depends_on 的括号必须认全角:U+FF08/FF09 是中文 STATE.md 的实际写法
  eq(DEP_RE, "02 — 面板 (depends_on: 01)", true, "半角括号依赖");
  eq(DEP_RE, "02 — 面板 （depends_on: 01）", true, "全角括号依赖");
  eq(DEP_RE, "02 — 面板（depends_on：01, 03）", true, "全角括号 + 全角冒号 + 多依赖");
  eq(DEP_RE, "02 — 面板", false, "无依赖不该误匹配");
  // 「无」是"没有依赖",不是依赖了一个叫"无"的 phase —— #7 修完后连带暴露的
  eqArr(splitDeps("无"), [], "depends_on: 无 应解析为空依赖");
  eqArr(splitDeps("无依赖"), [], "depends_on: 无依赖 应解析为空依赖");
  eqArr(splitDeps("none"), [], "depends_on: none 应解析为空依赖");
  eqArr(splitDeps("01, 03"), ["01", "03"], "多依赖应拆分");
  // 验收结论一致性闸:一条证明会红,一条证明不误伤。小节标题逐字抄自 templates/verification.md(含括号后缀):第一版写的是裸标题,自测永远绿而真实报告永远不触发。
  const HUMAN_H = "## Human Verification Required(机器验不了,恒发不省略)";
  const vt = (status, rows, human, extra = "") => {
    const v = rows.filter((r) => r.startsWith("✓")).length;
    const doc = `---\nstatus: ${status}\nscore: ${v}/${rows.length}\n---\n\n## Observable Truths\n\n| # | Truth | 状态 | 证据 |\n|---|---|---|---|\n`
      + rows.map((r, i) => `| T${i + 1} | 导出 CSV | ${r} | 证据 ${i + 1} |`).join("\n")
      + `\n${extra}\n${HUMAN_H}\n\n${human}\n`;
    return validateVerification(doc, status).filter((i) => i.level !== "warn").length;
  };
  eqN(vt("passed", ["✓ VERIFIED", "✗ FAILED"], "None"), 1, "正文有 FAILED 却写 passed 应判红");
  eqN(vt("passed", ["✓ VERIFIED", "✓ VERIFIED"], "None"), 0, "全 VERIFIED + 无人工项不应误伤");
  // 下面四条用「闸作者模板之外」的输入(2026-10-20 教训):第一版 fixture 照模板写,模板与闸互不兼容永远暴露不出来。
  // 共享输入显式传递(断言工具与被测解析器/正则/夹具 —— 拆出模块不自建、不重读)
  const t = { eq, eqN, eqArr };
  const x = { CHECKER, vt };
  { // phase 30 T2:本段搬入 runContractCases(见 runContractCases 所在模块);顺序保持,总数不变
    runContractCases(t, x);
  }
  { // phase 30 T2:本段搬入 runPlanGateCases(见 runPlanGateCases 所在模块);顺序保持,总数不变
    runPlanGateCases(t, x);
  }
  { // phase 30 T2:本段搬入 runAntiFalseGreenCases(见 runAntiFalseGreenCases 所在模块);顺序保持,总数不变
    runAntiFalseGreenCases(t, x);
  }
  // ---- cwd 契约(phase 14 D-01,#16):命令量错树判红;缺字段提示;一致/子目录/$VAR 不误伤 ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-cwd-"));
    mkdirSync(join(d, ".planning"), { recursive: true });
    writeFileSync(join(d, "a.mjs"), "x\n");
    const p = join(d, ".planning", "14-01-PLAN.md");
    const mk = (fmExtra, tickets) => '---\nphase: "14"\nplan: "01"\ngoal: g\nrollback: r\nfiles_modified:\n  - a.mjs\ndepends_on: []\n' + fmExtra + '---\n\n'
      + tickets.map((v, i) => '### T' + (i + 1) + ' 事\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 做\n- **verify**: ' + v + '\n- **fails_when**: 退出码非 0(无 ok)\n- **done**: ok\n').join("\n");
    const run = () => { let out = "", code = 0;
      try { out = execFileSync(process.execPath, [CHECKER, "--plan", p], { cwd: d, encoding: "utf8", stdio: "pipe" }); }
      catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
      return { out, code }; };
    writeFileSync(p, mk("cwd: .worktrees/p33\n", ["cd /workspace/app && node a.mjs"]));
    let r = run();
    eqN(r.code === 1 && r.out.includes("命令量错树"), true, "cwd 不一致判红(命令量错树)");
    writeFileSync(p, mk("", ["cd /workspace/app && node a.mjs"]));
    r = run();
    eqN(r.code === 0 && r.out.includes("cwd 缺省"), true, "cwd 缺省有 cd → 提示补字段");
    writeFileSync(p, mk("cwd: .worktrees/p33\n", ["cd .worktrees/p33/ && node a.mjs", "cd .worktrees/p33/sub && node a.mjs", "cd $TREE && node a.mjs"]));
    r = run();
    eqN(r.code === 0 && !r.out.includes("命令量错树"), true, "cwd 一致/前缀子目录/$VAR 不误伤");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- 红窗兑现票(phase 14 D-02,#18):red_windows 条目缺 ticket 判红;补票转绿 ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-redw-"));
    mkdirSync(join(d, ".planning"), { recursive: true });
    writeFileSync(join(d, "a.mjs"), "x\n");
    const p = join(d, ".planning", "14-01-PLAN.md");
    const fm = '---\nphase: "14"\nplan: "01"\ngoal: g\nrollback: r\nfiles_modified:\n  - a.mjs\ndepends_on: []\nbatch_verify: node --test a.mjs\nred_windows:\n  - guards/a.guard.mjs | wave 2 | ticket 14-01 | close: 本票 verify 转绿\n  - guards/b.guard.mjs | wave 3 | close: 没写兑现票\n---\n\n';
    const body = '### T1 事\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 做\n- **verify**: node a.mjs\n- **fails_when**: 退出码非 0(无 ok)\n- **done**: ok\n';
    const run = () => { let out = "", code = 0;
      try { out = execFileSync(process.execPath, [CHECKER, "--plan", p], { cwd: d, encoding: "utf8", stdio: "pipe" }); }
      catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
      return { out, code }; };
    writeFileSync(p, fm + body);
    let r = run();
    eqN(r.code === 1 && r.out.includes("红窗缺兑现票"), true, "红窗缺兑现票 → 判红(防永久豁免)");
    writeFileSync(p, fm.replace("| wave 3 | close: 没写兑现票", "| wave 3 | ticket 14-01 | close: 补上兑现票") + body);
    r = run();
    eqN(r.code === 0, true, "红窗补上兑现票 → 转绿");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- 批闸形状 lint(phase 14 D-03,#17):裸无界目录报 WARNING;有界形状不误报 ----
  eqN(checkBatchVerifyLints("npm test -- tests/").length, 1, "lint 命中无界批闸目录(报 WARNING)");
  eqN(checkBatchVerifyLints("npm test -- src").length, 1, "lint 命中无界批闸目录(报 WARNING)—— 无尾斜杠裸目录也算(预审 I7)");
  eqN(checkBatchVerifyLints("vitest run ./tests").length, 1, "lint 命中无界批闸目录(报 WARNING)—— ./ 前缀归一后判(预审 I7)");
  eqN(checkBatchVerifyLints("node --test a.mjs && npm test -- tests").length, 1, "lint 命中无界批闸目录(报 WARNING)—— 多命令段各自判");
  eqN(checkBatchVerifyLints("npm test -- tests/unit/x.test.mjs").length, 0, "有界批闸不误报(具名文件)");
  eqN(checkBatchVerifyLints("npm test -- tests/unit/").length, 0, "有界批闸不误报(子目录树,深度 ≥2)");
  eqN(checkBatchVerifyLints("vite build --out build/").length, 0, "有界批闸不误报(flag 值形态不判,预审 I7)");
  eqN(checkBatchVerifyLints("npm run build").length, 0, "有界批闸不误报(裸脚本词不是目录参数)");
  eqN(checkBatchVerifyLints("cd /tmp && npm test -- tests").length, 1, "cd 目标豁免不外溢:-- 后的无界目录照判");
  eqN(checkBatchVerifyLints("").length, 0, "空 batch_verify 不报");
  // ---- update 机械覆盖(用户指令:更新零判断) ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-upd-"));
    mkdirSync(join(d, ".zcode", "agents"), { recursive: true });
    mkdirSync(join(d, ".agents", "skills", "mm-gsd-plan"), { recursive: true });
    writeFileSync(join(d, ".agents", "skills", "mm-gsd-plan", "OLD.txt"), "stale");
    writeFileSync(join(d, ".zcode", "agents", "mm-gsd-plan.md"), "user content");
    const BIN = fileURLToPath(new URL("../../../bin/mm-gsd.mjs", import.meta.url));
    let code = 0;
    try { execFileSync(process.execPath, [BIN, "update", "--home", d], { stdio: "pipe" }); }
    catch (e) { code = e.status ?? 1; }
    eqN(code, 0, "update 退出码 0(零提问)");
    eqN(existsSync(join(d, ".agents", "skills", "mm-gsd-plan", "SKILL.md")) && !existsSync(join(d, ".agents", "skills", "mm-gsd-plan", "OLD.txt")), true, "update 机械覆盖:技能整删重拷,旧文件不残留");
    eqN(readFileSync(join(d, ".zcode", "agents", "mm-gsd-plan.md"), "utf8").includes("别在本卡里找规则"), true, "update 宿主卡无条件刷新(不接管判断)");
    eqN(existsSync(join(d, ".zcode", "agents", "mm-gsd-plan-reviewer.md")) && existsSync(join(d, ".agents", "skills", ".mm-gsd-install.json")), true, "update 复核卡与版本清单齐");
    let code2 = 0;
    try { execFileSync(process.execPath, [BIN, "update", "--home", d], { stdio: "pipe" }); }
    catch (e) { code2 = e.status ?? 1; }
    eqN(code2, 0, "update 幂等(二次执行仍 0)");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- stage 工具(phase 14 D-04,#19):literal pathspec 与不存在路径跳过,都要真仓用例 —— 使用方的 CRLF+[locale] bug 毁过提交 ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-stage-"));
    const sh = (args) => { const r = spawnSync("git", args, { cwd: d, encoding: "utf8" }); if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr); return r.stdout; };
    sh(["init", "-q"]); sh(["config", "user.name", "t"]); sh(["config", "user.email", "t@t"]);
    mkdirSync(join(d, "src", "app", "[locale]"), { recursive: true });
    writeFileSync(join(d, "src", "app", "[locale]", "a.css"), "x\n");
    mkdirSync(join(d, ".planning"), { recursive: true });
    // files_modified 用 CRLF 行尾(使用方踩的坑)且含 [locale] 形状路径;docs/not-yet.md 不存在也不在索引
    writeFileSync(join(d, ".planning", "14-01-PLAN.md"), '---\r\nphase: "14"\r\nplan: "01"\r\nfiles_modified:\r\n  - src/app/[locale]/a.css\r\n  - docs/not-yet.md\r\n---\r\n\r\n### T1 事\r\n- **files**: src/app/[locale]/a.css\r\n- **read_first**: src/app/[locale]/a.css\r\n- **action**: 做\r\n- **verify**: node a.mjs\r\n- **fails_when**: 退出码非 0\r\n- **done**: ok\r\n');
    const STAGE = fileURLToPath(new URL("../../mm-gsd-exec/scripts/mm-gsd-stage.mjs", import.meta.url));
    const runTool = (script, args) => { const r = spawnSync(process.execPath, [script, ...args], { cwd: d, encoding: "utf8" }); return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") }; };
    const r1 = runTool(STAGE, ["--ticket", "14-01"]);
    eqN(r1.code === 0 && sh(["status", "--porcelain"]).includes("A  src/app/[locale]/a.css"), true, "stage 按票面 literal 暂存");
    eqN(r1.code === 0 && r1.out.includes("跳过"), true, "stage 对不存在路径跳过不报错");
    // ---- summary 工具(phase 14 D-04/D-05,#19):scope 精确 / 前缀兜底 WARN / 拒绝覆盖,同一真仓 fixture ----
    const commit = (m) => sh(["commit", "--allow-empty", "-q", "-m", m]);
    commit("feat(14-02): stage 工具");
    commit("fix(14-02): bin 转发");
    commit("chore: 提到 14-02 但没写 scope");   // 精确匹配不得把它算进去(--grep 子串就栽在这)
    commit("14-03 草稿:还没补 scope");          // 前缀兜底用例的靶子
    const SUMMARY = fileURLToPath(new URL("../../mm-gsd-exec/scripts/mm-gsd-summary.mjs", import.meta.url));
    let r2 = runTool(SUMMARY, ["--ticket", "14-02"]);
    eqN(r2.code === 0 && readFileSync(join(d, ".planning", "14-02-SUMMARY.md"), "utf8").includes("commits: 2") && !r2.out.includes("WARN"), true, "summary 按 scope 精确实测 commits");
    r2 = runTool(SUMMARY, ["--ticket", "14-03"]);
    eqN(r2.code === 0 && readFileSync(join(d, ".planning", "14-03-SUMMARY.md"), "utf8").includes("commits: 1") && r2.out.includes("WARN"), true, "summary 零命中按前缀兜底并 WARN");
    r2 = runTool(SUMMARY, ["--ticket", "14-02"]);
    eqN(r2.code === 1 && r2.out.includes("拒绝覆盖"), true, "summary 拒绝覆盖已存在");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- commit 工具(phase 14 D-02,#18):受限放行 —— 真仓 + core.hooksPath 必败钩子:清单内 FAST_PATH --no-verify 重试;清单外/提取空集 exit 2 停下 ----
  {
    const COMMIT = fileURLToPath(new URL("../../mm-gsd-exec/scripts/mm-gsd-commit.mjs", import.meta.url));
    const mkRepo = (hookBody, rwEntry) => {
      const d = mkdtempSync(join(tmpdir(), "mm-gsd-cmt-"));
      const sh = (args) => { const r = spawnSync("git", args, { cwd: d, encoding: "utf8" }); if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr); return r.stdout; };
      sh(["init", "-q"]); sh(["config", "user.name", "t"]); sh(["config", "user.email", "t@t"]);
      let hooksPath = null;
      if (hookBody !== null) {
        hooksPath = join(d, "hooks"); mkdirSync(hooksPath, { recursive: true });
        writeFileSync(join(hooksPath, "pre-commit"), "#!/bin/sh\n" + hookBody + "\nexit 1\n");
      }
      mkdirSync(join(d, ".planning"), { recursive: true });
      writeFileSync(join(d, "a.mjs"), "x\n");
      writeFileSync(join(d, ".planning", "14-01-PLAN.md"), '---\nphase: "14"\nplan: "01"\nfiles_modified:\n  - a.mjs\ndepends_on: []\n' + rwEntry + '---\n\n### T1 事\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 做\n- **verify**: node a.mjs\n- **fails_when**: 退出码非 0\n- **done**: ok\n');
      sh(["commit", "--allow-empty", "-q", "-m", "init"]);   // 先落 init:hooksPath 还没配,必败钩子不拦空提交
      if (hooksPath) sh(["config", "core.hooksPath", hooksPath]);
      const run = () => { const r = spawnSync(process.execPath, [COMMIT, "--ticket", "14-01", "--message", "feat(14-01): c1"], { cwd: d, encoding: "utf8" }); return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") }; };
      return { d, sh, run, clean: () => rmSync(d, { recursive: true, force: true }) };
    };
    const A = mkRepo(`echo "guard 'no-force-push'" >&2`, "red_windows:\n  - no-force-push | wave 2 | ticket 14-01 | close: 守卫修复票\n");
    let r = A.run();
    eqN(r.code === 0 && r.out.includes("FAST_PATH:失败项全部落在已登记红窗清单") && A.sh(["rev-list", "--count", "HEAD"]).trim() === "2", true, "commit 清单内失败走快路径(--no-verify 重试)");
    A.clean();
    const B = mkRepo(`echo "guard 'no-force-push'" >&2`, "red_windows:\n  - other-guard | wave 2 | ticket 14-01 | close: 别的守卫\n");
    r = B.run();
    eqN(r.code === 2 && r.out.includes("清单外") && B.sh(["rev-list", "--count", "HEAD"]).trim() === "1", true, "commit 清单外失败 exit 2 停下(真缺陷,不提交)");
    B.clean();
    const C = mkRepo("echo boom >&2", "");
    r = C.run();
    eqN(r.code === 2 && r.out.includes("UNPARSEABLE_FAILURE"), true, "commit 提取空集 UNPARSEABLE_FAILURE exit 2 停下(空集 ⊆ 清单恒真,绝不当全部命中)");
    C.clean();
    const D = mkRepo(null, "");
    r = D.run();
    eqN(r.code === 0 && !r.out.includes("FAST_PATH") && D.sh(["rev-list", "--count", "HEAD"]).trim() === "2", true, "commit 正常提交优先(无守卫拦截时不走 --no-verify)");
    D.clean();
  }
  // ---- wave-check 工具(phase 14 D-03/D-04,#17):生成脚本以 cd 头;--baseline 差分摘要(只呈现,不归因) ----
  {
    const WAVE = fileURLToPath(new URL("../../mm-gsd-exec/scripts/mm-gsd-wave-check.mjs", import.meta.url));
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-wv-"));
    mkdirSync(join(d, ".planning"), { recursive: true });
    const fm = (plan, cwd, bv) => '---\nphase: "14"\nplan: "' + plan + '"\nwave: 2\n' + (cwd ? "cwd: " + cwd + "\n" : "") + 'depends_on: []\nbatch_verify: ' + bv + '\n---\n\n### T1 事\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 做\n- **verify**: node a.mjs\n- **fails_when**: 退出码非 0\n- **done**: ok\n';
    const run = (args) => { const r = spawnSync(process.execPath, [WAVE, ...args], { cwd: d, encoding: "utf8" }); return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") }; };
    writeFileSync(join(d, ".planning", "14-01-PLAN.md"), fm("01", ".worktrees/w2", "echo hi"));
    let r = run(["--phase", "14", "--wave", "2", "--dry"]);
    eqN(r.code === 0 && r.out.startsWith("cd '.worktrees/w2'"), true, "wave-check 生成脚本以 cwd 开头");
    writeFileSync(join(d, ".planning", "14-01-PLAN.md"), fm("01", "", "node w.mjs"));
    writeFileSync(join(d, ".planning", "14-02-PLAN.md"), fm("02", "", "node ok.mjs"));
    writeFileSync(join(d, "w.mjs"), "process.exit(1);\n");
    writeFileSync(join(d, "ok.mjs"), "process.exit(0);\n");
    const base = mkdtempSync(join(tmpdir(), "mm-gsd-wvb-"));
    writeFileSync(join(base, "w.mjs"), "process.exit(0);\n");
    writeFileSync(join(base, "ok.mjs"), "process.exit(0);\n");
    r = run(["--phase", "14", "--wave", "2", "--baseline", base]);
    eqN(r.code === 1 && r.out.includes("差分摘要") && r.out.includes("本批独有红") && r.out.includes("14-01") && r.out.includes("基线独有红"), true, "wave-check --baseline 出差分摘要");
    rmSync(d, { recursive: true, force: true }); rmSync(base, { recursive: true, force: true });
  }
  // ---- wave-check 健壮性(phase 15 D-01):单引号路径转义 + 多行 batch_verify,读取/门禁/执行三处视图一致 ----
  {
    const WAVE = fileURLToPath(new URL("../../mm-gsd-exec/scripts/mm-gsd-wave-check.mjs", import.meta.url));
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-wv15-"));
    mkdirSync(join(d, ".planning"), { recursive: true });
    mkdirSync(join(d, ".worktrees", "it's q"), { recursive: true });   // 含单引号与空格的 cwd(中文项目名/Windows 常见)
    const fm = (cwd, bv) => '---\nphase: "15"\nplan: "01"\nwave: 3\n' + (cwd ? "cwd: " + cwd + "\n" : "") + 'depends_on: []\n' + bv + '\n---\n\n### T1 事\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 做\n- **verify**: node a.mjs\n- **fails_when**: 退出码非 0\n- **done**: ok\n';
    const run = (args) => { const r = spawnSync(process.execPath, [WAVE, ...args], { cwd: d, encoding: "utf8" }); return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") }; };
    // 用例 1:含单引号路径的 cwd 生成合法脚本(POSIX 转义 ' → '\'')
    writeFileSync(join(d, ".planning", "15-01-PLAN.md"), fm(".worktrees/it's q", "batch_verify: echo hi"));
    let r = run(["--phase", "15", "--wave", "3", "--dry"]);
    const shFile = join(d, "gen.sh");
    writeFileSync(shFile, r.out);
    let bn = spawnSync("bash", ["-n", shFile.split("\\").join("/")], { encoding: "utf8" });
    eqN(r.out.startsWith(`cd '.worktrees/it'\\''s q'`) && bn.status === 0, true, "含单引号路径的 cwd 生成合法脚本(转义 + bash -n 过)");
    // 用例 2:多行 batch_verify 逐行落脚本,空行跳过(不终止收集)
    writeFileSync(join(d, ".planning", "15-01-PLAN.md"), fm("", "batch_verify: echo one\n\n  echo two"));
    r = run(["--phase", "15", "--wave", "3", "--dry"]);
    eqN(r.out.includes('# ==== 15-01 ====\necho one\necho two\necho "WAVECHECK 15-01 exit=$?"'), true, "多行 batch_verify 逐行落脚本(空行跳过,两行紧邻各占一行)");
    rmSync(d, { recursive: true, force: true });
    // 用例 3:多行 batch_verify 在 --plan 下逐行过 lint 与 cd 扫描(不漏行 —— 门禁只见第一行就是错误级盲区,预审 F3)
    const d2 = mkdtempSync(join(tmpdir(), "mm-gsd-wv15p-"));
    mkdirSync(join(d2, ".planning"), { recursive: true });
    writeFileSync(join(d2, "a.mjs"), "x\n");
    const p2 = join(d2, ".planning", "14-01-PLAN.md");
    writeFileSync(p2, '---\nphase: "14"\nplan: "01"\ngoal: g\nrollback: r\ncwd: .worktrees/p33\nfiles_modified:\n  - a.mjs\ndepends_on: []\nbatch_verify: cd .worktrees/p33 && node a.mjs\n  cd /elsewhere && node a.mjs\n  npm test -- tests\n---\n\n### T1 事\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 做\n- **verify**: node a.mjs\n- **fails_when**: 退出码非 0(无 ok)\n- **done**: ok\n');
    let out2 = "";
    try { out2 = execFileSync(process.execPath, [CHECKER, "--plan", p2], { cwd: d2, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { out2 = String(e.stdout || "") + String(e.stderr || ""); }
    eqN(out2.includes("命令量错树") && out2.includes("无界目录"), true, "多行 batch_verify 在 --plan 下逐行过 lint 与 cd 扫描(不漏行:第 2 行 cd 错树判红,第 3 行无界目录报 WARNING)");
    rmSync(d2, { recursive: true, force: true });
  }
  // ---- 提交 scope 警告上门禁(phase 15 D-02):fixture 真仓(照 runLedgerGateCases 的 git init 先例),黄不拦红 ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-scope-"));
    const sh = (args) => { const r = spawnSync("git", args, { cwd: d, encoding: "utf8" }); if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr); return r.stdout; };
    sh(["init", "-q"]); sh(["config", "user.name", "t"]); sh(["config", "user.email", "t@t"]);
    mkdirSync(join(d, ".planning"), { recursive: true });
    writeFileSync(join(d, ".planning", "STATE.md"), '---\nstatus: discussing\nactive_phase: "14"\n---\n');
    writeFileSync(join(d, ".planning", "14-01-PLAN.md"), '---\nphase: "14"\nplan: "01"\n---\n');
    writeFileSync(join(d, ".planning", "14-01-PLAN-CHECK.md"), '---\nstatus: passed\n---\n');
    const run = () => {
      const r = spawnSync(process.execPath, [CHECKER, "--json"], { cwd: d, encoding: "utf8" });
      const out = String(r.stdout || "") + String(r.stderr || "");
      let j = null;
      try { j = JSON.parse(out.slice(out.indexOf("{"))); } catch {}
      return { code: r.status, out, j };
    };
    // scope 缺失 → 黄(不拦红):commits=2 全部无 (14-01): scope
    sh(["commit", "--allow-empty", "-q", "-m", "chore: 提到 14-01 但没写 scope"]);
    sh(["commit", "--allow-empty", "-q", "-m", "chore: another unscoped"]);
    writeFileSync(join(d, ".planning", "14-01-SUMMARY.md"), '---\nphase: "14"\nplan: "01"\nstatus: complete\ncommits: 2\n---\n');
    let r = run();
    eqN(r.code, 0, "scope 缺失 → 黄(不拦红):退出码 0");
    eqN((r.j?.errors.length ?? 1) === 0 && (r.j?.warnings.some((w) => w.message.includes("但提交主题无")) ?? false), true, "scope 缺失 → 黄(不拦红):errors 空、scope 警告进 warnings");
    // scope 齐全 → 无警告:两笔提交都带 (14-01): scope,scoped === commits
    sh(["commit", "--allow-empty", "-q", "-m", "feat(14-01): c1"]);
    sh(["commit", "--allow-empty", "-q", "-m", "fix(14-01): c2"]);
    writeFileSync(join(d, ".planning", "14-01-SUMMARY.md"), '---\nphase: "14"\nplan: "01"\nstatus: complete\ncommits: 2\n---\n');
    r = run();
    eqN(r.code === 0 && (r.j?.errors.length ?? 1) === 0 && (r.j?.warnings.length ?? 1) === 0, true, "scope 齐全 → 无警告(scoped 与 commits 同口径命中)");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- 票外实碰对账只认本批次的提交(phase 22 修):提交块按 %x1e 切,不靠主题行首 "(" ----
  // 旧写法按行首 "(" 切块 → 主题开头没有 "(" 时整段 git log 变成一块,后面每一笔提交的文件
  // 全算到最新那笔头上 → 别的批次的文件被报成"票外实碰"(实测把 22-01 的 8 个文件算到 22-02 头上)。
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-scope2-"));
    const sh = (args) => { const r = spawnSync("git", args, { cwd: d, encoding: "utf8" }); if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr); return r.stdout; };
    sh(["init", "-q"]); sh(["config", "user.name", "t"]); sh(["config", "user.email", "t@t"]);
    mkdirSync(join(d, ".planning"), { recursive: true });
    writeFileSync(join(d, "a.mjs"), "export const a = 1;\n");
    sh(["add", "-A"]); sh(["commit", "-q", "-m", "feat(99-01): 另一批"]);
    writeFileSync(join(d, "b.md"), "b\n");
    sh(["add", "-A"]); sh(["commit", "-q", "-m", "docs(99-02): 本批"]);
    writeFileSync(join(d, ".planning", "STATE.md"), '---\nstatus: discussing\nactive_phase: "99"\n---\n');
    writeFileSync(join(d, ".planning", "99-02-PLAN.md"), '---\nphase: "99"\nplan: "02"\ngoal: g\nrollback: r\nfiles_modified:\n  - b.md\n---\n');
    writeFileSync(join(d, ".planning", "99-02-PLAN-CHECK.md"), '---\nstatus: passed\n---\n');
    writeFileSync(join(d, ".planning", "99-02-SUMMARY.md"), '---\nphase: "99"\nplan: "02"\nstatus: complete\ncommits: 1\n---\n\n## One-liner\n\nx\n\n## Self-Check: PASSED\n');
    const r = spawnSync(process.execPath, [CHECKER, "--json"], { cwd: d, encoding: "utf8" });
    const out = String(r.stdout || "") + String(r.stderr || "");
    let j = null;
    try { j = JSON.parse(out.slice(out.indexOf("{"))); } catch {}
    const stray = (j?.warnings ?? []).filter((w) => w.message.includes("票外实碰文件"));
    eqN(stray.length, 0, "票外实碰对账只算本批次的提交(别的批次文件不算账)");
    eqN(out.includes("a.mjs"), false, "票外实碰对账不把别的批次的文件算进来");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- summary notes schema(phase 15 D-03):未知字段/类型错一次列全并拒绝;合法填进模板字面节 ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-notes-"));
    const sh = (args) => { const r = spawnSync("git", args, { cwd: d, encoding: "utf8" }); if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr); return r.stdout; };
    sh(["init", "-q"]); sh(["config", "user.name", "t"]); sh(["config", "user.email", "t@t"]);
    mkdirSync(join(d, ".planning"), { recursive: true });
    sh(["commit", "--allow-empty", "-q", "-m", "feat(15-03): c1"]);
    const SUMMARY = fileURLToPath(new URL("../../mm-gsd-exec/scripts/mm-gsd-summary.mjs", import.meta.url));
    const run = (args) => { const r = spawnSync(process.execPath, [SUMMARY, ...args], { cwd: d, encoding: "utf8" }); return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") }; };
    const put = (obj) => writeFileSync(join(d, "notes.json"), JSON.stringify(obj));
    const gen = join(d, ".planning", "15-03-SUMMARY.md");
    // 未知字段拒绝:违规列出,草稿不落盘
    put({ one_liner: "x", bogus: "y" });
    let r = run(["--ticket", "15-03", "--notes", "notes.json"]);
    eqN(r.code === 1 && r.out.includes("bogus") && !existsSync(gen), true, "notes 未知字段拒绝(违规指名、草稿不落盘)");
    // 类型错拒绝:两处违规一次列全(字符串字段给了非 string;数组元素非字符串)
    put({ accomplishments: "not-array", deferred: [1, "ok"] });
    r = run(["--ticket", "15-03", "--notes", "notes.json"]);
    eqN(r.code === 1 && r.out.includes("accomplishments") && r.out.includes('"deferred"[0] 非字符串') && !existsSync(gen), true, "notes 类型错拒绝(全部违规一次列出)");
    // 合法:six 字段填进对应节,节标题与 templates/summary.md 字面一致
    put({ one_liner: "JWT 认证含刷新轮换,用 jose 库", accomplishments: ["登录态可保持"], deviations: ["[R1 - bug] 修了 X"], threats: ["新增 /admin 端点"], stubs: ["src/a.ts:42 — 占位"], deferred: ["LF 归一"] });
    r = run(["--ticket", "15-03", "--notes", "notes.json"]);
    const t = () => readFileSync(gen, "utf8");
    eqN(r.code === 0
      && t().includes("## One-liner\nJWT 认证含刷新轮换,用 jose 库")
      && t().includes("## Accomplishments\n- 登录态可保持")
      && t().includes("## Deviations from Plan\n- [R1 - bug] 修了 X")
      && t().includes("## Known Stubs\n- src/a.ts:42 — 占位")
      && t().includes("## Deferred Issues\n- LF 归一")
      && t().includes("## Threat Flags\n- 新增 /admin 端点"), true, "notes 合法填进对应节(六字段与模板节字面一一对应,缺节按模板补建)");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- 工具日志聚合(REQ-18,20-01 T2):grep 计数与派发分布必须真的出得来(具名用例) ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-tstat-"));
    const p = join(d, "tools.jsonl");
    const row = (ts, cwd, tool, brief, extra = {}) => JSON.stringify({ ts, cwd, tool, brief, ...extra });
    writeFileSync(p, [
      row("2026-11-12T00:00:00.000Z", "P1", "Bash", "grep -rn foo src"),
      row("2026-11-12T00:01:00.000Z", "P1", "Grep", "foo"),
      row("2026-11-12T00:02:00.000Z", "P1", "Task", "施工", { subagent_type: "mm-gsd-exec", prompt_head: "照 PLAN" }),
      row("2026-11-12T00:32:00.000Z", "P1", "Task", "验收", { subagent_type: "mm-gsd-verify", prompt_head: "推翻" }),
      row("2026-11-12T01:00:00.000Z", "P1", "Bash", "cat f | rg bar"),
    ].join("\n") + "\n");
    let out = "";
    runToolStats({ path: p, log: (s) => (out += s + "\n") });
    eqN(/grep 3 次/.test(out), true, "工具日志聚合出 grep 计数(Grep 行 + Bash 含 grep/rg,rg 也计)");
    eqN(out.includes("mm-gsd-exec×1") && out.includes("mm-gsd-verify×1"), true, "工具日志聚合出派发角色分布(subagent_type)");
    eqN(out.includes("派发 2 次") && out.includes("近似时长"), true, "派发计数与近似时长口径在场");
    eqN(out.includes("进行中"), true, "末次派发标「进行中」(预审 F2:无 PostToolUse/UserPromptSubmit 终止符)");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- 点修闭环(phase 21,REQ-20/21):批注黄提醒 / reopened 推导 / R 票门禁兼容 / R≥3 升级(具名用例) ----
  {
    const runCk = (d, args) => { let out = "", code = 0;
      try { out = execFileSync(process.execPath, [CHECKER, ...args], { cwd: d, encoding: "utf8", stdio: "pipe" }); }
      catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
      return { out, code }; };
    // ① open 批注 → checker 黄提醒;全 digested → 静默(默认模式端到端,D-04 后半)
    const dA = mkdtempSync(join(tmpdir(), "mm-gsd-ann-"));
    mkdirSync(join(dA, ".planning"), { recursive: true });
    writeFileSync(join(dA, ".planning", "STATE.md"), '---\nstatus: discussing\nactive_phase: "01"\n---\n');
    writeFileSync(join(dA, ".planning", "annotations.json"), JSON.stringify([{ id: "a1", ts: "t", target: "REQ:REQ-1", type: "备注", text: "x", status: "open" }]));
    let rA = runCk(dA, []);
    eqN(rA.out.includes("待消化") && rA.out.includes("1 条"), true, "open 批注 → checker 黄提醒");
    writeFileSync(join(dA, ".planning", "annotations.json"), JSON.stringify([{ id: "a1", ts: "t", target: "REQ:REQ-1", type: "备注", text: "x", status: "digested" }]));
    rA = runCk(dA, []);
    eqN(rA.out.includes("待消化"), false, "全 digested → 不提醒");
    rmSync(dA, { recursive: true, force: true });

    // ②③ reopened 推导(D-09):已 shipped 的 phase 开 R 票 → reopened;收口 + 重验 passed → 回 shipped
    // 已 shipped fixture 四件套照契约造(缺任何一项推导就走不到 shipped,用例会自己暴露)
    const mkShipped = (d) => {
      mkdirSync(join(d, ".planning"), { recursive: true });
      writeFileSync(join(d, ".planning", "STATE.md"), '---\nstatus: shipped\nactive_phase: "01"\n---\n');
      writeFileSync(join(d, ".planning", "01-CONTEXT.md"), "<domain>做安全登录</domain>\n<decisions>无</decisions>\n<specifics>无</specifics>\n<deferred>无</deferred>\n");
      writeFileSync(join(d, ".planning", "01-01-PLAN.md"), '---\nphase: "01"\nplan: "01"\n---\n');
      writeFileSync(join(d, ".planning", "01-01-PLAN-CHECK.md"), '---\nstatus: passed\nplan: "01-01"\nblockers: 0\nwarnings: 0\n---\n');
      writeFileSync(join(d, ".planning", "01-01-SUMMARY.md"), '---\nphase: "01"\nplan: "01"\nstatus: complete\ncommits: 2\n---\n');
      writeFileSync(join(d, ".planning", "01-VERIFICATION.md"), '---\nstatus: passed\nscore: 1/1\n---\n\n## Observable Truths\n\n| # | Truth | 状态 | 证据 |\n|---|---|---|---|\n| T1 | 登录安全 | ✓ VERIFIED | t:1 |\n\n## Human Verification Required(机器验不了,恒发不省略)\n\nNone —— 全部由程序验证\n');
      writeFileSync(join(d, ".planning", "01-SHIP.md"), '---\nstatus: shipped\ndelivered: PR #128\ndocs_synced: yes\n---\n');
    };
    const runJson = (d) => { let out = "";
      try { out = execFileSync(process.execPath, [CHECKER, "--json"], { cwd: d, encoding: "utf8", stdio: "pipe" }); }
      catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); }
      return JSON.parse(out.slice(out.indexOf("{"))); };
    const dB = mkdtempSync(join(tmpdir(), "mm-gsd-rrep-"));
    mkShipped(dB);
    writeFileSync(join(dB, ".planning", "01-R1-PLAN.md"), '---\nphase: "01"\nplan: "R1"\n---\n');
    eqN(runJson(dB).derived, "reopened", "R 票未收口 → derived reopened");
    rmSync(dB, { recursive: true, force: true });
    const dC = mkdtempSync(join(tmpdir(), "mm-gsd-rdone-"));
    mkShipped(dC);
    writeFileSync(join(dC, ".planning", "01-R1-PLAN.md"), '---\nphase: "01"\nplan: "R1"\n---\n');
    writeFileSync(join(dC, ".planning", "01-R1-PLAN-CHECK.md"), '---\nstatus: passed\nplan: "01-R1"\nblockers: 0\nwarnings: 0\n---\n');
    writeFileSync(join(dC, ".planning", "01-R1-SUMMARY.md"), '---\nphase: "01"\nplan: "R1"\nstatus: complete\ncommits: 1\n---\n');
    const vt = readFileSync(join(dC, ".planning", "01-VERIFICATION.md"), "utf8");
    writeFileSync(join(dC, ".planning", "01-VERIFICATION.md"), vt.replace("## Human", "## 重验记录\n\n- R1: passed — 重验 登录安全\n\n## Human"));
    eqN(runJson(dC).derived, "shipped", "R 票收口且重验 passed → 回 shipped");
    rmSync(dC, { recursive: true, force: true });

    // ④⑤⑥ --plan 门的 R 票兼容(D-06/D-08)
    const rPlan = (k) => '---\nphase: "01"\nplan: "' + k + '"\ngoal: 重验登录安全这条 truth\nrollback: 回退本票 commit\nfiles_modified:\n  - a.mjs\n---\n\n### T1 重验\n\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 修复并重验原 truth,不扩 scope。\n- **verify**: node a.mjs\n- **fails_when**: 退出码非 0(输出无 ok)\n- **done**: 输出 ok\n';
    const mkRDir = (ks) => { const d = mkdtempSync(join(tmpdir(), "mm-gsd-rplan-"));
      mkdirSync(join(d, ".planning"), { recursive: true });
      writeFileSync(join(d, "a.mjs"), "console.log('ok');\n");
      writeFileSync(join(d, ".planning", "STATE.md"), '---\nstatus: shipped\nactive_phase: "01"\n---\n');
      for (const k of ks) writeFileSync(join(d, ".planning", "01-" + k + "-PLAN.md"), rPlan(k));
      return d; };
    // ④ R 票过 --plan 门:无 frontmatter wave 不判红(R 票是串行补票,不进波次)
    const dD = mkRDir(["R1"]);
    let rD = runCk(dD, ["--plan", ".planning/01-R1-PLAN.md"]);
    eqN(rD.code === 0 && !rD.out.includes("wave"), true, "R 票过 --plan 门(wave 可空不判红)");
    rmSync(dD, { recursive: true, force: true });
    // ⑤ 两张 R 票撞同一文件 → 批图不判红(修复是串行的,不是新并行面)
    const dE = mkRDir(["R1", "R2"]);
    let rE = runCk(dE, ["--plan", ".planning/01-R1-PLAN.md", ".planning/01-R2-PLAN.md"]);
    eqN(rE.code === 0 && !rE.out.includes("撞了文件"), true, "R 票不被批图卷入(同文件不判并行冲突)");
    rmSync(dE, { recursive: true, force: true });
    // ⑥ 同 phase R 票 ≥3 → 强制升级黄提醒(黄不拦红,退出码仍 0)
    const dF = mkRDir(["R1", "R2", "R3"]);
    let rF = runCk(dF, ["--plan", ".planning/01-R1-PLAN.md", ".planning/01-R2-PLAN.md", ".planning/01-R3-PLAN.md"]);
    eqN(rF.code === 0 && rF.out.includes("强制升级"), true, "R 票 ≥3 → 强制升级黄提醒");
    rmSync(dF, { recursive: true, force: true });
  }
  // ---- 债面板口径(phase 22 D-02/D-05 + 23 D-03 分类感知):parked/deferred 分列 + 台账处置为准(纯函数断言,不写盘不起服务) ----
  {
    const debtDir = {
      "issues/LEDGER.md": "| 件 | 处置 | 挂靠 | 说明 |\n|---|---|---|---|\n| I-001.md | closed | — | 已修 |\n",
      "issues/I-001.md": "# I-001 已修的件\n\n## 状态\n\nopen\n",
      "issues/I-002.md": "# I-002 台账没登记的件\n\n## 状态\n\nopen\n",
      "01-CONTEXT.md": "<deferred>\n\n| 项 | 分类 | 触发条件 / 关闭理由 | 归属 |\n|---|---|---|---|\n| 精确耗时 | 挂条件 | 宿主新增事件 | 每次 release 后查一次 |\n\n</deferred>\n",
    };
    const debt = buildDebt({ planningDir: debtDir, annotations: [] });
    // ① 挂条件条目带齐五要素进 parked(项/分类/触发条件/归属/来源),且不进 deferred、不计数
    //    (23 D-03:已有处置理由的不计数;归一成纯文本就答不出「何时做、谁做、为什么不做」)
    eqArr(
      debt.parked.map((d) => [d.text, d.kind, d.condition, d.owner, d.source]),
      [["精确耗时", "挂条件", "宿主新增事件", "每次 release 后查一次", "01-CONTEXT.md"]],
      "挂条件条目 → 进 parked 不进 deferred",
    );
    eqN(debt.deferred.some((d) => d.text === "精确耗时") || debt.counts.total !== debt.counts.openIssues + debt.counts.openAnnotations + debt.counts.deferred, false, "挂条件条目 → 进 parked 不进 deferred(deferred 侧为空且不进 total)");
    // ② 台账 closed 的不计入 open;台账没行才回退原件状态(原件 open 才算)
    eqArr(debt.localIssues.map((i) => i.id), ["I-002"], "台账 closed → 不计入 open");
  }
  // ---- 工具遥测 → 看板迷你图可渲染(phase 22 D-03):按本地日切桶 + cwd 归一后等值比较(纯函数断言,不写盘不起服务) ----
  {
    // 两个时刻相隔 35 小时 —— 超过一个整日,任何时区下都落在两个不同的本地日。
    // ts1 在 UTC+8 落在 11-11(UTC 是 11-10):按本地日切与按 UTC 日切结果不同,断言有判别力。
    const telRoot = "/proj/demo";
    const TS1 = "2026-11-10T23:30:00.000Z";
    const TS2 = "2026-11-12T10:30:00.000Z";
    // 期望的本地日由本用例自己按本地构造器算(不借用被测实现的切桶函数)
    const localDay = (iso) => {
      const d = new Date(iso);
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    };
    const tel = aggregateByDay([
      { ts: TS1, cwd: "/proj/demo/", tool: "Bash" },   // 尾斜杠变体 → 计入
      { ts: TS1, cwd: "/PROJ/DEMO", tool: "Read" },    // 大小写变体 → 计入
      { ts: TS2, cwd: "/proj/demo", tool: "Write" },   // 正常写法 → 计入
      { ts: TS2, cwd: "/proj/other", tool: "Edit" },   // 异 cwd → 不计入
    ], telRoot);
    // 桶键必须是补零的 YYYY-MM-DD(不补零时「2026-1-2」与「2026-01-02」是两个桶)
    eqN(
      JSON.stringify({
        total: tel.total,
        series: tel.series,
        byTool: tel.byTool,
        empty: tel.empty,
      }),
      JSON.stringify({
        total: 3,
        series: [{ date: localDay(TS1), count: 2 }, { date: localDay(TS2), count: 1 }],
        byTool: { Bash: 1, Read: 1, Write: 1 },
        empty: false,
      }),
      "工具遥测 → 看板迷你图可渲染",
    );
  }
  // ---- 生产端点名映射(24-01 T2,D-03/D-04):SHIP 的一句话结论占位 / STATE 的索引地图注记 ----
  //      口径 = 只点名不新建:模板占位在场即完成;消费端门禁(读 summary 断言真实工件)不在本批范围(PLAN-CHECK 记录为接受残余)。
  {
    const shipTpl = readFileSync(fileURLToPath(new URL("../templates/ship.md", import.meta.url)), "utf8");
    const stateTpl = readFileSync(fileURLToPath(new URL("../templates/state.md", import.meta.url)), "utf8");
    eqN(/(^|\n)summary:/.test(shipTpl), true, "SHIP 模板含 summary 一句话结论占位");
    eqN(stateTpl.includes("L0/L1/L2 索引地图"), true, "STATE 模板含 L0/L1/L2 索引地图注记");
  }
  // ---- 自测遥测隔离(26-06 T1 / D-11 / REQ-39):自测产生的门禁失败必须带 sandbox 标记 ----
  // 顺序写死:先跑完全部断言 → 再还原 env → 再删临时目录(断言要读这个文件,先删会 ENOENT 崩栈而不是判红)。
  {
    const rows = existsSync(SELFTEST_TELEMETRY)
      ? readFileSync(SELFTEST_TELEMETRY, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } })
      : [];
    eqN(rows.length > 0 && rows.every((r) => r.sandbox === true), true, "自测遥测:telemetry-sandbox 临时文件非空且每条记录都带 sandbox 标记");
    eqN(rows.filter((r) => r.exit === 1 && r.sandbox !== true).length, 0, "自测遥测:telemetry-sandbox 没有未标 sandbox 的失败记录");
  }
  // ---- 版本自报(phase 27 T1 / D-04 / REQ-50):遥测行带 ver,版本解析与分桶可判 ----
  {
    const hereDir = dirname(fileURLToPath(import.meta.url));
    const skillDir = dirname(dirname(CHECKER));   // = skills/mm-gsd-loop(仓库与安装布局同形)
    const expectVer = mmGsdVersion(skillDir);
    eqN(expectVer !== "unknown", true, "ver-1 版本可解析(仓库 package.json 或安装清单),不落 unknown");
    eqN(mmGsdVersion(hereDir), expectVer, "ver-1 版本解析:references 目录往上找 = 检查器视角的版本");
    const vTmp = mkdtempSync(join(tmpdir(), "mm-gsd-ver-"));
    const noFile = join(vTmp, "no-such.json");
    eqN(mmGsdVersion(vTmp, { manifestPath: noFile, installManifestPath: noFile }), "unknown", "ver-2 两个口子都读不到 → unknown(不许崩、不许瞎猜)");
    writeFileSync(join(vTmp, "fake.json"), JSON.stringify({ version: "9.9.9" }), "utf8");
    eqN(mmGsdVersion(join(vTmp, "no-such-dir"), { installManifestPath: join(vTmp, "fake.json") }), "9.9.9", "ver-2 起点目录不存在 → 不往上找,读安装清单的 9.9.9");
    const b3 = splitByVersion([{ ver: expectVer }, { ver: "0.0.1" }, {}, { ver: "unknown" }], expectVer);
    eqN(b3.cur.length, 1, "ver-3 分桶:当前版本的行进 cur");
    eqN(b3.old.length, 3, "ver-3 分桶:旧版本行 / 无 ver 老行 / unknown 行都进 old(不许丢)");
    const u3 = splitByVersion([{ ver: "unknown" }, {}, { ver: expectVer }], "unknown");
    eqN(u3.cur.length, 0, "ver-3 观察方版本未知 → 全部归 old(没有已知版本就没有「当前版本」)");
    const tel4 = join(vTmp, "run.jsonl");
    execFileSync(process.execPath, [CHECKER, "--stats"], { cwd: tmpdir(), encoding: "utf8", stdio: "pipe", env: { ...process.env, GSD_TELEMETRY: "1", GSD_TELEMETRY_PATH: tel4, GSD_SANDBOX: "1" } });
    const rec4 = JSON.parse(readFileSync(tel4, "utf8").split("\n").filter(Boolean).pop());
    eqN(rec4.ver, expectVer, "ver-4 遥测行带 ver 且等于写记录方自报的版本");
    rmSync(vTmp, { recursive: true, force: true });
  }
  // 还原环境变量:原值不存在就用 delete —— 写 = undefined 会被 Node 变成字符串 "undefined"(truthy),
  // 之后任何 spawn 检查器都会往一个叫 undefined 的文件写遥测。
  for (const [k, v] of Object.entries(ENV_BACKUP)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // 断言总数基线门(phase 30 T3,REQ-66):纯搬移不该改变总数;总数变了而 N 没改 = 覆盖被拆丢或重复跑。
  // N 是本文件顶部的冻结常量,只在有意增删断言时人工 bump(30-02 拆族/30-03 加夹具断言时各 bump 一次)。
  if (st.total !== SELFTEST_CASES_TOTAL) {
    st.bad++;
    console.log(`
✗ 断言总数 ${st.total} ≠ 基线 ${SELFTEST_CASES_TOTAL} —— 覆盖被拆丢或重复跑;有意增删断言时人工 bump SELFTEST_CASES_TOTAL`);
  } else {
    console.log(`
✓ 断言总数 ${st.total} == 基线 ${SELFTEST_CASES_TOTAL}(覆盖完整)`);
  }
  rmSync(SELFTEST_TMP, { recursive: true, force: true });
  console.log(st.bad ? `\n${st.bad} 项自测不过 —— 门禁本身是坏的,先修门禁` : "\n✓ 门禁自测全过");
  return st.bad;
}
