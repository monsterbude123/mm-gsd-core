// 验收结论对账 —— 从 template-gates.mjs 里拆出来的第二个契约模块。
//
// 为什么拆:template-gates.mjs 的头注释写着「模板契约规则会越长越多」,而它是 200 行硬闸。
// 模板契约(结构/枚举/占位)和验收语义(正文判定 vs frontmatter status)是两回事:
//   template-gates  —— 工件长什么样
//   verification-gates —— 工件说的话可不可信
// 混在一起第一个就会顶破上限,所以拆。
//
// 为什么必须有:模板把「人工项非空时禁止 passed」写成了散文纪律,而机器只查 status 合法性。
// 实测过的假绿灯:正文 6 条 truth 里 4 条 ✗ FAILED、1 条 ? UNCERTAIN、人工区非空,
// frontmatter 写 status: passed / score: 6/6 —— gsd-state-check.mjs EXIT=0,phase 判完成。

const VERDICT_RE = [
  ["VERIFIED", /^[✓✔]\s*VERIFIED/i],
  ["FAILED", /^[✗✘]\s*FAILED/i],
  ["UNVERIFIED", /^⚠\s*PRESENT_BEHAVIOR_UNVERIFIED/i],
  ["UNCERTAIN", /^[?？]\s*UNCERTAIN/i],
];

/** 统计 Observable Truths 表的判定列。取第 3 格而非全行正则 —— 证据列里可能合法出现 FAILED 字样 */
function truthVerdicts(text) {
  const c = { VERIFIED: 0, FAILED: 0, UNVERIFIED: 0, UNCERTAIN: 0 };
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cell = t.split("|").slice(1, -1).map((s) => s.trim())[2] ?? "";
    if (/^(状态|status|verdict)$/i.test(cell)) continue;
    for (const [k, re] of VERDICT_RE) if (re.test(cell)) { c[k]++; break; }
  }
  return c;
}

/** Human Verification Required 小节里有几条真实条目(剔掉 <> 占位后仍有实质内容) */
function humanItems(text) {
  const m = text.match(/^##\s*Human Verification Required\s*$/m);
  if (!m) return 0;
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/\n##\s/);
  return (next < 0 ? rest : rest.slice(0, next))
    .split(/\r?\n/)
    .filter((l) => /^\s*[-*]\s*\[[ xX]?\]/.test(l) && l.replace(/<[^>]*>/g, "").replace(/[\s:：—。，,]/g, "").length >= 4)
    .length;
}

const scoreOf = (text) => {
  const m = text.match(/^score:\s*(\d+)\s*\/\s*(\d+)/m);
  return m ? { n: +m[1], d: +m[2] } : null;
};

/**
 * 验收结论一致性闸。只在 status 是 passed 时逐条对账 —— gaps_found / human_needed
 * 本来就承认有没验过的部分,拿它们去要求「全绿」是逼人把缺口藏起来。
 * 返回 [{message, fix, level}] —— level 为 "warn" 的不拦人。
 */
export function validateVerification(text, status) {
  const out = [];
  const add = (m, fix, level = "err") => out.push({ message: m, fix, level });
  const c = truthVerdicts(text);
  const parsed = c.VERIFIED + c.FAILED + c.UNVERIFIED + c.UNCERTAIN;

  if (status !== "passed") {
    if (status === "gaps_found" && !c.FAILED)
      add("声明 gaps_found 但正文找不到 ✗ FAILED 条目", "缺口要落到具体 truth;缺口只在工件层就在 Artifacts 表里标出来", "warn");
    return out;
  }
  // 一条判定都读不出来 = 格式跑偏或解析器失效。T-08:门禁读不到输入却放行,比误红危险得多。
  if (!parsed)
    return [{ message: "status=passed 但一条 truth 判定都解析不出", fix: "按模板写 Observable Truths 表,判定列用 ✓ VERIFIED / ✗ FAILED / ⚠ PRESENT_BEHAVIOR_UNVERIFIED / ? UNCERTAIN", level: "err" }];
  if (c.FAILED)
    add(`正文有 ${c.FAILED} 条 ✗ FAILED,却写 status: passed`, "有 FAILED 就是 gaps_found —— passed 要求每条 truth 都有行为证据");
  if (c.UNVERIFIED)
    add(`正文有 ${c.UNVERIFIED} 条 ⚠ PRESENT_BEHAVIOR_UNVERIFIED,却写 status: passed`, "这类没被任何测试真的触发过状态转移/清理/顺序,不算 verified 分数,只能 human_needed");
  if (c.UNCERTAIN)
    add(`正文有 ${c.UNCERTAIN} 条 ? UNCERTAIN,却写 status: passed`, "拿不到证据就如实 human_needed,别用 passed 盖过去");
  if (humanItems(text))
    add("Human Verification Required 里有真实条目,却写 status: passed", "人工项非空时只能 human_needed;确实没有人工项就写 None 并说明全部由程序验证");
  const s = scoreOf(text);
  if (s && c.VERIFIED < s.n)
    add(`score 写 ${s.n}/${s.d},正文只有 ${c.VERIFIED} 条 ✓ VERIFIED`, "score 是 VERIFIED 条数 / 总数,按正文实测写,不手填", "warn");
  return out;
}
