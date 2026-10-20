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
// 命中载体后还要看它前面有没有否定 —— 「本次不改 contract」「保持现有 schema 不变」
// 恰恰说明这条决策**可逆**,却被纯关键词匹配当成有效举证,把 D-03 变成仪式。
const NEGATION = /不|未|没|无需|不必|暂|禁/;
// 决策的四种书写形态都要认:标题 / 列表项 / 粗体 / 裸方括号,ID 大小写不敏感。
// 裸写 `D-01`(无方括号无标记)**刻意不认**:它与散文里的「理由见 D-01」在字符层面
// 完全不可区分 —— 三份 CONTEXT 里有 40+ 处这样的引用,认它就是一片假红。
// 这是已知局限,不是遗漏:无标记的裸 ID 没有机器可判的形态判据。
const DECISION_LINE = /^(?:(?:#{2,4}|[-*])\s+|\*\*|\[)\s*\[?([Dd]-\d+)\]?/;

/** 解析一行是不是决策起点;是则返回 { id(大写), tail(标题行上决策标签之后的正文) } */
function decisionAt(line) {
  const m = line.match(DECISION_LINE);
  if (!m) return null;
  return { id: m[1].toUpperCase(), tail: line.slice(m[0].length).replace(/^[\s*:：—–-]+/, "") };
}

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
 *
 * `base` 是项目根。**必须显式传**:dirs 里的相对路径若按进程 cwd 解析,那么
 * `--planning <root>` 与 cwd 不一致时会读到另一个项目的 CONTEXT —— 而报错前缀
 * 长得和真的一样(诱饵文件也叫 NN-CONTEXT.md),人分不出自己在验谁。
 * 注意不能图省事把 dirs 直接换成项目根:那会永久放弃 `.planning/phases/<dir>/`
 * 布局下的 CONTEXT,而 checkDrift 的 verify 跑的是 root 布局,看不出这个回归。
 */
export function locateContexts(dirs, base = process.cwd()) {
  const seen = new Set(), hits = [];
  for (const dir of dirs) {
    const absDir = resolve(base, dir);
    let names = [];
    try { names = readdirSync(absDir); } catch { continue; }
    for (const f of names) {
      if (!f.endsWith("-CONTEXT.md")) continue;
      const abs = resolve(join(absDir, f));
      if (seen.has(abs)) continue;
      seen.add(abs);
      hits.push({ dir: absDir, file: f, path: abs });
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
  for (let i = 0; i < lines.length; i++) if (decisionAt(lines[i])) starts.push(i);
  for (const i of starts) {
    const h = decisionAt(lines[i]);
    const rev = h.tail.match(REVERSIBILITY);
    if (!rev) {
      e(`${ctxName}: 决策 ${h.id} 没标可逆性`, "在决策标题行标 reversible / costly / one-way —— 没说清可逆性的决策不算被决策过");
      continue;
    }
    if (rev[1].toLowerCase() !== "one-way") continue;
    // 边界必须是「下一条决策 **或** 下一级标题」—— 注释一直这么声称,代码却只认前者,
    // 于是文件后面任意一节里出现的 migration 字样都能替一条毫无举证的 one-way 决策过闸。
    const stop = lines.findIndex((l, j) => j > i && (decisionAt(l) || /^#{2,4}\s/.test(l)));
    // 举证区从**标题行的下一行**起算,不从标题行本身起算(G-01)。
    // 标题是决策的**摘要**,不是它的理由:「## [D-01] 采用一次性迁移 (one-way)」
    // 里那个「迁移」只说明这条决策讲的是什么,说明不了它撤销起来有多贵。
    // 从标题行起算等于让作者把载体词挪进标题就能免举证 —— 本仓自己引入的假绿。
    // 所以只有正文里的载体词才算举证。
    const section = lines.slice(i + 1, stop < 0 ? lines.length : stop).join("\n");
    // 逐个命中点判断否定:「撤销需要 migration」算举证,「本次不改 contract」不算。
    // 否定词常隔得远 ——「本次不改 contract,保持现有 schema 不变」里「不」离 schema 有 20 字符,
    // 所以按**小句**判断而不是固定窗口,否则第二个关键词会漏网。
    const CLAUSE = /[,，;；。\n]/;
    let proven = false;
    for (const m of section.matchAll(new RegExp(COST_BEARER.source, "gi"))) {
      const before = section.slice(0, m.index);
      const from = Math.max(before.lastIndexOf(","), before.lastIndexOf("，"),
        before.lastIndexOf(";"), before.lastIndexOf("；"), before.lastIndexOf("。"),
        before.lastIndexOf("\n")) + 1;
      const rest = section.slice(m.index + m[0].length);
      const cut = rest.search(CLAUSE);
      if (!NEGATION.test(section.slice(from, cut < 0 ? section.length : m.index + m[0].length + cut))) { proven = true; break; }
    }
    if (!proven)
      e(`${ctxName}: 决策 ${h.id} 标了 one-way 但没举证不可逆代价`, "指名 migration / 已发布契约 / 外部依赖系统;「这个很难改」「本次不改 X」都不算举证");
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
