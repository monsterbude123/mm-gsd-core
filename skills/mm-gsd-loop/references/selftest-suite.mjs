// 自测套件 —— 断言工具 + 长到塞不进 gate-selftest.mjs 的用例组(原名 selftest-helpers.mjs,只装断言工具;
// 文件名要跟内容对上,文件名骗人比文件超限更难查)。用例从 gate-selftest.mjs 搬来是因为那儿 200/200 顶着上限,
// 而用例只会继续长:断言只有一份实现(mkAssert),用例可以分文件 —— 抄一份断言就是抄一份会走偏的判据。
// 三种断言:eq(正则)、eqN(单值)、eqArr(数组)。全部把失败计入 st.bad。

import { classifyArtifact, parseAccounting, commitExists, checkArtifactLedger } from "./artifact-ledger.mjs";
import { checkPlanReady, readPhaseConvergence, classifyArtifactBlockers, REVIEW_PROMPT } from "./plan-ready.mjs";
import { discoverPacks, resolvePack, resolveEntry, makePackFixture } from "./packs.mjs";
import { checkCoreBoundary } from "./core-boundary.mjs";
import { checkWebTemplateJs } from "./web-template-gate.mjs";
import { checkUpdateScenarios, parseInstallTarget } from "./update-gate.mjs";
import { cmpVersion, pickCoverAction, pickUpdateAction } from "./update-resolve.mjs";
import { checkRequirementMining, phaseReqs } from "./requirement-mining.mjs";
import { checkPhaseCoverage, checkReversibility } from "./decision-gates.mjs";
import { checkTicketPremises } from "./verification-gates.mjs";
import { staleDecisions, coveredDecisions, phaseCovered, staleNote, planExists, runDecisionContracts, checkPlanCheckArtifacts } from "./ticket-alive.mjs";
import { phaseHealth } from "./telemetry-aggregate.mjs";
import { checkRoutes, routeSection, pointerCard, reviewerCard, buildRouteBrief } from "./agent-routing.mjs";
import { deriveWaves } from "./worktree-view.mjs";
import { checkPlanQuality, SIZE_EXEMPT } from "./plan-review-gate.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { aggregateByDay } from "./telemetry-view.mjs";

/** 造一组断言。返回的 st.bad 是失败条数 —— 调用方自己决定怎么汇报 */
export function mkAssert() {
  const st = { bad: 0, total: 0 };
  const eq = (re, s, want, why) => {
    const got = re.test(s), good = got === want;
    st.total++;
    if (!good) st.bad++;
    console.log(`  ${good ? "✓" : "✗"} ${why}: ${JSON.stringify(s)} → ${got}`);
  };
  const eqN = (got, want, why) => {
    const good = got === want;
    st.total++;
    if (!good) st.bad++;
    console.log(`  ${good ? "✓" : "✗"} ${why}: ${got} → ${good ? "" : want}`);
  };
  const eqArr = (got, want, why) => {
    const good = JSON.stringify(got) === JSON.stringify(want);
    st.total++;
    if (!good) st.bad++;
    console.log(`  ${good ? "✓" : "✗"} ${why}: ${JSON.stringify(got)} → ${good ? "" : JSON.stringify(want)}`);
  };
  return { eq, eqN, eqArr, st };
}

/** 波次推导用例组(R-24,28-13):次序从 depends_on 推导,不从手写来 */
export function runWaveFromDagCases({ eqN }) {
  const chain = [{ id: "a", depends: [] }, { id: "b", depends: ["a"] }, { id: "c", depends: ["b"] }];
  const w = deriveWaves(chain);
  eqN(w.get("a"), 1, "wvd-1 无依赖推导 1");
  eqN(`${w.get("a")}/${w.get("b")}/${w.get("c")}`, "1/2/3", "wvd-2 链式三票推导递增");
  eqN(deriveWaves([{ id: "x", depends: ["外部-不在集合"] }]).get("x"), 1, "wvd-3 依赖不在集合内按 0 计");
  const real06 = deriveWaves([
    { id: "28-01", depends: [] }, { id: "28-02", depends: ["28-01"] }, { id: "28-03", depends: ["28-01", "28-02"] },
    { id: "28-05", depends: ["28-02", "28-03"] }, { id: "28-06", depends: ["28-02", "28-05"] },
  ]);
  eqN(real06.get("28-06"), 5, "wvd-4 28-06 真实形态推导 5(手写 6 与之不符,门在 --plan 批图区判红)");
}

/** 14 族机器门用例组(28-10):真调 checkPlanQuality,判据掏空时这些锚点一起红 */
export function runReviewGateCases({ eqN }) {
  const mk = (verify) => [
    "---", "phase: \"41\"", "plan: \"01\"", "goal: 夹具票", "files_modified:", "  - bin/x.mjs",
    "depends_on: []", "cwd: .", "---", "", "## T1 夹具", "", "- **files**: bin/x.mjs",
    "- **action**: 改 bin/x.mjs", "- **verify**: " + verify,
  ].join("\n");
  const r1 = checkPlanQuality(mk("f(){ false; local code; code=$?; }"), { baseline: new Map() });
  eqN(r1.problems.some((p) => p.family === "F16-exit-code-capture-adjacency"), true, "rgv-1 F16 捕获邻接(local 后才捕 $? 必红)");
  const big = "echo x;".repeat(600);
  const r2 = checkPlanQuality(mk(big), { baseline: new Map() });
  eqN(r2.problems.some((p) => p.family === "F6-budget" && p.msg.includes("[TICKET-SIZE]")), true, "rgv-2 单行巨串 verify 被 [TICKET-SIZE] 字节门判红");
  const r3 = checkPlanQuality(mk(big), { baseline: new Map(), planId: "28-06" });
  eqN(r3.problems.some((p) => p.family === "F6-budget"), false, "rgv-3 SIZE_EXEMPT 内票号豁免 F6(决定 #1)");
  eqN(SIZE_EXEMPT.has("28-09"), true, "rgv-3b 豁免名单含退清单票 28-09");
  const r4 = checkPlanQuality(mk('node -e "1"'), { baseline: new Map() });
  eqN(r4.problems.some((p) => p.family === "F1-verify-blind"), true, "rgv-4 verify 不碰交付文件判 F1 盲验");
}

/** phase 级收敛用例组(28-11):收敛取代票级、停滞升级、machine 分类降级、祖父路径 */
export function runConvergenceCases({ eqN }) {
  const dir = mkdtempSync(join(tmpdir(), "ar-conv-"));
  mkdirSync(join(dir, ".planning"), { recursive: true });
  const MD = String.fromCharCode(46) + "md";
  const fm = (o) => ["---", ...Object.entries(o).map(([k, v]) => k + ": " + v), "---"].join("\n");
  writeFileSync(join(dir, ".planning", "99-REVIEW-CONVERGENCE-r1" + MD), fm({ round: 1, new_judgment: 3, open_judgment: 1, status: "blocked" }));
  const c1 = readPhaseConvergence(join(dir, ".planning"), "99");
  eqN(c1.present && !c1.stalled, true, "rcv-1 单轮收敛工件在场且不判停");
  writeFileSync(join(dir, ".planning", "99-REVIEW-CONVERGENCE-r2" + MD), fm({ round: 2, new_judgment: 3, open_judgment: 2, status: "blocked" }));
  eqN(readPhaseConvergence(join(dir, ".planning"), "99").stalled, true, "rcv-2 相邻两轮 new_judgment 不降判停");
  writeFileSync(join(dir, ".planning", "99-01-PLAN-CHECK" + MD), fm({ status: "blocked", plan: "99-01", blockers: 2, warnings: 0 }) + "\n- [BLOCKER] cargo test -- no_case 零匹配假绿(零数据输入会绿)\n- [BLOCKER] 断言计数把表头算进表体,数错(自证类)");
  const cls = classifyArtifactBlockers(join(dir, ".planning", "99-01-PLAN-CHECK" + MD));
  eqN(cls.judgmentCount, 0, "rcv-3 两条机器可判 BLOCKER 全部分类降级");
  writeFileSync(join(dir, ".planning", "99-01-PLAN" + MD), ["---", "phase: \"99\"", "plan: \"01\"", "goal: 夹具", "files_modified:", "  - x.md", "depends_on: []", "cwd: .", "---", "", "## T1", "", "- **files**: x.md", "- **action**: 改 x.md", "- **verify**: node -e \"0\"", "- **done**: 夹具即本行"].join("\n"));
  const sup = checkPlanReady({ planPath: join(dir, ".planning", "99-01-PLAN" + MD) }, { superseded: true });
  eqN(sup.state, "passed", "rcv-4 superseded 下全 machine 类降级不拦工");
  const legacy = checkPlanReady({ planPath: join(dir, ".planning", "99-01-PLAN" + MD) });
  eqN(legacy.state === "blocked" || legacy.state === "missing", true, "rcv-4b 祖父路径:无收敛工件时保持票级旧判");
  // rcv-5/6/7/8:逐票预审工件契约门必须与 checkPlanReady 同一 superseded 口径(R-26)。
  // 修之前:phase 级收敛工件在场,票级工件门照样报「缺预审结论」→ 29 起的新流程每张票恒红。
  const fmParse = (p) => {
    const t = readFileSync(p, "utf8");
    const m = t.match(/^---\n([\s\S]*?)\n---/);
    const o = {};
    if (m) for (const l of m[1].split("\n")) { const i = l.indexOf(":"); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
    return o;
  };
  writeFileSync(join(dir, ".planning", "99-02-PLAN" + MD), ["---", "phase: \"99\"", "---", "", "## T1"].join("\n"));
  writeFileSync(join(dir, ".planning", "99-02-SUMMARY" + MD), ["---", "phase: \"99\"", "status: complete", "---", "", "夹具"].join("\n"));
  const noConv = checkPlanCheckArtifacts({ dir: join(dir, ".planning"), plans: ["99-02-PLAN" + MD], summaries: ["99-02-SUMMARY" + MD], frontmatter: fmParse, supersededPhases: new Set() });
  eqN(noConv.some((m) => m.includes("99-02: 已经开工却没有预审结论")), true, "rcv-5 无 phase 级收敛工件时,缺票级预审工件照样判红(门没被放空)");
  const withConv = checkPlanCheckArtifacts({ dir: join(dir, ".planning"), plans: ["99-02-PLAN" + MD], summaries: ["99-02-SUMMARY" + MD], frontmatter: fmParse, supersededPhases: new Set(["99"]) });
  eqN(withConv.some((m) => m.includes("99-02: 已经开工却没有预审结论")), false, "rcv-6 phase 级收敛工件在场 ⇒ 票级预审被取代(R-26),不再报缺票级工件");
  writeFileSync(join(dir, ".planning", "99-03-PLAN" + MD), ["---", "phase: \"99\"", "---", "", "## T1"].join("\n"));
  writeFileSync(join(dir, ".planning", "99-03-SUMMARY" + MD), ["---", "phase: \"99\"", "status: complete", "---", "", "夹具"].join("\n"));
  writeFileSync(join(dir, ".planning", "99-03-PLAN-CHECK" + MD), fm({ status: "乱写", plan: "99-03", blockers: 0, warnings: 0 }));
  const badShape = checkPlanCheckArtifacts({ dir: join(dir, ".planning"), plans: ["99-03-PLAN" + MD], summaries: ["99-03-SUMMARY" + MD], frontmatter: fmParse, supersededPhases: new Set(["99"]) });
  eqN(badShape.some((m) => m.includes("99-03-PLAN-CHECK" + MD + ": status 非法或缺失")), true, "rcv-7 收敛取代只豁免「缺票级工件」,在场的票级工件形状非法照样判红");
  const otherPhase = checkPlanCheckArtifacts({ dir: join(dir, ".planning"), plans: ["99-02-PLAN" + MD], summaries: ["99-02-SUMMARY" + MD], frontmatter: fmParse, supersededPhases: new Set(["98"]) });
  eqN(otherPhase.some((m) => m.includes("99-02: 已经开工却没有预审结论")), true, "rcv-7b 取代按票自己的 phase 号判:别的 phase 的收敛工件不能免掉这张票的要求");
  // rcv-8:形状不合的收敛工件不算在场 —— 否则一个空文件就能让整 phase 的「缺票级工件」不再报
  const badConvDir = mkdtempSync(join(tmpdir(), "ar-conv-bad-"));
  mkdirSync(join(badConvDir, ".planning"), { recursive: true });
  writeFileSync(join(badConvDir, ".planning", "99-REVIEW-CONVERGENCE" + MD), fm({ status: "passed" }));
  eqN(readPhaseConvergence(join(badConvDir, ".planning"), "99").present, false, "rcv-8 缺 round/new_judgment 的收敛工件不算在场(取代只免「缺」,不免「坏」)");
  rmSync(badConvDir, { recursive: true, force: true });
  // rcv-9:端到端 —— 接线也在内(目录、phase 号、取代信号),在真实 .planning 上跑检查器
  const e2eDir = mkdtempSync(join(tmpdir(), "ar-conv-e2e-"));
  const e2ePlan = join(e2eDir, ".planning");
  mkdirSync(e2ePlan, { recursive: true });
  // 不写 active_phase:root 布局这时圈全 phase(冷启动/兜底那条路)——
  // 只有多 phase 同框,才测得出「取代按票自己的 phase 号判,不被别的 phase 的收敛工件顺带免掉」。
  writeFileSync(join(e2ePlan, "STATE.md"), "---\nstatus: verifying\nactive_phase: \"\"\n---\n");
  writeFileSync(join(e2ePlan, "29-CONTEXT.md"), "---\nphase: \"29\"\n---\n\n<domain>\n夹具\n</domain>\n");
  writeFileSync(join(e2ePlan, "29-01-PLAN.md"), "---\nphase: \"29\"\nplan: \"01\"\n---\n\n## T1\n");
  writeFileSync(join(e2ePlan, "29-01-SUMMARY.md"), "---\nphase: \"29\"\nstatus: complete\ncommits: 1\n---\n\n## One-liner\n\n夹具\n");
  // 另一个 phase 的票(28-01):没有自己的收敛工件
  writeFileSync(join(e2ePlan, "28-01-PLAN.md"), "---\nphase: \"28\"\nplan: \"01\"\n---\n\n## T1\n");
  writeFileSync(join(e2ePlan, "28-01-SUMMARY.md"), "---\nphase: \"28\"\nstatus: complete\ncommits: 1\n---\n\n## One-liner\n\n夹具\n");
  const checkerPath = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "gsd-state-check.mjs");
  // 检查器有红项时退出码非 0 → execFileSync 抛错,stdout 得从 err 里取(丢了就变成假绿)
  const runCheckerJson = (dir) => {
    let out = "";
    try {
      out = execFileSync(process.execPath, [checkerPath, "--json"], { cwd: dir, encoding: "utf8", stdio: "pipe", env: { ...process.env, GSD_SANDBOX: "1", GSD_PROJECT_DIR: "", GSD_TELEMETRY_PATH: join(dir, "telemetry.jsonl") } });
    } catch (e) { out = String(e.stdout || ""); }
    try { return JSON.parse(out); } catch { return null; }
  };
  const noConvJson = runCheckerJson(e2eDir);
  eqN(!!noConvJson, true, "rcv-9a 端到端:检查器跑完了并输出 JSON(崩了或没输出不算通过)");
  eqN((noConvJson?.errors ?? []).some((e) => String(e.message).includes("已经开工却没有预审结论")), true, "rcv-9b 端到端:无收敛工件时检查器判「缺票级预审工件」");
  writeFileSync(join(e2ePlan, "29-REVIEW-CONVERGENCE.md"), fm({ phase: "29", round: 1, new_judgment: 0, open_judgment: 0, status: "passed" }) + "\n# 29 收敛\n");
  const convJson = runCheckerJson(e2eDir);
  eqN(!!convJson, true, "rcv-9c 端到端:有收敛工件时检查器也跑完了");
  eqN((convJson?.errors ?? []).some((e) => String(e.message).includes("29-01: 已经开工却没有预审结论")), false, "rcv-9d 端到端:有 phase 级收敛工件时,29 的票不再报「缺票级预审工件」");
  eqN((convJson?.errors ?? []).some((e) => String(e.message).includes("28-01: 已经开工却没有预审结论")), true, "rcv-9e 端到端:别的 phase(28)的票仍判红 —— 取代按票自己的 phase 号,不按 active_phase");
  rmSync(e2eDir, { recursive: true, force: true });
  // rcv-10:phases 布局 —— 收敛工件落在 phase 目录里(.planning/phases/<NN>/),root 布局那条路覆盖不到
  const phDir = mkdtempSync(join(tmpdir(), "ar-conv-phases-"));
  const phPhase = join(phDir, ".planning", "phases", "29");
  mkdirSync(phPhase, { recursive: true });
  writeFileSync(join(phDir, ".planning", "STATE.md"), "---\nstatus: verifying\nactive_phase: \"29\"\n---\n");
  writeFileSync(join(phPhase, "29-CONTEXT.md"), "---\nphase: \"29\"\n---\n\n<domain>\n夹具\n</domain>\n");
  writeFileSync(join(phPhase, "29-01-PLAN.md"), "---\nphase: \"29\"\nplan: \"01\"\n---\n\n## T1\n");
  writeFileSync(join(phPhase, "29-01-SUMMARY.md"), "---\nphase: \"29\"\nstatus: complete\ncommits: 1\n---\n\n## One-liner\n\n夹具\n");
  writeFileSync(join(phPhase, "29-REVIEW-CONVERGENCE.md"), fm({ phase: "29", round: 1, new_judgment: 0, open_judgment: 0, status: "passed" }) + "\n# 29 收敛\n");
  const phJson = runCheckerJson(phDir);
  eqN(!!phJson, true, "rcv-10a phases 布局:检查器跑完了并输出 JSON");
  eqN((phJson?.errors ?? []).some((e) => String(e.message).includes("已经开工却没有预审结论")), false, "rcv-10b phases 布局:收敛工件落在 phase 目录里时,票级「缺预审工件」不报 —— 两种布局同一口径");
  rmSync(phDir, { recursive: true, force: true });
}

/** 可选包机制用例组(28-01,D-03/D-07/REQ-58):判定只认 packs.mjs 公开 API,夹具唯一来自 makePackFixture */
export function runPackCases({ eqN }) {
  const fx = makePackFixture();
  const packs = discoverPacks(fx.root);
  const fake = packs.find((p) => p.name === fx.fake);
  eqN(fake ? [fake.entry === fx.fakeEntry, fake.display === fx.display, (fake.aliases ?? []).join(",")].join(",") : "missing", "true,true,fk,version", "pack-1 声明 entry 的目录被认成包且 entry/display/aliases 读对");
  eqN(packs.some((p) => p.name === fx.plain), false, "pack-2 没声明 entry 的目录不算包");
  eqN(resolvePack(packs, "fake")?.name, fx.fake, "pack-3 resolvePack 按包名命中");
  eqN([resolvePack(packs, "fk")?.name, resolvePack(packs, "nk")?.name].join(","), [fx.fake, fx.noopt].join(","), "pack-4 按 aliases 命中(无引号与带引号两种写法都认)");
  eqN(resolvePack(packs, "nope") ?? null, null, "pack-5 不存在的命令返回空(不误命中)");
  const ar = buildRouteBrief({ stage: null, skillsRoot: fx.root, projectRoot: ".", home: tmpdir(), activePhase: null });
  eqN([ar.skills.some((s) => s.skill === fx.fake), ar.packs.some((p) => p.name === fx.fake), ar.skills.some((s) => s.skill === fx.noopt)].join(","), "false,true,true", "pack-6 optional 包不进环进 packs 栏;无 optional 的照旧在环里");
  const en = resolveEntry(packs.find((p) => p.name === fx.broken));
  eqN([String(en.missing), en.message.includes(fx.brokenEntry)].join(","), "true,true", "pack-7 入口缺失报 missing 并给带入口路径的人话");
  rmSync(fx.root, { recursive: true, force: true });
  rmSync(fx.plainRoot, { recursive: true, force: true });
}

/** 工具遥测视图纯函数用例组(28-02 T2 自核心 selftests 搬入):按本地日切桶/异 cwd 过滤/空态/import 无副作用。
 *  服务层与模板断言在 包自测 board-probe(28-02 D-03)。 */
export function runTelemetryViewCases({ eqN, eqArr }) {
  const MODULE_PATH = fileURLToPath(new URL("./telemetry-view.mjs", import.meta.url));
  const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const localDay = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const pathVariant = (p) => {
    const seg = p.split(/[\\/]/);
    seg[seg.length - 1] = seg[seg.length - 1].toUpperCase();
    return seg.join("\\") + "\\";
  };
  // 夹具 instant:本地凌晨 02:00 与次日 02:00 —— 东八区宿主上落前一个 UTC 日,「本地日切桶」与「UTC 日切桶」可判别
  const now = new Date();
  const instantA = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 2, 0, 0);
  const instantB = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 2, 0, 0);
  const tsA = instantA.toISOString(), tsB = instantB.toISOString();
  const dayA = localDay(new Date(tsA)), dayB = localDay(new Date(tsB));
  const variant = pathVariant(PROJECT_ROOT);
  const otherDir = PROJECT_ROOT + "-other";
  const fixtureDir = mkdtempSync(join(tmpdir(), "mm-gsd-tel-fixture-"));
  const fixtureFile = join(fixtureDir, "tools.jsonl");
  const fixtureRows = [
    { ts: tsA, cwd: variant, tool: "Bash" },
    { ts: tsA, cwd: PROJECT_ROOT, tool: "Bash" },
    { ts: tsB, cwd: PROJECT_ROOT, tool: "Read" },
    { ts: tsB, cwd: otherDir, tool: "Write" },
  ];
  writeFileSync(fixtureFile, fixtureRows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  const rows = readFileSync(fixtureFile, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const tel = aggregateByDay(rows, PROJECT_ROOT);
  eqN(dayA !== dayB, true, "遥测夹具自证:两个 instant 落在两个本地日(判别力前提)");
  eqArr([...new Set(tel.series.map((s) => s.date))].sort(), [dayA, dayB].sort(), "遥测日切桶按本地日期");
  eqN(tel.byTool.Write === undefined && tel.total === 3, true, "遥测异 cwd 不计入");
  eqArr({ Bash: tel.byTool.Bash, Read: tel.byTool.Read, keys: Object.keys(tel.byTool).sort() }, { Bash: 2, Read: 1, keys: ["Bash", "Read"] }, "遥测硬编码期望:Bash 2 / Read 1");
  eqN(tel.series.length, 2, "遥测序列长度 2");
  const emptyTel = aggregateByDay([], PROJECT_ROOT);
  eqN(emptyTel.series.length === 0 && emptyTel.empty === true, true, "遥测空夹具走空态");
  // import 副作用探针(R-16 真导入 references/:顶层 exit 会让整场 health 假绿)
  const marker = "TELEMETRY_VIEW_IMPORT_OK";
  const emptyDir = mkdtempSync(join(tmpdir(), "telemetry-view-empty-"));
  const url = pathToFileURL(MODULE_PATH).href;
  const code = `await import(${JSON.stringify(url)});\nprocess.stdout.write(${JSON.stringify(marker)});`;
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: emptyDir, encoding: "utf8" });
  const left = readdirSync(emptyDir);
  rmSync(emptyDir, { recursive: true, force: true });
  eqN(res.status === 0 && res.stdout === marker && res.stderr === "" && left.length === 0, true, "遥测 import 无副作用");
  rmSync(fixtureDir, { recursive: true, force: true });
}

/** 核心边界门用例组(28-04,R-28):脏树/净树/无包树/包内豁免真调 checkCoreBoundary;夹具只用假包名 */
export function runCoreBoundaryCases({ eqN }) {
  const tree = (files) => {
    const root = mkdtempSync(join(tmpdir(), "mm-gsd-coreb-"));
    for (const k of Object.keys(files)) {
      const p = join(root, k);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, files[k]);
    }
    return root;
  };
  const packSkill = '---\nname: "mm-gsd-fake"\nentry: scripts/entry.mjs\noptional: true\ndisplay: 假包\n---\n\n包自己的正文(显示名 假包 与目录名 mm-gsd-fake 在这里合法)';
  const coreMd = "skills/mm-gsd-loop/references/doc.md";
  const coreMjs = "skills/mm-gsd-loop/references/code.mjs";
  const packMd = "skills/mm-gsd-fake/SKILL.md";
  const packEntry = "skills/mm-gsd-fake/scripts/entry.mjs";
  const rules = (root) => checkCoreBoundary({ skillsRoot: join(root, "skills"), binPath: join(root, "bin") }).map((p) => p.rule);
  const r1 = rules(tree({ [coreMd]: "核心文档点了显示名:假包\n", [packMd]: packSkill, [packEntry]: "export const x = 1;\n" }));
  eqN(r1.join(","), "1", "core-1 核心 .md 有包显示名 → 规则一");
  const r2 = rules(tree({ [coreMjs]: "核心代码点了包目录名:mm-gsd-fake\n", [packMd]: packSkill, [packEntry]: "export const x = 1;\n" }));
  eqN(r2.join(","), "2", "core-3 核心 .mjs 有包目录名 → 规则二");
  const r4 = rules(tree({ [coreMd]: "核心文档不提包\n", [coreMjs]: "核心代码不提包\n", [packMd]: packSkill, [packEntry]: "export const x = 1;\n" }));
  eqN(r4.length, 0, "core-2 干净的树 → 0 条");
  const r5 = rules(tree({ [coreMd]: "没有可选包的树\n" }));
  eqN(r5.length, 0, "core-5 没有可选包 → 0 条");
  const r6 = rules(tree({ [packMd]: packSkill + "\n包自己的文件里写显示名与目录名 mm-gsd-fake", [packEntry]: "export const x = 1;\n" }));
  eqN(r6.length, 0, "core-6 可选包自己的文件豁免");
  const r7 = rules(tree({ [coreMd]: "核心文档点了命令调用形:mm-gsd fake\n", [packMd]: packSkill, [packEntry]: "export const x = 1;\n" }));
  eqN(r7.join(","), "2", "core-4 核心文件有命令调用形 → 规则二");
}

/** 模板脚本门禁用例组(R-30):三条判据各造一个违规输入 —— 门真的会红才算数(AGENTS.md「造门禁的判据」) */
export function runWebTemplateGateCases({ eqN }) {
  const tree = (files) => {
    const root = mkdtempSync(join(tmpdir(), "mm-gsd-webgate-"));
    for (const k of Object.keys(files)) {
      const p = join(root, k);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, files[k]);
    }
    return root;
  };
  const rel = "skills/mm-gsd-fake/templates/page.html";
  const rulesOf = (root) => checkWebTemplateJs({ skillsRoot: join(root, "skills") }).map((p) => p.rule);
  const css = ".view{display:flex}\n.view[hidden]{display:none !important}\n";
  const cleanJs = 'const a = 1;\nfunction boot() { return a; }\nboot();\n';
  const r0 = rulesOf(tree({ [rel]: "<html><style>" + css + "</style><body><script>" + cleanJs + "</script></body></html>" }));
  eqN(r0.length, 0, "webgate-1 干净模板 → 0 条");
  const r1 = rulesOf(tree({ [rel]: "<html><style>" + css + "</style><body><script>const a = 1;\n}\n</script></body></html>" }));
  eqN(r1.join(","), "1", "webgate-2 内联脚本有游离大括号 → 判据一(语法)");
  const r2 = rulesOf(tree({ [rel]: "<html><style>.view{display:flex}\n</style><body><script>" + cleanJs + "</script></body></html>" }));
  eqN(r2.join(","), "2", "webgate-3 CSS 没有显式隐藏 [hidden] → 判据二");
  const r3 = rulesOf(tree({ [rel]: "<html><style>" + css + "</style><body><script>boot();\nconst a = 1;\nfunction boot() { return a; }\n</script></body></html>" }));
  eqN(r3.join(","), "3", "webgate-4 顶层调用早于顶层声明 → 判据三(TDZ)");
  const r4 = rulesOf(tree({ [rel]: "<html><style>" + css + "</style><body><script>" + cleanJs + "</script></body></html>" }));
  eqN(r4.length, 0, "webgate-5 同一棵干净的树复跑 → 仍 0 条(门不是随机红)");
}

/** update 映射门用例组(R-31):版本决策是纯函数(四个结局),门禁本身拿一个「只覆盖不问 registry」的旧版 stub 当违规输入 */
export function runUpdateGateCases({ eqN }) {
  eqN(pickUpdateAction("0.7.0", "0.7.7"), "upgrade", "update-1 registry 上更新 → 换新再盖");
  eqN(pickUpdateAction("0.7.7", "0.7.7"), "current", "update-2 registry 上同版 → 盖当前这份");
  eqN(pickUpdateAction("0.7.8", "0.7.7"), "older", "update-3 registry 上更旧 → 不降级");
  eqN(pickUpdateAction("0.7.7", null), "offline", "update-4 registry 问不到 → 照旧覆盖并说清");
  eqN(cmpVersion("0.7.10", "0.7.9"), 1, "update-5 版本比较按数字比(0.7.10 比 0.7.9 新)");
  eqN(parseInstallTarget(["install", "--prefix", "/tmp/x", "--no-audit", "mm-gsd-core@0.7.7"]).version, "0.7.7", "update-6 解析 npm install 要取的那一版");
  eqN(pickCoverAction("0.7.9", "0.7.0"), "skip", "update-7 已装的比要盖的新 → 不许盖(全局命令旧、主仓新的现场)");
  eqN(pickCoverAction("0.7.0", "0.7.9"), "cover", "update-8 已装的更旧 → 照盖");
  eqN(pickCoverAction(null, "0.7.9"), "cover", "update-9 没装过 → 照盖");

  // 违规输入:旧版 update 的行为 —— 只覆盖、从不问 registry。门必须判红,不然这道门是装饰。
  const d = mkdtempSync(join(tmpdir(), "mm-gsd-update-gate-"));
  const stub = join(d, "stub.mjs");
  writeFileSync(stub, [
    'import { mkdirSync, writeFileSync } from "node:fs";',
    'import { join, resolve } from "node:path";',
    'const i = process.argv.indexOf("--home");',
    'const target = join(resolve(process.argv[i + 1]), ".agents", "skills");',
    'mkdirSync(target, { recursive: true });',
    'writeFileSync(join(target, ".mm-gsd-install.json"), JSON.stringify({ version: "0.0.1", source: "npm:mm-gsd-core@0.0.1", installedAt: new Date().toISOString(), skills: {} }));',
    'console.log("update —— 机械覆盖更新");',
    'console.log("  3 个技能已覆盖");',
  ].join("\n"));
  const res = checkUpdateScenarios({ installer: stub, version: "0.7.7", workRoot: join(d, "run") });
  eqN(res.problems.length > 0, true, "update-10 旧版 stub(不问 registry)→ 门必须判红");
  rmSync(d, { recursive: true, force: true });
}

/** 决策声明口径用例组(28-08):只认带方括号的大写 ID,散文裸引用不算;三条契约同一把尺 */
export function runDecisionScopeCases({ eqN }) {
  const rev = (t) => {
    const errs = [];
    checkReversibility({ ctxName: "t", ctxText: t, e: (m) => errs.push(m) });
    return errs;
  };
  const prose = "<decisions>\n### [D-01] reversible title\n</decisions>\n- D-04 要加 action 两个字段\n";
  eqN(rev(prose).length, 0, "decscope-1 散文里的裸引用不算决策");
  const missing = "<decisions>\n### [D-02] title\n</decisions>\n";
  eqN(rev(missing).length > 0, true, "decscope-2 真决策缺可逆性标记仍判红");
  const forms = ["### [D-01] title", "- [D-03] title", "**[D-04]** title", "[D-05] title"];
  eqN(forms.filter((f) => rev("<decisions>\n" + f + "\n</decisions>\n").length > 0).length, 4, "decscope-3 四种前缀形态照旧被认");
  const mixed = "<decisions>\n### [D-01] t1\n### [D-02] t2\n### [D-03] t3\n</decisions>\n- D-04 要加 action 两个字段\n";
  const ids = [...mixed.matchAll(/\[(D-\d+)\]/g)].map((m) => m[1]);
  eqN([new Set(ids).size, rev(mixed).length].join(","), "3,3", "decscope-4 三条契约同一口径(3 条决策各报一条缺标记,散文行不加第 4 条)");
}

/** 深挖需求门用例组(28-07,R-29):四问核对真调 checkRequirementMining,豁免两套口径各一条 */
export function runRequirementMiningCases({ eqN }) {
  const ctx = (rows) => ["<mining>", "### REQ-51 夹具"].concat(rows).concat(["</mining>"]).join("\n");
  const full = ["- **真实需求**: 有人在动作", "- **谁消费**: 人看", "- **什么时候会废**: 没人用", "- **做完长什么样**: 看得到"];
  const p1 = checkRequirementMining({ ctxText: ctx(full), reqs: [{ id: "REQ-51" }] });
  eqN(p1.length, 0, "mining-1 四问齐全 → 0 条问题");
  const p2 = checkRequirementMining({ ctxText: ctx(["- **真实需求**: 有人在动作", "- **什么时候会废**: 没人用", "- **做完长什么样**: 看得到"]), reqs: [{ id: "REQ-51" }] });
  eqN(p2.length >= 1 && p2[0].message.includes("谁消费"), true, "mining-2 缺谁消费 → 判红且点名");
  const p3 = checkRequirementMining({ ctxText: ctx(["- **真实需求**: 有人在动作"]), reqs: [{ id: "REQ-51" }, { id: "REQ-52" }] });
  eqN(p3.some((p) => p.message.includes("REQ-52") && p.message.includes("没有深挖块")), true, "mining-3 缺整块 → 判红点名 REQ-52");
  const p4 = checkRequirementMining({ ctxText: ctx(["- **真实需求**: ", "- **谁消费**: 人看", "- **什么时候会废**: 没人用", "- **做完长什么样**: 看得到"]), reqs: [{ id: "REQ-51" }] });
  eqN(p4.some((p) => p.message.includes("真实需求")), true, "mining-4 答案为空 → 判红");
  const p5 = checkRequirementMining({ ctxText: "没有 <mining> 节的旧 CONTEXT", reqs: [{ id: "REQ-51" }] });
  eqN(p5.length, 0, "mining-5 无 <mining> 节 → 豁免");
  const root = mkdtempSync(join(tmpdir(), "mm-gsd-mining-"));
  mkdirSync(join(root, ".planning"), { recursive: true });
  writeFileSync(join(root, ".planning", "REQUIREMENTS.md"), "- REQ-51: 活需求\n- REQ-52: baseline 已交付(baseline 0.7.0)\n");
  writeFileSync(join(root, ".planning", "28-01-PLAN.md"), "### T1\n- **covers**: REQ-51");
  writeFileSync(join(root, ".planning", "28-02-PLAN.md"), "### T1\n- **covers**: REQ-52");
  writeFileSync(join(root, ".planning", "req-ledger.md"), "| REQ | 处置 | 指向 | 说明 |\n|---|---|---|---|\n");
  eqN(phaseReqs(root, "28").join(","), "REQ-51", "mining-6 phaseReqs 剔 baseline 行的 REQ");
  writeFileSync(join(root, ".planning", "req-ledger.md"), "| REQ | 处置 | 指向 | 说明 |\n|---|---|---|---|\n| REQ-51 | delivered | 0.7.5 | 已交付 |\n");
  eqN(phaseReqs(root, "28").join(","), "", "mining-7 phaseReqs 剔 req-ledger 已处置的 REQ");
  rmSync(root, { recursive: true, force: true });
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
    eqN(ready().state, "blocked", "status=blocked → 不能开工(blocked 仍照红)");
    eqN(ready().problems.length, 1, "blocked → 报一条");
    put('---\nstatus: passed\nblockers: 1\nwarnings: 0\nplan: "07-01"\n---\n');
    eqN(ready().state, "blocked", "status=passed 却 blockers≠0 → 照红(BLOCKER 仍挡)");
    put('---\nstatus: passed\nblockers: 0\nwarnings: 2\nplan: "07-01"\n---\n');
    eqN(ready().state, "passed", "passed 带 warnings → 转绿(WARNING 归 Deferred)");
    eqN(ready().problems.length, 0, "passed 带 warnings → 零问题项");
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
    // 夹具必须显式传 env:GSD_PROJECT_DIR 会让检查器改用别的 root(读不到自己的 .planning),
    // 遥测开关只认环境变量 —— 不写死就会把自测夹具写进跨项目遥测(phase 26 D-07)
    const env = { ...process.env, GSD_TELEMETRY: "0", GSD_SANDBOX: "1", GSD_PROJECT_DIR: "" };
    try { return { code: 0, out: execFileSync(process.execPath, [checker, ...args], { cwd: dir, encoding: "utf8", stdio: "pipe", env }) }; }
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
    // ---- phase 26 D-07 / REQ-36:verify 字段的缩进续行也要进零匹配门的视野 ----
    // 续行里藏一条 cargo test -- 过滤器:首行看着正常,门禁看不见 → 零匹配假绿(issue #22)。
    const planCont = "---\nphase: \"01\"\nplan: \"01\"\ngoal: 夹具计划:续行里的 cargo 命令也要被门禁看见\nrollback: 删掉夹具即可\nfiles_modified:\n  - a.mjs\n---\n\n# 01-01 PLAN\n\n### T1 改一个常量\n\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 把常量改成 2,然后跑测试。\n- **verify**: npm run build\n  - cargo test -- my_case\n- **fails_when**: cargo 命令退出码非 0(输出里没有 passed 计数)\n- **done**: cargo 输出里出现实际计数\n";
    writeFileSync(join(dir, ".planning", "01-01-PLAN.md"), planCont);
    const p5 = run(["--plan", ".planning/01-01-PLAN.md"]);
    eqN(p5.code, 1, "verify 字段续行:续行里的 cargo 过滤器零匹配 → --plan 退出码非 0");
    eqN(p5.out.includes("票级 verify 存在假绿漏洞"), true, "verify 字段续行:续行里的 cargo 过滤器零匹配 → 输出零匹配报错");
    // ---- phase 26 D-10 / REQ-38:零缩进的懒续行也是 verify 的内容(G-26-7) ----
    // 用户渲染看到的「verify 里含那条命令」必须等于门禁看到的:懒续行(紧跟字段行、没隔空行)算 verify。
    const planLazy = "---\nphase: \"01\"\nplan: \"01\"\ngoal: 夹具计划:零缩进懒续行也要被门禁看见\nrollback: 删掉夹具即可\nfiles_modified:\n  - a.mjs\n---\n\n# 01-01 PLAN\n\n### T1 改一个常量\n\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 把常量改成 2,然后跑测试。\n- **verify**: npm run build\ncargo test -- my_case\n- **fails_when**: cargo 命令退出码非 0(输出里没有 passed 计数)\n- **done**: cargo 输出里出现实际计数\n";
    writeFileSync(join(dir, ".planning", "01-01-PLAN.md"), planLazy);
    const p6 = run(["--plan", ".planning/01-01-PLAN.md"]);
    eqN(p6.code, 1, "verify 字段懒续行:零缩进懒续行里的 cargo 过滤器零匹配 → --plan 退出码非 0");
    eqN(p6.out.includes("票级 verify 存在假绿漏洞"), true, "verify 字段懒续行:零缩进懒续行里的 cargo 过滤器零匹配 → 输出零匹配报错");
    // 空行之后的缩进行仍是同一个列表项的续行 → 照旧进零匹配门
    const planBlankIndent = "---\nphase: \"01\"\nplan: \"01\"\ngoal: 夹具计划:空行后的缩进续行也要被门禁看见\nrollback: 删掉夹具即可\nfiles_modified:\n  - a.mjs\n---\n\n# 01-01 PLAN\n\n### T1 改一个常量\n\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 把常量改成 2,然后跑测试。\n- **verify**: npm run build\n\n  - cargo test -- my_case\n- **fails_when**: cargo 命令退出码非 0(输出里没有 passed 计数)\n- **done**: cargo 输出里出现实际计数\n";
    writeFileSync(join(dir, ".planning", "01-01-PLAN.md"), planBlankIndent);
    const p7 = run(["--plan", ".planning/01-01-PLAN.md"]);
    eqN(p7.code, 1, "verify 字段懒续行:空行后的缩进续行里的 cargo 过滤器零匹配 → --plan 退出码非 0");
    // 空行之后的零缩进行属新块(段落已被空行终结)→ 不算 verify → 不得误伤
    const planBlankLazy = "---\nphase: \"01\"\nplan: \"01\"\ngoal: 夹具计划:空行后的零缩进属新块,不算 verify\nrollback: 删掉夹具即可\nfiles_modified:\n  - a.mjs\n---\n\n# 01-01 PLAN\n\n### T1 改一个常量\n\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 把常量改成 2,然后跑测试。\n- **verify**: npm run build\n\ncargo test -- my_case\n- **fails_when**: cargo 命令退出码非 0(输出里没有 passed 计数)\n- **done**: cargo 输出里出现实际计数\n";
    writeFileSync(join(dir, ".planning", "01-01-PLAN.md"), planBlankLazy);
    const p8 = run(["--plan", ".planning/01-01-PLAN.md"]);
    eqN(p8.code, 0, "verify 字段懒续行:空行后的零缩进是新块 → 不算 verify,不得误伤");
    // ---- phase 26 D-12/D-14/REQ-40:已收口的票(status: complete)退出该票的全部门禁 ----
    // 收口票不参与门禁:那张票自己的检查跑在历史工件上,恒红 = 门禁报废,不是严
    // (ticket-alive.mjs 文件头的 T-13「恒红的门不是严,是废」)。
    // 夹具故意缺 goal:活票必红(缺 goal)+ 两张同 phase 同 files 必撞文件(批图门红)。
    const planDone = "---\nphase: \"01\"\nplan: \"01\"\nrollback: 删掉夹具即可\nfiles_modified:\n  - README.md\n---\n\n# 01-01 PLAN\n\n### T1 改一个常量\n\n- **files**: README.md\n- **read_first**: README.md\n- **action**: 改点东西。\n- **verify**: node test.js\n- **fails_when**: 测试退出码非 0(输出里没有 ok)\n- **done**: 测试输出 ok\n";
    const planDone2 = "---\nphase: \"01\"\nplan: \"02\"\nrollback: 删掉夹具即可\nfiles_modified:\n  - README.md\n---\n\n# 01-02 PLAN\n\n### T1 改一个常量\n\n- **files**: README.md\n- **read_first**: README.md\n- **action**: 改点东西。\n- **verify**: node test.js\n- **fails_when**: 测试退出码非 0(输出里没有 ok)\n- **done**: 测试输出 ok\n";
    writeFileSync(join(dir, ".planning", "01-01-PLAN.md"), planDone);
    writeFileSync(join(dir, ".planning", "01-02-PLAN.md"), planDone2);
    writeFileSync(join(dir, "README.md"), "x\n");
    // 老版本 exec 没写 plan 字段 → 走「文件名即票号」规则(D-14/D-15)
    writeFileSync(join(dir, ".planning", "01-01-SUMMARY.md"), "---\nphase: \"01\"\nstatus: complete\n---\n");
    writeFileSync(join(dir, ".planning", "01-02-SUMMARY.md"), "---\nphase: \"01\"\nstatus: complete\n---\n");
    const p9 = run(["--plan", ".planning/01-01-PLAN.md", ".planning/01-02-PLAN.md"]);
    eqN(p9.code, 0, "已收口票:两张都有 status=complete 的 SUMMARY → 退出码 0(退出该票的全部门禁)");
    eqN(p9.out.includes("skipped-done"), true, "已收口票:输出要交代跳过了几张(skipped-done)");
    // status=halted = 受阻,票还活着 → 照判(缺 goal 判红)
    writeFileSync(join(dir, ".planning", "01-02-SUMMARY.md"), "---\nphase: \"01\"\nstatus: halted\n---\n");
    const p10 = run(["--plan", ".planning/01-01-PLAN.md", ".planning/01-02-PLAN.md"]);
    eqN(p10.code, 1, "已收口票:status=halted 的票还活着 → 退出码非 0(照判)");
    // ---- phase 26 D-19/REQ-46:票面 verify 引用的自测用例名必须真实存在(G-26-10) ----
    // 名字写错 → 这张票的 verify 永远 exit 1,而本仓没有机器门执行票面 verify → 永远没人知道。
    // 这道门只对**已收口**的票判(施工中的票引用还没建的用例名是正常的,判它是假红)。
    const planGate = (nm) => "---\nphase: \"01\"\nplan: \"01\"\ngoal: 夹具计划:verify 引用的用例名必须真实存在\nrollback: 删掉夹具即可\nfiles_modified:\n  - a.mjs\n---\n\n# 01-01 PLAN\n\n### T1 改一个常量\n\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 改点东西。\n- **verify**: node --selfcheck && node -e 'const need = [\"" + nm + "\"]; console.log(need)'\n- **fails_when**: --selfcheck 退出码非 0\n- **done**: --selfcheck 输出里有该用例名\n";
    writeFileSync(join(dir, ".planning", "01-01-PLAN.md"), planGate("no-such-selftest-case-" + "zzz"));
    const p11 = run(["--plan", ".planning/01-01-PLAN.md"]);
    eqN(p11.code, 1, "d19gate-1 已收口票的 verify 引用了不存在的用例名 → --plan 退出码非 0");
    eqN(p11.out.includes("verify 引用的自测用例名不存在"), true, "d19gate-1 输出要说清是哪个用例名不存在");
    writeFileSync(join(dir, ".planning", "01-01-PLAN.md"), planGate("triplane-1"));
    const p12 = run(["--plan", ".planning/01-01-PLAN.md"]);
    eqN(p12.code, 0, "d19gate-2 名字真实存在 → 不判红(守「不是见 need 就判红」)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---- 角色边界机器层(phase 11 D-01/D-04):卡面白名单、复核卡纯只读、守卫 fail-closed、派发指名 ----
export function runBoundaryCases(st) {
  const { eqN } = st;
  const dir = mkdtempSync(join(tmpdir(), "mm-gsd-bound-"));
  mkdirSync(join(dir, "mm-gsd-plan"), { recursive: true });
  writeFileSync(join(dir, "mm-gsd-plan", "SKILL.md"), '---\ndescription: "探针用规划技能的简介"\n---\n# plan\n');
  const card = pointerCard({ skill: "mm-gsd-plan", skillPath: join(dir, "mm-gsd-plan", "SKILL.md"), routeCmd: "node x" });
  eqN(card.includes("tools: Read, Grep, Glob, Write"), true, "plan 卡含 tools 行(白名单)");
  const loopCard = pointerCard({ skill: "mm-gsd-loop", skillPath: join(dir, "mm-gsd-plan", "SKILL.md"), routeCmd: "node x" });
  eqN(loopCard.includes("tools:"), false, "loop 卡不设白名单(编排要派子代理)");
  const rc = reviewerCard({ routeCmd: "node x" });
  eqN(rc.includes("tools: Read, Grep, Glob") && !rc.includes("Write") && !rc.includes("Bash"), true, "reviewer 卡纯只读(无 Write)");
  eqN(REVIEW_PROMPT.includes("物理只读") && REVIEW_PROMPT.includes("调用方落盘"), true, "REVIEW_PROMPT 含调用方落盘(复核只读)");
  const guard = fileURLToPath(new URL("../hooks/guard-dangerous-git.mjs", import.meta.url));
  let st2 = 0;
  try { execFileSync(process.execPath, [guard], { input: "not-json", stdio: "pipe" }); }
  catch (e) { st2 = e.status ?? 1; }
  eqN(st2, 2, "守卫对非法输入判 2(fail-closed)");
  // 守卫的拦截口径逐条钉住(2026-11-19 修过一条:强删 -D 拦,安全删 -d 不拦 —— git 自己会拒绝删未合并的分支)
  const D = "-";
  const guardRc = (cmd) => {
    try { execFileSync(process.execPath, [guard], { input: JSON.stringify({ tool_input: { command: cmd } }), stdio: "pipe" }); return 0; }
    catch (e) { return e.status ?? 1; }
  };
  eqN(guardRc(`git branch ${D}D old`), 2, "守卫拦强删分支(-D)");
  eqN(guardRc(`git branch ${D}d old`), 0, "守卫放行安全删分支(-d,已合并的旧分支能清)");
  eqN(guardRc(`git update-ref ${D}d refs/heads/x`), 2, "守卫拦删引用(update-ref -d)");
  eqN(guardRc("git reset --hard HEAD"), 2, "守卫拦 reset --hard");
  eqN(guardRc("git clean -fd"), 2, "守卫拦 clean -f");
  eqN(guardRc("git stash"), 2, "守卫拦 stash 全族");
  eqN(guardRc("git checkout ."), 2, "守卫拦 checkout .(全量重置工作区)");
  eqN(guardRc("git push origin main --force"), 2, "守卫拦强推保护分支");
  eqN(guardRc("git push origin main --force-with-lease"), 0, "守卫放行 lease 强推(留的出路)");
    eqN(guardRc("git status"), 0, "守卫放行普通命令");
  rmSync(dir, { recursive: true, force: true });
}


// ---- 前提判红定位(#12):报错必须带来源/序号与上下文,人不用重写判据 ----
export function runPremiseLocateCases(st) {
  const { eqN } = st;
  const root = join(tmpdir(), "mm-gsd-premise-probe");
  const ts = [{ id: "07-01 T1", files: ["out.md"], readFirst: ["src/nope.mjs"], verify: "node out.md && cat src/nope2.mjs" }];
  const r = checkTicketPremises(ts, root);
  eqN(r.length, 2, "两个假前提各报一条");
  eqN(r[0].includes("read_first 第 1 条"), true, "判红带来源与序号(read_first)");
  eqN(r[1].includes("verify 第 2 条命令") && r[1].includes("cat src/nope2"), true, "判红带上下文(±20 字符)");
  eqN(r[0].includes("不在本票"), true, "豁免判定人话出现");
}
