// 票是否还活着 —— 漂移门的作用域判据。
//
// 为什么独立:它跟「决策契约」是两种关注面。decision-gates 判「决策有没有被执行」,
// 本文件判「这件工件还是不是活的」。混在一起时 decision-gates 会顶破 200 上限,
// 而它顶破的那部分恰恰是主流程每行都要读的核销与可逆性。
//
// 存在的理由(T-13):漂移门若对**已完成**的历史工件也判红,它就恒红 ——
// 编辑一次 CONTEXT,该 phase 的所有旧 PLAN 全部永久变红,而最常见的 `--plan`
// 不带参数恰好走全量扫描,于是这个命令再也回不到绿色。恒红的门不是严,是废。

import { readdirSync, readFileSync, existsSync } from "node:fs";
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
export function runDecisionContracts({ name, planPath, ctxs, root, readFile, e, w, check }) {
  const { checkReversibility, checkPhaseCoverage, checkDrift } = check;
  for (const c of ctxs) checkReversibility({ ctxName: c.file, ctxText: readFile(c.path), e });
  const phaseOf = name.match(/^(\d+)/)?.[1];
  const ticket = name.match(/^(\d+-\d+)/)?.[1];
  // 判活**不按文件名猜**:一份 SUMMARY 可覆盖多张票(本仓 02-03-05 的 plan: "03,04,05"),
  // 按同名判会把三张已完成的票全判成未完成。
  const done = ticket ? ticketsCovered(readSummaries(root), ticket) : false;
  const planText = readFile(planPath);
  for (const c of ctxs.filter((c) => phaseOf && c.file.startsWith(phaseOf))) {
    const ctxText = readFile(c.path);
    // D-03:核销是 phase 级 union —— 一张票只认领它真做的决策,
    // phase 够不够完成由 union 回答(票级全量要求会逼出填不实的 covers)。
    // 整 phase 都做完了就不判:历史 phase 的票写在 covers 字段之前,
    // 拿今天的口径去量它们,只会让一批永远不会被改的工件集体变红(恒红的门等于没有门)。
    if (!done) checkPhaseCoverage({ name, ctxText, coveredIds: phaseCovered(root, phaseOf), e });
    // D-01:反向核销 —— 这张票认领的决策,CONTEXT 里已经没有了。
    // 批注(stale_note)是免单凭据,但它必须指名一个真实存在的接替票:
    // 「本票由 X 接替」而 X 不存在,就是钻空子。
    const stale = staleDecisions(ctxText, coveredDecisions(planText));
    if (stale.length) {
      const note = staleNote(planText);
      // 批注里点名的接替票必须真实存在 —— 「本票由 X 接替」而 X 不存在,就是钻空子。
      // 候选往往不止一个:批注里常带日期(「2026-10-22」也长得像票号),所以逐个试,
      // 有一个真的存在才算免单 —— 第一版只取第一个匹配,于是日期把真正的接替者挡住了。
      const cands = note ? [...note.matchAll(/\b(\d{2}-\d{2})\b/g)].map((m) => m[1]) : [];
      if (note && cands.some((t) => planExists(root, t))) {
        // 批注有效 → 免单:这张票已被接替,不再按活票处理(核销门与漂移门都不判它)。
      } else {
        const msg = `${name}: 认领了本 phase CONTEXT 里不存在的决策 ${stale.join(",")} —— 这张票实现的是已被推翻的决策`;
        const fix = `在该 PLAN 的 frontmatter 加一行批注(stale_note: "D-NN 已于 <日期> 推翻,本票由 <接替票> 接替");批注点名的接替票必须真实存在,否则免单不成立`;
        if (done) w(msg, fix + ";这张票已完成,批注对它没有意义,记一笔备查");
        else e(msg, fix);
      }
    }
    // 漂移门:活票才判;带过时信号(已批注或待批注)的票不重复报漂移 ——
    // 那张票本来就早于 CONTEXT,再报一次「工件早于 CONTEXT」只是把同一个事实说两遍。
    if (!done) {
      if (!stale.length) checkDrift({ name, planPath, ctxPath: c.path, e, w });
    } else w(`${name}: 已有 SUMMARY 覆盖本票,跳过漂移门 —— 历史工件不算陈旧`, "若确实回头重跑了本票,新建一张 PLAN 让它回到 live 集合");
  }
}

/**
 * 反向核销:这张票认领的决策编号,在本 phase CONTEXT 里已经没有了 ——
 * 它实现的是已被推翻的决策(G-08 的另一半,至今未做)。
 *
 * 判据只有一条事实:编号不在 CONTEXT 的决策集合里。**不用** mtime、文件新旧或措辞相似度:
 * 那些信号会把「决策还没写出来」误判成「决策被推翻」,而两者的处置完全不同
 * (前者该补决策,后者该批注接替)。
 *
 * 住在这个文件而不是 decision-gates.mjs:decision-gates 现 200/200 顶着上限,
 * 而「这张票还活着吗」正是本文件的职责范围(见文件头)。
 */
export function staleDecisions(ctxText, coveredIds) {
  const ids = new Set([...String(ctxText ?? "").matchAll(/\[(D-\d+)\]/g)].map((m) => m[1]));
  return coveredIds.filter((d) => !ids.has(d));
}

/**
 * 这张票「认领」的决策 —— **只认 covers 字段**。
 *
 * 正文里提到 D-NN 不算认领(G-08 的前半段:提到 ≠ 认领):「判据见 D-03」这类引用
 * 满篇都是,全文扫等于没扫 —— 上游正是用 designated sections 收窄到指定位置才准的。
 */
export function coveredDecisions(text) {
  const out = new Set();
  for (const m of String(text ?? "").matchAll(/^\s*[-*]\s+\*{0,2}covers\*{0,2}\s*:\s*(.+)$/gim))
    for (const d of m[1].matchAll(/\bD-\d+\b/g)) out.add(d[0]);
  return [...out];
}

/**
 * 本 phase 全部票的 covers 并集 —— phase 级核销的输入。
 *
 * 两种布局都认:.planning/ 根级,以及 .planning/phases/<phase>/。
 * 票号靠文件名前缀判(phase 前缀),不靠目录名 —— phases 布局的目录名可能带后缀。
 */
export function phaseCovered(root, phase) {
  const ids = new Set();
  const dirs = [join(root, ".planning"), join(root, ".planning", "phases", phase)];
  for (const dir of dirs) {
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const f of names.filter((f) => f.endsWith("-PLAN.md"))) {
      if (phase && !f.startsWith(phase + "-")) continue;
      for (const d of coveredDecisions(readFileSync(join(dir, f), "utf8"))) ids.add(d);
    }
  }
  return [...ids];
}

/** 票的 frontmatter 批注(stale_note)—— 过期即免单的凭据 */
export function staleNote(text) {
  const m = String(text ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const kv = m?.[1].match(/^stale_note:\s*(.+)$/m);
  return kv ? kv[1].trim().replace(/^["']|["']$/g, "") : null;
}

/** 某张票的 PLAN 是否真实存在 —— 批注点名的接替票必须真的存在 */
export function planExists(root, ticket) {
  const cands = [join(root, ".planning", `${ticket}-PLAN.md`)];
  let dirs = [];
  try { dirs = readdirSync(join(root, ".planning", "phases"), { withFileTypes: true }); } catch {}
  for (const d of dirs) if (d.isDirectory()) cands.push(join(root, ".planning", "phases", d.name, `${ticket}-PLAN.md`));
  return cands.some((p) => existsSync(p));
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

/**
 * 预审工件(PLAN-CHECK)的契约门禁(phase 09 D-08)。
 *
 * 预审是判断层的复核:机械合规(`--plan` 绿)不代表这份计划成立。这条门禁管两件能判的事实:
 * **形状**(status 必须是 passed|blocked,缺了或写了认不出的值 → 判红)与
 * **不许静默跳过**(票已经开工、有 SUMMARY,却找不到对应的预审工件 → 判红;还没开工的不报 ——
 * 预审本来就发生在执行之前)。它**不判预审结论的对错**(判不了):passed 只意味着「有人复核过」。
 * @param dir 工件目录;@param plans/summaries 本 phase 的 PLAN/SUMMARY 文件名数组
 * @param frontmatter 解析 frontmatter 的函数(调用方注入,避免抄第二份实现)
 * @returns 问题串数组;空数组 = 契约齐
 */
export function checkPlanCheckArtifacts({ dir, plans = [], summaries = [], frontmatter }) {
  const problems = [];
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith("-PLAN-CHECK.md")) : [];
  for (const p of plans) {
    const base = p.replace(/-PLAN\.md$/, "");
    const cf = `${base}-PLAN-CHECK.md`;
    if (!names.includes(cf)) {
      if (summaries.includes(`${base}-SUMMARY.md`))
        problems.push(`${base}: 已经开工却没有预审结论(缺 ${cf}) —— 机械合规过了不等于这份计划成立`);
      continue;
    }
    const st = frontmatter?.(join(dir, cf))?.status;
    if (!["passed", "blocked"].includes(st))
      problems.push(`${cf}: status 非法或缺失("${st ?? "缺"}") —— 预审结论只能写 passed(零 BLOCKER 且零 WARNING)或 blocked`);
  }
  return problems;
}
