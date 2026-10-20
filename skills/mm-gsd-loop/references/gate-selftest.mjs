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
import { checkDecisions, locateContexts } from "./decision-gates.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** 跑一遍自测,返回失败条数 */
export function runSelfTest(VAGUE_FILE, DEP_RE, splitDeps) {
  let bad = 0;
  const eq = (re, s, want, why) => {
    const got = re.test(s), good = got === want;
    if (!good) bad++;
    console.log(`  ${good ? "✓" : "✗"} ${why}: ${JSON.stringify(s)} → ${got}`);
  };
  const eqN = (got, want, why) => {
    const good = got === want;
    if (!good) bad++;
    console.log(`  ${good ? "✓" : "✗"} ${why}: ${got} → ${good ? "" : want}`);
  };
  const eqArr = (got, want, why) => {
    const good = JSON.stringify(got) === JSON.stringify(want);
    if (!good) bad++;
    console.log(`  ${good ? "✓" : "✗"} ${why}: ${JSON.stringify(got)} → ${good ? "" : JSON.stringify(want)}`);
  };
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
  eqN(dc("<decisions>\n### [D-01] one-way — 撤销需要 migration 03 重写\n</decisions>", ["D-01"]), 0, "真举证不该误伤");
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
  console.log(bad ? `\n${bad} 项自测不过 —— 门禁本身是坏的,先修门禁` : "\n✓ 门禁自测全过");
  return bad;
}
