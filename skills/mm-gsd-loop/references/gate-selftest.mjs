// 门禁自测 —— 独立成文件,不塞进 gsd-state-check.mjs(自测是"门禁对自己的检查",不是"对项目的检查";混在一起行数很快顶破 700 上限)。跟 template-gates.mjs 一个套路:按需 import,主文件不胖。
// 为什么必须有:GitHub #6/#7/#8 三条都是"门禁看起来在跑、实际判错"(VAGUE_FILE 的 N\/A 无左右断言 /
// depends_on 只认半角括号 / derived 只判 SHIP 文件存在不读 status)—— 不是崩溃,是安静地给错答案。

import { validateVerification, checkTicketPremises, checkTicketLoad, checkReqClaims } from "./verification-gates.mjs";
import { checkDecisions, locateContexts, checkDrift, checkConclusionDrift } from "./decision-gates.mjs";
import { ticketsCovered } from "./ticket-alive.mjs";
import { mkAssert, runArtifactCases, runCoverageCases, runLedgerGateCases, runPhaseHealthCases, runRouteCases } from "./selftest-suite.mjs";
import { researchRequired, researchCompliant, checkResearchConsumed, checkResearchSummary } from "./research-gates.mjs";
import { checkBatchGraph, checkTicketBudget } from "./worktree-view.mjs";
import { buildRouteBrief, pointerCard, listSkills } from "./agent-routing.mjs";
import { extractTemplateBlock } from "./template-gates.mjs";
import { mkdtempSync, writeFileSync, rmSync, utimesSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  eqN(checkReqClaims([{ id: "T1", covers: ["REQ-1"] }], d4).length, 0, "认领真实存在的 REQ → 转绿"); rmSync(d4, { recursive: true, force: true });
  console.log(st.bad ? `\n${st.bad} 项自测不过 —— 门禁本身是坏的,先修门禁` : "\n✓ 门禁自测全过");
  return st.bad;
}
