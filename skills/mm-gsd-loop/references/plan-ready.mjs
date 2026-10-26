// 开工判定 —— 一份 PLAN 现在能不能开工。
//
// 为什么独立成文件:它判的是**预审工件**(另一族契约),不是「工件记账」。
// 塞进 artifact-ledger.mjs 会让那个文件的职责从「记账」滑向「开工判定」——
// 语义不对的地方迟早长出不对的代码(phase 10 预审 W2)。2026-10-26 体积硬顶退役
// (见 docs/theory.md T-16)之后,新模块不再需要为「塞得进哪个文件」而委屈。
//
// fail-closed 是本文件的全部纪律:工件缺失 / status 非法 / status 非 passed /
// plan 票号对不上 / passed 却计数非零 —— 五种一律判「不能开工」。
// 看不清的状态不能当通过:**门禁看不懂 ≠ 门禁放行**。

import { existsSync, readFileSync } from "node:fs";

/** 极简 frontmatter 解析(只要 status/plan/blockers/warnings 四个字段,不值得共用别人的实现) */
function frontmatter(text) {
  const m = String(text ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "").replace(/\s+#.*$/, "");
  }
  return out;
}

/** 派预审的提示词。判据在 mm-gsd-verify「执行前预审」节,这里只给调用形状 */
export const REVIEW_PROMPT = [
  "按 mm-gsd-verify 的「执行前预审」节复核下面这份 PLAN:",
  "  · 只读 CONTEXT / PLAN / REQ,不看写它的过程(自己写自己审不算数)",
  "  · 每条发现带 severity(BLOCKER/WARNING/INFO);缺 severity 一律当 BLOCKER",
  "  · 只报发现,不处方 —— 改法归写票的人",
  "  · 结论写进 <PLAN 同名>-PLAN-CHECK.md:status(passed|blocked)/blockers/warnings/plan",
].join("\n");

/**
 * 开工判定。state: passed|blocked|missing|invalid;problems 逐条带改法。
 * 只读不写 —— 结论只能由独立的只读子代理落盘,脚本能写就等于自己判自己(D-04)。
 */
export function checkPlanReady({ planPath }) {
  const base = planPath.split(/[\\/]/).pop();
  const cf = planPath.replace(/-PLAN\.md$/, "-PLAN-CHECK.md");
  const problems = [];
  if (!existsSync(cf)) {
    problems.push({ msg: `${base}: 没有预审结论(${cf.split(/[\\/]/).pop()})—— 机械合规过了不等于这份计划成立`, fix: "派一个全新上下文的只读子代理做预审,结论落盘到该文件" });
    return { state: "missing", problems };
  }
  const fm = frontmatter(readFileSync(cf, "utf8")), st = String(fm.status ?? "");
  if (!["passed", "blocked"].includes(st)) {
    problems.push({ msg: `${base}: 预审结论 status 非法("${st || "缺"}")`, fix: "工件形状:status(passed|blocked)/blockers/warnings/plan" });
    return { state: "invalid", problems };
  }
  const blockers = Number(fm.blockers ?? 0) || 0, warnings = Number(fm.warnings ?? 0) || 0;
  if (fm.plan && fm.plan !== base.replace(/-PLAN\.md$/, "")) problems.push({ msg: `${base}: 预审结论指向别的票(plan: ${fm.plan})`, fix: "别复用别的票的结论 —— 重审这张票" });
  if (st === "blocked") problems.push({ msg: `${base}: 预审 status=blocked —— 有 BLOCKER 没清零就不许开工`, fix: "把 findings 交回 mm-gsd-plan 修,复审一次(≤2 轮)再跑本命令" });
  else if (blockers || warnings) problems.push({ msg: `${base}: 预审 status=passed 却 blockers=${blockers}/warnings=${warnings} —— 自相矛盾`, fix: "passed 的条件是零 BLOCKER 且零 WARNING(INFO 照列但不挡)" });
  return { state: problems.length ? "blocked" : "passed", problems, blockers, warnings };
}

/** 显式校验的结论行。判定与渲染都在这里,主脚本只留接线 */
export function renderPlanReady({ review = [], ok = false }) {
  const out = ["", "  ── 显式校验:这份计划现在能不能开工 ──"];
  for (const r of review) out.push(`  ${r.state === "passed" ? "✓" : "✗"} ${r.name}: 预审 ${r.state}`);
  out.push(ok ? "  ✅ 可以开工 —— 机器判据全过 + 预审 passed" : "  ⛔ 不能开工 —— 上面的项没清零就别派执行");
  if (review.some((r) => r.state !== "passed")) {
    out.push("", "  派预审(复制给一个全新上下文的只读子代理):");
    for (const l of REVIEW_PROMPT.split("\n")) out.push("    " + l);
  }
  return out.join("\n");
}
