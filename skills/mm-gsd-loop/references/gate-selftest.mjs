// 门禁自测 —— 独立成文件,不塞进 gsd-state-check.mjs(自测是"门禁对自己的检查",不是"对项目的检查";混在一起行数很快顶破 700 上限)。跟 template-gates.mjs 一个套路:按需 import,主文件不胖。
// 为什么必须有:GitHub #6/#7/#8 三条都是"门禁看起来在跑、实际判错"(VAGUE_FILE 的 N\/A 无左右断言 /
// depends_on 只认半角括号 / derived 只判 SHIP 文件存在不读 status)—— 不是崩溃,是安静地给错答案。

import { validateVerification, checkTicketPremises, checkTicketLoad, checkReqClaims, checkReqCoverage, checkIssueLedger, checkDiscriminatingLints, checkBatchVerifyLints } from "./verification-gates.mjs";
import { checkDecisions, locateContexts, checkDrift, checkConclusionDrift } from "./decision-gates.mjs";
import { ticketsCovered } from "./ticket-alive.mjs";
import { mkAssert, runArtifactCases, runCoverageCases, runLedgerGateCases, runPhaseHealthCases, runRouteCases, runPlanReadyCases, runPlanCheckE2ECases, runBoundaryCases, runPremiseLocateCases } from "./selftest-suite.mjs";
import { researchRequired, researchCompliant, checkResearchConsumed, checkResearchSummary } from "./research-gates.mjs";
import { checkBatchGraph, checkTicketBudget } from "./worktree-view.mjs";
import { buildRouteBrief, pointerCard, listSkills } from "./agent-routing.mjs";
import { extractTemplateBlock } from "./template-gates.mjs";
import { runToolStats } from "./telemetry-aggregate.mjs";
import { mkdtempSync, writeFileSync, rmSync, utimesSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHECKER = fileURLToPath(new URL("../scripts/gsd-state-check.mjs", import.meta.url));

/** 跑一遍自测,返回失败条数 */
export function runSelfTest(VAGUE_FILE, DEP_RE, splitDeps) {
  const { eq, eqN, eqArr, st } = mkAssert();
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
  eqN(vt("passed", ["✓ VERIFIED", "❌ FAILED"], "None"), 1, "emoji ❌ FAILED 也该判红(第一版整行丢弃)");
  eqN(vt("passed", ["✓ VERIFIED", "FAILED"], "None"), 1, "裸 FAILED 也该判红");
  eqN(vt("passed", ["✓ VERIFIED", "✓ VERIFIED"], "- [ ] 视觉:导出按钮 hover 态 —— 期望:按钮变蓝"), 1, "模板实际的括号后缀标题要能触发人工项检查");
  // Artifacts 表第 3 格是 exists/substantive,内容是 ✓ 或「212 行」—— 不该被当成判定行
  eqN(vt("passed", ["✓ VERIFIED", "✓ VERIFIED"], "None", "| Artifact | exists | substantive | wired |\n|---|---|---|---|\n| src/a.ts | ✓ | ✓ 212 行 | ✓ |"), 0, "Artifacts 表不该被误判成判定行");
  // 人工项清单不能把**粗体段落**当条目 —— 否则以 `**结论**` 收尾的 passed 报告会被误判成「有人工项」
  eqN(vt("passed", ["✓ VERIFIED", "✓ VERIFIED"], "None —— 全部由程序验证\n**结论**: 没有人工项"), 0, "粗体结论段落不算人工项");
  // decision-gates 的可逆性契约此前零自测覆盖。coveredIds 是本 phase 全部票的 covers 并集
  const dc = (md, refs) => { const errs = []; checkDecisions({ name: "t", ctxText: md, coveredIds: refs, e: (a) => errs.push(a) }); return errs.length; };
  eqN(dc("<decisions>\n### [D-01] 用 JWT,不用 session\n</decisions>", ["D-01"]), 1, "决策没标可逆性该判红");
  eqN(dc("<decisions>\n### [D-01] one-way — 改成新架构\n</decisions>", ["D-01"]), 1, "one-way 没举证该判红");
  eqN(dc("<decisions>\n### [D-01] reversible — 用 JWT\n### [D-02] costly — 引入 X,撤销需要 migration\n</decisions>", ["D-01", "D-02"]), 0, "标记齐全不该误伤");
  // 02-03:四种书写形态都要被「认出」—— 认不出的决策既不核销也不过可逆性门
  eqN(dc("<decisions>\n**[D-01]** 用 JWT\n</decisions>", ["D-01"]), 1, "粗体 ** 决策也要被认");
  eqN(dc("<decisions>\n### [d-01] 用 JWT\n</decisions>", ["D-01"]), 1, "小写 ID 也要被认");
  eqN(dc("<decisions>\n- [D-01] 用 JWT\n</decisions>", ["D-01"]), 1, "列表项决策也要被认");
  // 02-03:否定句不是举证。「不改 X」恰恰说明这条决策可逆,当成举证就把 D-03 变成仪式
  eqN(dc("<decisions>\n### [D-01] one-way — 本次不改 contract,保持现有 schema 不变\n</decisions>", ["D-01"]), 1, "「不改 contract」不算不可逆举证");
  // 02-03:举证范围到下一级标题为止,不能从后一节借用 migration 字样
  eqN(dc("<decisions>\n### [D-01] one-way — 撤销很麻烦\n\n## 备注\n\n这里提到 migration\n</decisions>", ["D-01"]), 1, "不能从后一节借用举证");
  eqN(dc("<decisions>\n### [D-01] one-way — 换掉存储层\n\n撤销需要 migration 03 重写全部数据。\n</decisions>", ["D-01"]), 0, "真举证不该误伤");
  // 标题行自带载体词但正文零举证 → 该红(G-01)。上面这条的对照:同样载体词,写在正文里就过。
  eqN(dc("<decisions>\n### [D-01] one-way — 换掉存储层\n\n这个决定改动不大。\n</decisions>", ["D-01"]), 1, "标题提到代价不算举证,正文零举证该红");
  // G-01(02-06,fixture 来自独立对抗评审):举证区此前从**标题行本身**起算,把载体词挪到标题就绕过(本仓自己引入的假绿);头一条是对照:标题中性时同样内容必须红。
  eqN(dc("<decisions>\n## [D-01] 调整存储方案 (one-way)\n\n执行者照做即可。\n</decisions>", ["D-01"]), 1, "对照:标题中性+正文零举证该红");
  eqN(dc("<decisions>\n## [D-01] 采用一次性迁移 (one-way)\n\n执行者照做即可。\n</decisions>", ["D-01"]), 1, "载体词写在标题里不算举证");
  eqN(dc("<decisions>\n## [D-01] 调整 schema (one-way)\n\n执行者照做即可。\n</decisions>", ["D-01"]), 1, "标题里的 schema 不算举证");
  eqN(dc("<decisions>\n### [D-01] one-way — 锁定 contract\n</decisions>", ["D-01"]), 1, "标题尾部的 contract 不算举证");
  // locateContexts 必须返回**全部** CONTEXT:早先用 .find(),字母序靠后的 phase 既不核销也不过可逆性门,而门禁看起来一切正常。这两条锁死「只查一份」。
  const ctxDir = mkdtempSync(join(tmpdir(), "mm-gsd-ctx-"));
  writeFileSync(join(ctxDir, "01-CONTEXT.md"), "x");
  writeFileSync(join(ctxDir, "02-CONTEXT.md"), "x");
  writeFileSync(join(ctxDir, "03-CONTEXT.md"), "x");
  writeFileSync(join(ctxDir, "CONTEXT.md"), "x");
  const found = locateContexts([ctxDir]).map((c) => c.file).sort();
  eqArr(found, ["01-CONTEXT.md", "02-CONTEXT.md", "03-CONTEXT.md"], "多份 CONTEXT 必须全部返回,且裸名 CONTEXT.md 不算");
  // 同一目录以相对与绝对两种写法传入时不得重复计数
  const dup = locateContexts([ctxDir, ctxDir]).length;
  eqN(dup, found.length, "同一目录重复传入不得产生重复条目");
  rmSync(ctxDir, { recursive: true, force: true });
  // ---- 漂移门此前**零会红用例**,而 gate-cases.json 声称三条各有用例 —— 台账登记是假的(R-16 就是拦这种事,T-03)。
  const tck = (text, ticket) => ticketsCovered([{ file: "x-SUMMARY.md", text }], ticket);
  eqN(tck('---\nphase: "02"\nplan: "01"\n---\n', "02-01"), true, "SUMMARY 的 plan 后缀匹配该票该判已完成");
  eqN(tck('---\nphase: "02"\nplan: "03,04,05"\n---\n', "02-03"), true, "一份 SUMMARY 覆盖多票时前三票都算完成(本仓真实格式)");
  eqN(tck('---\nphase: "02"\nplan: "03,04,05"\n---\n', "02-05"), true, "一份 SUMMARY 覆盖多票时最后一票也算完成");
  eqN(tck('---\nphase: "02"\nplan: "01"\n---\n', "02-02"), false, "plan:\"01\" 不该匹配 02-02 —— phase 与后缀必须都对上");
  eqN(tck('---\nphase: "03"\nplan: "01"\n---\n', "02-01"), false, "phase 不同不该匹配");
  eqN(tck('---\nphase: "01"\nstatus: complete\n---\n', "01-01"), false, "无 plan 字段的 SUMMARY 不作数(fail-closed,01-01 就是这种)");
  // 漂移门本体:PLAN 早于 CONTEXT 判红,不早于不判红
  const dDir = mkdtempSync(join(tmpdir(), "mm-gsd-drift-"));
  const planF = join(dDir, "p.md"), ctxF = join(dDir, "c.md");
  writeFileSync(planF, "x"); writeFileSync(ctxF, "y");
  const dr = () => { const errs = []; checkDrift({ name: "t", planPath: planF, ctxPath: ctxF, e: (a) => errs.push(a), w: () => {} }); return errs.length; };
  // 按天拉开口子:NTFS 的 mtime 精度粗,相差几百毫秒会量化到同一档,「更早」与「不更早」测出来一样(踩过两次)。
  const DAY = 86400000, at = (d) => new Date(Date.UTC(2020, 0, 1 + d));
  const set = (f, d) => utimesSync(f, at(d), at(d));
  set(planF, 1); set(ctxF, 2);
  eqN(dr(), 1, "工件早于 CONTEXT 该判红(漂移门会红,此前无任何用例证明)");
  set(planF, 3);
  eqN(dr(), 0, "工件不早于 CONTEXT 不该判红");
  set(ctxF, 3);
  eqN(dr(), 0, "mtime 相等不算漂移(同一次写入)");
  // 结论件漂移(D-04 要求四类工件)。这条用例存在的直接原因:checkConclusionDrift 少 import readFileSync,health 全绿而该分支从未被执行 —— 主流程不经过的分支,语法检查抓不到。
  const cF = join(dDir, "02-VERIFICATION.md"), cS = join(dDir, "02-SHIP.md"), cC = join(dDir, "02-CONTEXT.md");
  writeFileSync(cF, '---\nstatus: passed\n---\n'); writeFileSync(cS, '---\nstatus: shipped\n---\n'); writeFileSync(cC, "y");
  // 时间戳要拉得开:NTFS 的 mtime 精度粗,几百毫秒就量化到同一档,「工件更早」与「不比 CONTEXT 新」测出来一模一样。按天分。
  const pin = () => { set(cF, 1); set(cS, 1); };   // 改写内容会刷新 mtime,测漂移前必须按回去
  pin(); set(cC, 2);
  const cd3 = (items) => checkConclusionDrift({ ctxPath: cC, items });
  eqN(cd3([{ kind: "验收", file: "02-VERIFICATION.md", path: cF }])[0]?.level, "warn", "已 passed 的验收件早于 CONTEXT 该报但只警告(恒红的门等于没有门)");
  eqN(cd3([{ kind: "交付", file: "02-SHIP.md", path: cS }])[0]?.level, "warn", "已 shipped 的交付件同理只警告");
  writeFileSync(cS, '---\nstatus: draft\n---\n'); pin();
  eqN(cd3([{ kind: "交付", file: "02-SHIP.md", path: cS }])[0]?.level, "error", "未定稿的结论件早于 CONTEXT 该拦红");
  // 反向:CONTEXT 被更新到比结论件更晚之后,旧结论件**仍然**该报漂移(它确实过时了)—— 更新 CONTEXT 不是让它变新鲜,是让它更旧。
  writeFileSync(cS, '---\nstatus: shipped\n---\n');   // 复位:上一条把它改成 draft 了,未定稿会走 error
  set(cC, 3); pin();
  eqN(cd3([{ kind: "验收", file: "02-VERIFICATION.md", path: cF }])[0]?.level, "warn", "CONTEXT 更新后旧验收件该报漂移(它确实过时了)");
  eqN(cd3([{ kind: "交付", file: "02-SHIP.md", path: cS }])[0]?.level, "warn", "同样地:旧交付件该报漂移");
  // 真正不该报的是反过来:结论件比 CONTEXT 新(重跑过验收 / 重新交付过)
  set(cC, 1); set(cF, 5); set(cS, 5);
  eqN(cd3([{ kind: "验收", file: "02-VERIFICATION.md", path: cF }]).length, 0, "重跑过的验收件不比 CONTEXT 早时不该报");
  eqN(cd3([{ kind: "交付", file: "02-SHIP.md", path: cS }]).length, 0, "重新交付过的 SHIP 不该报");
  rmSync(dDir, { recursive: true, force: true });
  // ---- 工件三态 + 记账台账 + 决策核销 + 分发包记账门:在 selftest-suite.mjs 里(本文件 200/200 顶格,用例只会继续长)。
  runArtifactCases({ eqN, eqArr });
  runPlanReadyCases({ eqN });
  runPlanCheckE2ECases({ eqN });
  runBoundaryCases({ eqN });
  runPremiseLocateCases({ eqN });
  runCoverageCases({ eqN, eqArr });
  runLedgerGateCases({ eqN });
  runPhaseHealthCases({ eqN });
  runRouteCases({ eqN });
  // 模板块必须认 CRLF:Git for Windows 的系统级 core.autocrlf=true(不在仓库里)让新克隆全是 CRLF
  // —— 只认 \n 的正则会让六份模板在每个 Windows 用户机器上一起假红。
  eqN(extractTemplateBlock("```markdown\r\nx\r\n```") !== null, true, "CRLF 模板也抽得出 ```markdown 块");
  eqN(extractTemplateBlock("```markdown\nx\n```") !== null, true, "LF 模板照抽");
  eqN(extractTemplateBlock("没有代码块") !== null, false, "没有块就老实说没有");
  // ---- 宿主路由提示(phase 04):速查必须机器读出,卡里不许有规则原文 ----
  const d2 = mkdtempSync(join(tmpdir(), "mm-gsd-route-"));
  mkdirSync(join(d2, ".agents", "rules"), { recursive: true });
  writeFileSync(join(d2, ".agents", "rules", "ledger.json"), JSON.stringify({ rules: [{ id: "R-01", status: "active", statement: "进 main 的改变必须能追溯到 issue" }, { id: "R-02", status: "candidate", statement: "还没生效" }] }));
  writeFileSync(join(d2, "budget.json"), JSON.stringify({ fileCaps: [{ pattern: "skills/**/*.mjs", max: 700 }] }));
  const sk2 = join(d2, "skills"); mkdirSync(join(sk2, "mm-gsd-plan"), { recursive: true });
  writeFileSync(join(sk2, "mm-gsd-plan", "SKILL.md"), "---\ndescription: \"探针用规划技能的简介\"\n---\n# plan\n");
  const br = buildRouteBrief({ stage: "plan", skillsRoot: sk2, projectRoot: d2, home: d2, activePhase: null });
  eqN(br.quick.rules.length, 1, "速查只列 active 规则,条数与台账一致");
  eqN(br.quick.rules[0].text.includes("追溯到 issue"), true, "速查的规则文本来自台账,不是手写");
  eqN(br.quick.caps.length, 1, "单文件上限从 budget.json 读出");
  const card = pointerCard({ skill: "mm-gsd-plan", skillPath: join(sk2, "mm-gsd-plan", "SKILL.md"), routeCmd: "node x" });
  eqN(card.includes("探针用规划技能的简介"), true, "卡片的 description 现读自该技能 SKILL.md —— 派发器靠它决定派不派");
  eqN(card.includes("追溯到 issue"), false, "指针卡里不许有规则原文(那是第二真相源)");
  // 上一条只盯着**这一句**:塞进别的规则照样放行 —— 守的应是「不重复任何规则」这个不变式
  eqN(/\bR-\d\d\b/.test(card) || JSON.parse(readFileSync(join(d2, ".agents", "rules", "ledger.json"), "utf8")).rules.some((r) => card.includes(r.statement)), false, "指针卡里不许出现台账里任何一条规则的原文或编号");
  const noT = buildRouteBrief({ stage: "plan", skillsRoot: sk2, projectRoot: join(d2, "none"), home: d2, activePhase: null });
  eqN(noT.quick.rules.length, 0, "项目没有台账 → 速查为空,不补写");
  eqN(noT.quick.notes.length, 2, "台账与预算都读不到时,各说一条「没有」");
  // 真机装卡时抓到的:安装器留的旧版备份目录 mm-gsd-xxx.bak-mmgsd 也以 mm-gsd- 开头,只按前缀挑会发 12 张卡
  mkdirSync(join(sk2, "mm-gsd-plan.bak-mmgsd"), { recursive: true });
  eqN(listSkills(sk2).length, 1, "备份目录(.bak-mmgsd)不算技能,否则指针卡会发 12 张"); rmSync(d2, { recursive: true, force: true });
  // ---- 研究触发(D-03):触发条件必须可数 ——「总是触发」等于给每个 phase 加一道必过的门(T-13) ----
  eqN(researchRequired({ files: ["a/x.ts"] }).required, false, "单文件 → 不触发研究");
  eqN(researchRequired({ files: ["a/x.ts", "b/y.ts", "c/z.ts"] }).required, true, "跨 3 个顶层目录 → 触发研究");
  eqN(researchRequired({ files: ["a/x.ts"], unseenDirs: ["a"] }).required, true, "git 历史里没有的目录 → 触发研究");
  eqN(researchRequired({ files: ["docs/b.md"], unseenDirs: ["docs"] }).reasons[0].includes("docs/b.md"), false, "陌生目录的报错列目录,不列文件路径");
  eqN(researchRequired({ files: ["a/x.ts"], goal: "先深入了解这个模块" }).required, true, "goal 明写深入了解 → 触发研究");
  eqN(researchRequired({ files: ["a/x.ts", "b/y.ts"], goal: "补个字段" }).required, false, "两个目录 + 没有陌生领域 → 不触发");
  eqN(researchCompliant("读了很多文件,收获很大").ok, false, "空洞研究不算合规(读了很多文件不能自证读对了)");
  eqN(researchCompliant("见 src/gate-evidence.cts:6 的三态定义").ok, true, "带 file:line 引用的研究算合规");
  eqN(researchCompliant("详见 https://example.com:8080/x").ok, false, "URL 里的端口号不算引用");
  // ---- 研究消费门(phase 07 D-02):研究落盘了没人读 = 执行端会自己重查一遍 ----
  const d3 = mkdtempSync(join(tmpdir(), "mm-gsd-rcons-"));
  mkdirSync(join(d3, ".planning"), { recursive: true }); writeFileSync(join(d3, ".planning", "08-RESEARCH.md"), "见 src/a.cts:3 的结论\n");
  const rc = (txt) => { const errs = []; checkResearchConsumed({ name: "08-01-PLAN.md", phase: "08", root: d3, text: txt, e: (m) => errs.push(m), w: () => {} }); return errs; };
  eqN(rc("read_first: src/a.mjs").length, 1, "有研究产物 + 票没引用它 → 判红(研究落盘了没人读)");
  eqN(rc("read_first: .planning/08-RESEARCH.md, src/a.mjs").length, 0, "票里点名了研究产物 → 转绿"); rmSync(d3, { recursive: true, force: true });
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
  // ---- 判别力 lint(#10):只判「退出码被吞」;裸 grep -c 是家常正确形状 ----
  eqN(checkDiscriminatingLints([{ id: "T1", verify: "n=$(cat t.md | grep -c foo)" }]).length, 1, "lint 命中捕获式 grep -c(报 WARNING)");
  eqN(checkDiscriminatingLints([{ id: "T1", verify: "grep -c foo t.md || true" }]).length, 1, "lint 命中吞退出码(报 WARNING)");
  eqN(checkDiscriminatingLints([{ id: "T1", verify: "grep -c foo t.md" }]).length, 0, "裸 grep -c 不误报(零匹配即红)");
  eqN(checkDiscriminatingLints([{ id: "T1", verify: "cargo test --test skills_bundle" }]).length, 0, "具名 cargo test 不误报");
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
  console.log(st.bad ? `\n${st.bad} 项自测不过 —— 门禁本身是坏的,先修门禁` : "\n✓ 门禁自测全过");
  return st.bad;
}
