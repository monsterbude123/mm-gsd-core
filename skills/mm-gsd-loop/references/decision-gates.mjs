// 决策契约 —— 从 gsd-state-check.mjs 拆出来的第二个关注面。
//
// 为什么要拆:主脚本在 02-01 之后已经 699/700,而「CONTEXT 定位 + 核销 + 可逆性 + 漂移」
// 这四条决策契约装在里面必然顶破硬闸。按预算自己的说法(「下次加模式前先考虑拆成两个文件」),
// 决策契约与工件契约是两回事:前者管「决策有没有被真正执行」,后者管「工件长什么样」。
//
// 本文件覆盖:
//   核销   —— CONTEXT 每条 D-NN 必须被 PLAN 的任务引用(D-02 决策保真,既有行为)
//   可逆性 —— 每条决策必须标 reversible / costly / one-way;one-way 要举证(D-03)
//   漂移   —— 工件早于 CONTEXT 就是决策在工件之后又动过(D-04)

import { readdirSync, statSync } from "node:fs";

const REVERSIBILITY = /\b(reversible|costly|one-way)\b/i;
// one-way 的举证载体:撤销需要动 migration / 已发布契约 / 外部依赖系统。
// 「这个很难改」「以后不好维护」不是载体,它们描述的是主观感受而不是代价。
const COST_BEARER = /migration|迁移|已发布|发布契约|contract|外部依赖|下游系统|schema|数据模型/i;
// 决策可能写成标题(### [D-01] …)也可能写成列表项(- [D-01] …)——
// 模板里的示例是列表项,实际产出常是标题,两种都得认,否则会静默漏检
const DECISION_LINE = /^(?:#{2,4}\s+|[-*]\s+)\[(D-\d+)\]\s*(.*)$/;

/** 在给定目录里找 <NN>-CONTEXT.md。名字必须带 phase 前缀,裸 CONTEXT.md 检查器认不出 */
export function locateContext(dirs) {
  for (const dir of dirs) {
    try {
      const hit = readdirSync(dir).find((f) => f.endsWith("-CONTEXT.md"));
      if (hit) return { dir, file: hit };
    } catch {}
  }
  return null;
}

/**
 * 核销 + 可逆性。planDecisions 是 PLAN 里出现的 D-NN 集合,e 是报错收集器。
 * 只看决策所在行与其后到「下一条决策或下一级标题为止」的内容 —— 全文件正则会误判,
 * 因为正文散文里完全可能提到 one-way 这个词。
 */
export function checkDecisions({ name, ctxText, planDecisions, e }) {
  const ids = [...ctxText.matchAll(/\[(D-\d+)\]/g)].map((m) => m[1]);
  const missing = ids.filter((id) => !planDecisions.includes(id));
  if (missing.length)
    e(`${name}: CONTEXT 决策 ${missing.join(",")} 未被任何任务引用`, "补任务引用并精确实现;若该决策其实是延后项,把它移出 decisions 节");

  const lines = ctxText.split(/\r?\n/);
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (DECISION_LINE.test(lines[i])) starts.push(i);
  for (const i of starts) {
    const h = lines[i].match(DECISION_LINE);
    const rev = h[2].match(REVERSIBILITY);
    if (!rev) {
      e(`${name}: 决策 ${h[1]} 没标可逆性`, "在决策标题行标 reversible / costly / one-way —— 没说清可逆性的决策不算被决策过");
      continue;
    }
    if (rev[1].toLowerCase() !== "one-way") continue;
    const end = starts.find((s) => s > i) ?? lines.length;
    const section = lines.slice(i, end).join("\n");
    if (!COST_BEARER.test(section))
      e(`${name}: 决策 ${h[1]} 标了 one-way 但没举证不可逆代价`, "指名 migration / 已发布契约 / 外部依赖系统;「这个很难改」不算举证");
  }
}

/**
 * 上下文漂移:工件严格早于 CONTEXT,说明决策在工件写出之后又移动过,
 * 执行者正在按一份已被推翻的决策干活。相等不算漂移(同一次写入)。
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
    e(`${name}: 工件早于 CONTEXT —— 决策在工件写出之后又动过`, "重跑规划让工件对齐最新决策;不要靠手动改 prompt 假装同步,那只会把陈旧状态往前传");
}

