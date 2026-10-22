// 门禁自测 —— 独立成文件,不塞进 gsd-state-check.mjs。
//
// 为什么单独放:自测是"门禁对自己的检查",不是"对项目的检查"。
// 两者混在一个文件里,行数很快顶破 700 上限(实测 git 历史峰值 699,2026-10-19 就顶过)。
// 这里原本写的是「顶过 713」——逐提交数过,gsd-state-check.mjs 从没到过 713 行。
// 行数会变,写死就是个会变假的数字;真实值跑 `mmc budget` 看。
// 跟 template-gates.mjs 一个套路:按需 import,主文件不胖。
//
// 为什么必须有:GitHub #6/#7/#8 三条都是"门禁看起来在跑、实际判错"——
//   #6 VAGUE_FILE 的 N\/A 无左右断言,把 admin/ 路径全判成模糊项
//   #7 depends_on 只认半角括号,中文 STATE.md 的整条依赖链解析为空
//   #8 derived 只判 SHIP 文件存在、不读 status,held 被推成 shipped
// 三条都不是崩溃,是安静地给错答案。T-03 说门禁上线前必须先证明它会红,
// 而"会红"只能靠这些用例证明。

import { validateVerification } from "./verification-gates.mjs";
import { checkDecisions, locateContexts, checkDrift, checkConclusionDrift } from "./decision-gates.mjs";
import { ticketsCovered } from "./ticket-alive.mjs";
import { classifyArtifact, parseAccounting, commitExists } from "./artifact-ledger.mjs";
import { mkAssert } from "./selftest-helpers.mjs";
import { extractTemplateBlock } from "./template-gates.mjs";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "node:fs";
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
  // 验收结论一致性闸:一条证明会红,一条证明不误伤。
  // 只测「会红」不够 —— 只会红的门禁等于把所有人都判死,没人会当它是对的。
  // 小节标题逐字抄自 templates/verification.md —— 含那个括号后缀。第一版这里写的是裸标题,
  // 于是自测永远绿,而真实报告(照模板写)永远不触发这条检查:测试与实现同时偏离了 spec,
  // 而且互相印证,谁也发现不了。这正是本轮最大的那条教训。
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
  // 下面四条用「闸作者模板之外」的输入(2026-10-20 教训):第一版自测的 fixture 是我自己
  // 照模板写的,于是模板与闸互不兼容这件事永远暴露不出来 —— 两者会一起错,谁也发现不了。
  // 标题逐字取自 templates/verification.md,符号取自评审给的绕过输入。
  eqN(vt("passed", ["✓ VERIFIED", "❌ FAILED"], "None"), 1, "emoji ❌ FAILED 也该判红(第一版整行丢弃)");
  eqN(vt("passed", ["✓ VERIFIED", "FAILED"], "None"), 1, "裸 FAILED 也该判红");
  eqN(vt("passed", ["✓ VERIFIED", "✓ VERIFIED"], "- [ ] 视觉:导出按钮 hover 态 —— 期望:按钮变蓝"), 1, "模板实际的括号后缀标题要能触发人工项检查");
  // Artifacts 表第 3 格是 exists/substantive,内容是 ✓ 或「212 行」—— 不该被当成判定行
  eqN(vt("passed", ["✓ VERIFIED", "✓ VERIFIED"], "None", "| Artifact | exists | substantive | wired |\n|---|---|---|---|\n| src/a.ts | ✓ | ✓ 212 行 | ✓ |"), 0, "Artifacts 表不该被误判成判定行");
  // decision-gates 的可逆性契约此前零自测覆盖 —— 改坏了没有任何东西能发现
  const dc = (md, refs) => { const errs = []; checkDecisions({ name: "t", ctxText: md, planDecisions: refs, e: (a) => errs.push(a) }); return errs.length; };
  eqN(dc("<decisions>\n### [D-01] 用 JWT,不用 session\n</decisions>", ["D-01"]), 1, "决策没标可逆性该判红");
  eqN(dc("<decisions>\n### [D-01] one-way — 改成新架构\n</decisions>", ["D-01"]), 1, "one-way 没举证该判红");
  eqN(dc("<decisions>\n### [D-01] reversible — 用 JWT\n### [D-02] costly — 引入 X,撤销需要 migration\n</decisions>", ["D-01", "D-02"]), 0, "标记齐全不该误伤");
  // 02-03:四种书写形态都要被「认出」—— 认不出的决策既不核销也不过可逆性门,是最坏的隐形
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
  // G-01(02-06,fixture 来自独立对抗评审而非本仓自造):举证区此前从**标题行本身**起算,
  // 于是把载体词从正文挪到标题就绕过举证检查 —— 本仓自己引入的假绿。
  // 头一条是对照:标题中性时同样内容必须红,证明这不是措辞问题而是取样范围问题。
  eqN(dc("<decisions>\n## [D-01] 调整存储方案 (one-way)\n\n执行者照做即可。\n</decisions>", ["D-01"]), 1, "对照:标题中性+正文零举证该红");
  eqN(dc("<decisions>\n## [D-01] 采用一次性迁移 (one-way)\n\n执行者照做即可。\n</decisions>", ["D-01"]), 1, "载体词写在标题里不算举证");
  eqN(dc("<decisions>\n## [D-01] 调整 schema (one-way)\n\n执行者照做即可。\n</decisions>", ["D-01"]), 1, "标题里的 schema 不算举证");
  eqN(dc("<decisions>\n### [D-01] one-way — 锁定 contract\n</decisions>", ["D-01"]), 1, "标题尾部的 contract 不算举证");
  // locateContexts 必须返回**全部** CONTEXT,不是第一个。早先用 .find(),
  // 于是字母序靠后的 phase 的决策既不核销也不过可逆性门,而门禁看起来一切正常。
  // 这两条锁死「只查一份」这个形状:少返回一份就红。
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
  // ---- 漂移门此前**零会红用例**,而 tools/gate-cases.json 声称「核销、可逆性、漂移三条
  // 各有用例」。台账登记是假的 —— R-16 的整个存在意义就是拦住这种事(T-03)。
  // fixture 用本仓真实工件格式:phase 与 plan 分两个字段,plan 存票号后缀。
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
  // 按天拉开口子:NTFS 的 mtime 精度较粗,相差几百毫秒会被量化到同一档,
  // 于是「更早」与「不更早」两种情形测出来一样 —— 这条坑我踩过两次。
  const DAY = 86400000, at = (d) => new Date(Date.UTC(2020, 0, 1 + d));
  const set = (f, d) => utimesSync(f, at(d), at(d));
  set(planF, 1); set(ctxF, 2);
  eqN(dr(), 1, "工件早于 CONTEXT 该判红(漂移门会红,此前无任何用例证明)");
  set(planF, 3);
  eqN(dr(), 0, "工件不早于 CONTEXT 不该判红");
  set(ctxF, 3);
  eqN(dr(), 0, "mtime 相等不算漂移(同一次写入)");
  // 结论件漂移(D-04 要求四类工件)。这条用例存在的直接原因:
  // checkConclusionDrift 里少 import 了 readFileSync,health 全绿而该分支从未被执行 ——
  // 「主流程不经过的分支不会被 R-04 的语法检查抓到」。没有用例就还会再漏一次。
  const cF = join(dDir, "02-VERIFICATION.md"), cS = join(dDir, "02-SHIP.md"), cC = join(dDir, "02-CONTEXT.md");
  writeFileSync(cF, '---\nstatus: passed\n---\n'); writeFileSync(cS, '---\nstatus: shipped\n---\n'); writeFileSync(cC, "y");
  // 时间戳要拉得开:Windows 上 NTFS 的 mtime 精度较粗,相差几百毫秒会被量化到同一档,
  // 于是「工件更早」与「工件不比 CONTEXT 新」两种情形测出来一模一样。这里按天分。
  const pin = () => { set(cF, 1); set(cS, 1); };   // 改写内容会刷新 mtime,测漂移前必须按回去
  pin(); set(cC, 2);
  const cd3 = (items) => checkConclusionDrift({ ctxPath: cC, items });
  eqN(cd3([{ kind: "验收", file: "02-VERIFICATION.md", path: cF }])[0]?.level, "warn", "已 passed 的验收件早于 CONTEXT 该报但只警告(恒红的门等于没有门)");
  eqN(cd3([{ kind: "交付", file: "02-SHIP.md", path: cS }])[0]?.level, "warn", "已 shipped 的交付件同理只警告");
  writeFileSync(cS, '---\nstatus: draft\n---\n'); pin();
  eqN(cd3([{ kind: "交付", file: "02-SHIP.md", path: cS }])[0]?.level, "error", "未定稿的结论件早于 CONTEXT 该拦红");
  // 反向:CONTEXT 被更新到比结论件更晚之后,旧结论件**仍然**该报漂移 —— 它确实过时了。
  // 这里原写成「不该报」,是把方向搞反了:更新 CONTEXT 不是让结论件变新鲜,是让它更旧。
  writeFileSync(cS, '---\nstatus: shipped\n---\n');   // 复位:上一条把它改成 draft 了,未定稿会走 error
  set(cC, 3); pin();
  eqN(cd3([{ kind: "验收", file: "02-VERIFICATION.md", path: cF }])[0]?.level, "warn", "CONTEXT 更新后旧验收件该报漂移(它确实过时了)");
  eqN(cd3([{ kind: "交付", file: "02-SHIP.md", path: cS }])[0]?.level, "warn", "同样地:旧交付件该报漂移");
  // 真正不该报的是反过来:结论件比 CONTEXT 新(重跑过验收 / 重新交付过)
  set(cC, 1); set(cF, 5); set(cS, 5);
  eqN(cd3([{ kind: "验收", file: "02-VERIFICATION.md", path: cF }]).length, 0, "重跑过的验收件不比 CONTEXT 早时不该报");
  eqN(cd3([{ kind: "交付", file: "02-SHIP.md", path: cS }]).length, 0, "重新交付过的 SHIP 不该报");
  rmSync(dDir, { recursive: true, force: true });
  // ---- 工件三态(D-01):三份 fixture 判出三个不同结论,且互斥 ----
  // 互斥是硬要求:两种毛病同时存在时若能返回两种态,调用方就得自己决定先修哪个,
  // 判定就退化成建议 —— 那正是「建议」与「判定」的分界。
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
  // 模板块必须认 CRLF:Git for Windows 的**系统级** core.autocrlf=true(不在仓库里,
  // 在 Git 安装目录的 etc/gitconfig)让 Windows 的新克隆全是 CRLF —— 只认 \n 的正则
  // 会让六份模板在每个 Windows 用户机器上一起假红,而这条门禁每次提交都跑。
  eqN(extractTemplateBlock("```markdown\r\nx\r\n```") !== null, true, "CRLF 模板也抽得出 ```markdown 块");
  eqN(extractTemplateBlock("```markdown\nx\n```") !== null, true, "LF 模板照抽");
  eqN(extractTemplateBlock("没有代码块") !== null, false, "没有块就老实说没有");
  console.log(st.bad ? `\n${st.bad} 项自测不过 —— 门禁本身是坏的,先修门禁` : "\n✓ 门禁自测全过");
  return st.bad;
}
