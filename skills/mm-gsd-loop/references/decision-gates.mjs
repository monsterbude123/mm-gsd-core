// 决策契约 —— 从 gsd-state-check.mjs 拆出来的第二个关注面。
//
// 为什么要拆:主脚本在 02-01 之后已经 699/700,而「CONTEXT 定位 + 核销 + 可逆性 + 漂移」
// 这四条决策契约装在里面必然顶破硬闸。按预算自己的说法(「下次加模式前先考虑拆成两个文件」),
// 决策契约与工件契约是两回事:前者管「决策有没有被真正执行」,后者管「工件长什么样」。
//
// 本文件覆盖三条,作用域各不相同 —— 混用会造假红或假绿:
//   核销 checkCoverage      —— 单个 phase:该 phase 的 plan 必须引用它的 CONTEXT
//   可逆性 checkReversibility —— 全局:每份 CONTEXT 的每条决策都要有标记
//   漂移   checkDrift        —— 单个 phase:工件不得早于自己 phase 的 CONTEXT

import { readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const REVERSIBILITY = /\b(reversible|costly|one-way)\b/i;
// one-way 的举证载体:撤销需要动 migration / 已发布契约 / 外部依赖系统。
// 「这个很难改」「以后不好维护」不是载体,它们描述的是主观感受而不是代价。
const COST_BEARER = /migration|迁移|已发布|发布契约|contract|外部依赖|下游系统|schema|数据模型/i;
// 决策可能写成标题(### [D-01] …)也可能写成列表项(- [D-01] …)——
// 模板里的示例是列表项,实际产出常是标题,两种都得认,否则会静默漏检
const DECISION_LINE = /^(?:#{2,4}\s+|[-*]\s+)\[(D-\d+)\]\s*(.*)$/;

/**
 * 列出给定目录里全部 <NN>-CONTEXT.md。名字必须带 phase 前缀,裸 CONTEXT.md 检查器认不出。
 *
 * 必须返回**全部**而不是第一个:早期版本用 `.find()`,于是字母序靠后的 phase 的 CONTEXT
 * 完全不被检查 —— 实测差分:同样把 D-04 改成「one-way 但没举证」,改 02-CONTEXT.md 报红 1 次,
 * 改 03-CONTEXT.md 报红 0 次。后面那些 phase 的决策因此既不核销也不过可逆性门,
 * 而门禁看起来一切正常 —— 这是最坏的失败形状。
 *
 * 调用方按作用域分流,见文件头。反过来也不能图省事拿一个 plan 去对所有 CONTEXT 核销:
 * phase 02 的 plan 不该被要求引用 phase 03 的决策,那是假红。
 *
 * dirs 常同时给相对路径与绝对路径(同一目录的两种写法),故按 resolve 后的真实路径去重。
 */
export function locateContexts(dirs) {
  const seen = new Set(), hits = [];
  for (const dir of dirs) {
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const f of names) {
      if (!f.endsWith("-CONTEXT.md")) continue;
      const abs = resolve(join(dir, f));
      if (seen.has(abs)) continue;
      seen.add(abs);
      hits.push({ dir, file: f, path: abs });
    }
  }
  return hits;
}

/** 核销:这份 CONTEXT 的每条 D-NN 都必须被本 plan 的任务引用。作用域 = 单个 phase */
export function checkCoverage({ name, ctxText, planDecisions, e }) {
  const ids = [...ctxText.matchAll(/\[(D-\d+)\]/g)].map((m) => m[1]);
  const missing = ids.filter((id) => !planDecisions.includes(id));
  if (missing.length)
    e(`${name}: CONTEXT 决策 ${missing.join(",")} 未被任何任务引用`, "补任务引用并精确实现;若该决策其实是延后项,把它移出 decisions 节");
}

/**
 * 可逆性:每条决策必须标 reversible / costly / one-way,标 one-way 的必须举证不可逆代价。
 * 作用域 = 全局,每份 CONTEXT 都要过,与当前校验哪份 plan 无关。
 * 报错前缀用 CONTEXT 的文件名而不是 plan 名 —— 出问题的是那份 CONTEXT,不是那份 plan。
 *
 * 只看决策所在行与其后到「下一条决策或下一级标题为止」的内容 —— 全文件正则会误判,
 * 因为正文散文里完全可能提到 one-way 这个词。
 */
export function checkReversibility({ ctxName, ctxText, e }) {
  const lines = ctxText.split(/\r?\n/);
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (DECISION_LINE.test(lines[i])) starts.push(i);
  for (const i of starts) {
    const h = lines[i].match(DECISION_LINE);
    const rev = h[2].match(REVERSIBILITY);
    if (!rev) {
      e(`${ctxName}: 决策 ${h[1]} 没标可逆性`, "在决策标题行标 reversible / costly / one-way —— 没说清可逆性的决策不算被决策过");
      continue;
    }
    if (rev[1].toLowerCase() !== "one-way") continue;
    const end = starts.find((s) => s > i) ?? lines.length;
    const section = lines.slice(i, end).join("\n");
    if (!COST_BEARER.test(section))
      e(`${ctxName}: 决策 ${h[1]} 标了 one-way 但没举证不可逆代价`, "指名 migration / 已发布契约 / 外部依赖系统;「这个很难改」不算举证");
  }
}

/**
 * 核销 + 可逆性 的合并入口,作用域 = 单份 CONTEXT 对单个 plan。
 *
 * 主脚本走的是拆分版(可逆性全局生效、核销与漂移按 phase),因为一份 plan
 * 只能核销自己 phase 的决策。这里保留合并版,给自测与不关心作用域的调用方用 ——
 * 语义与拆分版完全一致,只是不作作用域假设。
 * 保留它还有一个实际原因:改导出名会打断已经依赖旧名的调用方,
 * 那次改名就打断了 gate-selftest.mjs,门禁自测整个崩在 import 上,health 跟着红。
 * 改名导出前先 grep 调用方,别只顾自己这一侧。
 */
export function checkDecisions({ name, ctxText, planDecisions, e }) {
  checkCoverage({ name, ctxText, planDecisions, e });
  checkReversibility({ ctxName: name, ctxText, e });
}

/**
 * 上下文漂移:工件严格早于 CONTEXT,说明决策在工件写出之后又移动过,
 * 执行者正在按一份已被推翻的决策干活。相等不算漂移(同一次写入)。作用域 = 单个 phase。
 *
 * 读不到时间戳时**按不拦人 + 显式标记**处理:判红会让沙盒与只读文件系统下全线误红,
 * 静默放行又违反 R-08「不得静默 no-op」。两个极端都要避免,标记是唯一诚实的中间态。
 */
export function checkDrift({ name, planPath, ctxPath, e, w }) {
  let planMs, ctxMs;
  try {
    planMs = statSync(planPath).mtimeMs;
    ctxMs = statSync(ctxPath).mtimeMs;
  } catch (err) {
    w(`${name}: 读不到 mtime,无法判定上下文漂移(${err.code ?? err.message})`, "确认文件可读;读不到既不等于没漂移也不等于有漂移,故只标记不拦人");
    return;
  }
  if (planMs < ctxMs)
    e(`${name}: 工件早于 CONTEXT(${basename(ctxPath)}) —— 决策在工件写出之后又动过`, "重跑规划让工件对齐最新决策;不要靠手动改 prompt 假装同步,那只会把陈旧状态往前传");
}
