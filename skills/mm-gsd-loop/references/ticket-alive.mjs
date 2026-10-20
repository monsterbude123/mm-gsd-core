// 票是否还活着 —— 漂移门的作用域判据。
//
// 为什么独立:它跟「决策契约」是两种关注面。decision-gates 判「决策有没有被执行」,
// 本文件判「这件工件还是不是活的」。混在一起时 decision-gates 会顶破 200 上限,
// 而它顶破的那部分恰恰是主流程每行都要读的核销与可逆性。
//
// 存在的理由(T-13):漂移门若对**已完成**的历史工件也判红,它就恒红 ——
// 编辑一次 CONTEXT,该 phase 的所有旧 PLAN 全部永久变红,而最常见的 `--plan`
// 不带参数恰好走全量扫描,于是这个命令再也回不到绿色。恒红的门不是严,是废。

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 一份 PLAN 的决策契约接线 —— 可逆性、核销、漂移三条一起跑。
 *
 * 三条契约作用域不同,混用会造假红或假绿:
 *   可逆性对**全部** CONTEXT 生效(每份 CONTEXT 的每条决策都要有标记);
 *   核销与漂移只对这份 plan 自己 phase 的那一份 CONTEXT —— 拿一个 plan 去对
 *   所有 CONTEXT 核销会造假红:phase 02 的 plan 不必引用 phase 03 的决策。
 *
 * 漂移门只对**还活着的票**判红(见本文件头)。已完成的历史 PLAN 不该永久红:
 * 编辑 CONTEXT 之后同 phase 的旧计划一律「工件早于 CONTEXT」,而最常见的
 * `--plan` 不带参数走全量扫描,于是它再也回不到绿色。
 */
export function runDecisionContracts({ name, planPath, ctxs, planDecisions, root, readFile, e, w, check }) {
  const { checkReversibility, checkCoverage, checkDrift } = check;
  for (const c of ctxs) checkReversibility({ ctxName: c.file, ctxText: readFile(c.path), e });
  const phaseOf = name.match(/^(\d+)/)?.[1];
  const ticket = name.match(/^(\d+-\d+)/)?.[1];
  // 判活**不按文件名猜**:一份 SUMMARY 可覆盖多张票(本仓 02-03-05 的 plan: "03,04,05"),
  // 按同名判会把三张已完成的票全判成未完成。
  const done = ticket ? ticketsCovered(readSummaries(root), ticket) : false;
  for (const c of ctxs.filter((c) => phaseOf && c.file.startsWith(phaseOf))) {
    checkCoverage({ name, ctxText: readFile(c.path), planDecisions, e });
    if (!done) checkDrift({ name, planPath, ctxPath: c.path, e, w });
    else w(`${name}: 已有 SUMMARY 覆盖本票,跳过漂移门 —— 历史工件不算陈旧`, "若确实回头重跑了本票,新建一张 PLAN 让它回到 live 集合");
  }
}

/**
 * 读 .planning 下的全部 SUMMARY 文本。判活依赖 frontmatter 而不是文件名,所以要读内容。
 * 读不到就返回空数组 —— 调用方据此认为没有票被覆盖,即走严格路径(fail-closed)。
 */
export function readSummaries(base) {
  try {
    return readdirSync(join(base, ".planning"))
      .filter((f) => f.endsWith("-SUMMARY.md"))
      .map((f) => ({ file: f, text: readFileSync(join(base, ".planning", f), "utf8") }));
  } catch { return []; }
}

/**
 * 一份 SUMMARY 可能覆盖多张票:`02-03-05-SUMMARY.md` 的 frontmatter 是
 * `phase: "02"` + `plan: "03,04,05"`。按「同名文件」判活会把这三票全判成未完成 ——
 * 本仓真实工件就是反例。所以判活读 frontmatter,不猜文件名。
 *
 * **票号是两个字段拼出来的**:`plan` 存的是票号后缀(`"01"` / `"03,04,05"`),
 * phase 单独存在 `phase:` 里。拿 `02-03` 去比对 `"01"` 是比不上的 —— phase 前缀
 * 不在 `plan` 里。这是本函数第一版的 bug,由「改完 --plan 仍全红」的现象抓出来。
 *
 * @param summaries readSummaries() 的结果
 * @param ticket    完整票号,形如 "02-03"
 * @returns true = 这张票已被某份 SUMMARY 覆盖
 */
export function ticketsCovered(summaries, ticket) {
  const cut = ticket.includes("-") ? ticket.indexOf("-") : ticket.length;
  const phase = ticket.slice(0, cut), suffix = ticket.slice(cut + 1);
  const fm = (text, key) => text.match(new RegExp(`^${key}:\\s*"?([^"\\n]*)"?\\s*$`, "m"))?.[1]?.trim();
  for (const s of summaries) {
    const plan = fm(s.text, "plan");
    if (!plan) continue;                     // 无 plan 字段不作数 —— 宁可漏判,不可凭空标成已完成
    const ph = fm(s.text, "phase") ?? s.file.slice(0, 2);   // phase 缺失时从文件名取
    if (ph === phase && plan.split(/[,、\s]+/).filter(Boolean).includes(suffix)) return true;
  }
  return false;
}
