// 开工判定 —— 一份 PLAN 现在能不能开工。
//
// 为什么独立成文件:它判的是**预审工件**(另一族契约),不是「工件记账」。
// 塞进 artifact-ledger.mjs 会让那个文件的职责从「记账」滑向「开工判定」——
// 语义不对的地方迟早长出不对的代码(phase 10 预审 W2)。2026-10-26 体积硬顶退役
// (见 docs/theory.md T-16)之后,新模块不再需要为「塞得进哪个文件」而委屈。
//
// fail-closed 是本文件的全部纪律:工件缺失 / status 非法 / status 非 passed /
// plan 票号对不上 / blockers 未清零 —— 一律判「不能开工」;passed 带 warnings 合法
// (WARNING 归 Deferred 带进施工,phase 13 D-01)。
// 看不清的状态不能当通过:**门禁看不懂 ≠ 门禁放行**。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** 29 起新规划按 phase 一次预审;28 及更早的在制 phase 走祖父路径(决定 #3:存量施工不判死) */
export const PHASE_CONVERGENCE_REQUIRED_FROM = 29;

/** 机器可判签名(#10 四类 + #24 + F2/F5 措辞):预审工件里命中即分类降级,拦工交给 14 族机器门 */
export const MACHINE_SIGNS = /(零匹配|自证|数错|二次解析|捕获邻接|恒真|基线里已经存在|零数据输入|判据失灵)/;

/**
 * phase 级预审收敛工件读取(R-26)。<NN>-REVIEW-CONVERGENCE*.md 按 round 排序,
 * 相邻两轮 new_judgment 不降(>=)即停滞 —— 计数不降说明本轮没有新事实,继续改稿就是重复审核。
 */
export function readPhaseConvergence(planDir, phase) {
  const out = { present: false, rounds: [], stalled: false, latest: null };
  let files = [];
  try {
    files = readdirSync(planDir).filter((f) => f.startsWith(phase + "-REVIEW-CONVERGENCE") && f.endsWith(".md")).sort();
  } catch {
    return out;
  }
  for (const f of files) {
    const fm = frontmatter(readFileSync(join(planDir, f), "utf8"));
    out.rounds.push({
      file: f,
      round: Number(fm.round ?? 0) || 0,
      new_judgment: Number(fm.new_judgment ?? 0) || 0,
      open_judgment: Number(fm.open_judgment ?? 0) || 0,
      status: String(fm.status ?? ""),
    });
  }
  if (!out.rounds.length) return out;
  out.present = true;
  out.rounds.sort((a, b) => a.round - b.round);
  out.latest = out.rounds[out.rounds.length - 1];
  // 停滞只看最新一轮的走向:中间有过反弹、最后收敛了就是收敛(3→3→1 = 收敛)
  if (out.rounds.length >= 2) {
    const cur = out.rounds[out.rounds.length - 1], prev = out.rounds[out.rounds.length - 2];
    if (cur.new_judgment >= prev.new_judgment) {
      out.stalled = true;
      out.stalledMsg = `phase ${phase} 预审停滞:round ${cur.round} 的 new_judgment ${cur.new_judgment} 未低于上一轮 ${prev.new_judgment} —— [REVIEW-CONVERGENCE-STALLED] 计数不降即升级到人,agent 不再开一轮`;
    }
  }
  return out;
}

/** 预审工件的 blocker 行分类:命中机器可判签名的行不计入拦工(R-25),拦工交给 14 族机器门 */
export function classifyArtifactBlockers(cfPath) {
  const text = existsSync(cfPath) ? readFileSync(cfPath, "utf8") : "";
  const machineLines = [];
  let total = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*-\s*\[BLOCKER\]/.test(line)) continue;
    total++;
    if (MACHINE_SIGNS.test(line)) machineLines.push(line.trim());
  }
  return { total, machineLines, judgmentCount: total - machineLines.length };
}

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

/** 派预审的提示词。判据在 mm-gsd-verify「执行前预审」节,这里只给调用形状。
 *  宿主装了 mm-gsd-plan-reviewer 卡(reviewerCard,物理只读)就用卡派;没卡按本提示词派。 */
export const REVIEW_PROMPT = [
  "按 mm-gsd-verify 的「执行前预审」节复核下面这份 PLAN:",
  "  · 工具限 Read/Grep/Glob(物理只读 —— 有 mm-gsd-plan-reviewer 卡就用卡派)",
  "  · 只读 CONTEXT / PLAN / REQ,不看写它的过程(自己写自己审不算数)",
  "  · 每条发现带 severity(BLOCKER/WARNING/INFO);缺 severity 一律当 BLOCKER",
  "  · 只报发现,不处方 —— 改法归写票的人",
  "  · 发现清单以文本返回,不写任何文件;PLAN-CHECK 工件由调用方落盘:",
  "    status(passed|blocked)/blockers/warnings/plan",
].join("\n");

/**
 * 开工判定。state: passed|blocked|missing|invalid;problems 逐条带改法。
 * 只读不写 —— 复核发现以文本返回,工件由调用方落盘(D-01 附带设计);脚本能写就等于自己判自己(D-04)。
 */
export function checkPlanReady({ planPath }, phaseCtx = {}) {
  const base = planPath.split(/[\\/]/).pop();
  const cf = planPath.replace(/-PLAN\.md$/, "-PLAN-CHECK.md");
  const problems = [];
  const classified = [];
  const superseded = Boolean(phaseCtx.superseded);
  if (!existsSync(cf)) {
    // phase 收敛工件在场 ⇒ 票级预审被取代(R-26):缺票级工件不再是「没人审」
    if (superseded) return { state: "passed", problems, classified, superseded: true };
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
  // 机器可判发现分类降级(R-25):命中签名的 BLOCKER 行不计入拦工,拦工交给 14 族机器门(--plan)
  const cls = classifyArtifactBlockers(cf);
  classified.push(...cls.machineLines.map((l) => "[MACHINE-CLASSIFIABLE] " + l));
  if (st === "blocked") {
    if (superseded) {
      const effective = Math.max(0, cls.total - cls.machineLines.length);
      if (effective === 0) {
        return { state: "passed", problems, classified, superseded: true, effective };
      }
      problems.push({ msg: `${base}: 预审 status=blocked —— ${effective} 条判断题 BLOCKER 未清零(另有 ${machineLines.length} 条机器可判发现已下沉机器层)`, fix: "把判断题 findings 交回 mm-gsd-plan 修,复审一次(≤2 轮)再跑本命令" });
    } else {
      problems.push({ msg: `${base}: 预审 status=blocked —— 有 BLOCKER 没清零就不许开工`, fix: "把 findings 交回 mm-gsd-plan 修,复审一次(≤2 轮)再跑本命令" });
    }
  } else if (blockers) problems.push({ msg: `${base}: 预审 status=passed 却 blockers=${blockers} ≠ 0 —— BLOCKER 不清零不算 passed(fail-closed)`, fix: "修完 BLOCKER 再复审;WARNING 归 Deferred 带进施工(phase 13 D-01)" });
  return { state: problems.length ? "blocked" : "passed", problems, classified, blockers, warnings, superseded };
}

/** 显式校验的结论行。判定与渲染都在这里,主脚本只留接线 */
export function renderPlanReady({ review = [], ok = false }) {
  const out = ["", "  ── 显式校验:这份计划现在能不能开工 ──"];
  for (const r of review) out.push(`  ${r.state === "passed" ? "✓" : "✗"} ${r.name}: 预审 ${r.state}`);
  out.push(ok ? "  ✅ 可以开工 —— 机器判据全过 + 预审 passed" : "  ⛔ 不能开工 —— 上面的项没清零就别派执行");
  if (review.some((r) => r.state !== "passed")) {
    out.push("", "  派预审(宿主装了 mm-gsd-plan-reviewer 卡就用卡派 —— 它被物理限制为只读;没卡才按下面提示词派,并声明工具限 Read/Grep/Glob):");
    for (const l of REVIEW_PROMPT.split("\n")) out.push("    " + l);
  }
  return out.join("\n");
}
