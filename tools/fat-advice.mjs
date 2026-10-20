// 超预算时给什么建议 —— 只诊断不给药方的门禁等于把难题推回给读者。
//
// 为什么需要它:拦红时说「超 N 行,脂肪最容易堆的地方」只回答了「哪里错了」,
// 没回答「那我该拆什么、拆去哪」。T-02 说散文纪律没有闸等于没写;反过来,
// 闸只判不导,执行方就得自己重新发明改造方案,而多数人第一反应是抬上限或者硬删。
// 本仓两种都吃过亏(T-11)。
//
// 为什么独立成文件:mmc.mjs 长期贴着 700 上限(历史峰值 714),按 budget.json
// 自己的规矩与 gh-issues.mjs / rule-baseline.mjs / module-registry.mjs 的先例抽出。

/** 一句话讲清 references 化:什么留骨架、什么进 references、怎么被引用 */
const REFACTOR = {
  core: "骨架留核心文件:入口、状态流转、装配(import 与注册)",
  ref: "按需引用的内容进 references/:判定规则表、契约表、正则表、模板",
  call: "核心文件只 import 并调用,不复制 —— 复制就变成两份会分叉的真相",
  why: "判据不是「行数好看」,是删掉之后下一次同类问题会以什么形式回来",
};

/**
 * 生成一条超限文件的改造指引。
 *
 * 三条建议对应三种不同的超限形状,不能一刀切:
 *  - `references/` 里的文件超限:它**已经**是抽出去的那部分,再抽没有落点。
 *    这时说「references 化」是废话。落点是回去问「它该和谁合并」。
 *  - `tools/` 或 `skills/` 主文件:给完整的 references 化三步。
 *  - `SKILL.md` / 散文:给的是「先砍复述」而不是抽模块 —— 散文没有调用点。
 *
 * @param p      超限文件的仓库相对路径
 * @param n      实际行数
 * @param cap    命中的 fileCaps 条目(含 pattern / max / _why)
 * @param counts 全仓库 { 相对路径: 行数 } —— 用来指认可合并的邻居
 */
export function fatAdvice(p, n, cap, counts = {}) {
  const over = n - cap.max;
  const base = cap._why ?? "该文件已超上限";
  const lines = [`${base}`, `→ 多出 ${over} 行,按 T-11 分流:`];

  if (/references\//.test(p)) {
    // references/ 自身超限 —— 抽出去的东西没有更小的落点,只能往回问合并
    lines.push(
      `  1. 先确认它是不是被误当成垃圾桶:references/ 是**按需引用**的落点,`,
      `     不是「主文件放不下就往这塞」的地方。本仓四条先例:`,
      `     template-gates / verification-gates / decision-gates / gate-selftest`,
      `     —— 每个都是单一契约一族,拆的依据是「判据自成一族」,不是「这里塞得下」。`,
      `  2. 若它已经是一族(判定表+正则+用例),说明该族太大:先在族内拆`,
      `     (表 / 用例 / 匹配器),而不是再加一层目录。`,
      `  3. 若它只是「两种不相干的契约被凑到一个文件」,那它本就不该在 references/,`,
      `     回主文件按契约归位,或并进同族的邻居。`,
    );
    return lines.join("\n");
  }

  if (p.endsWith(".md")) {
    // 散文没有调用点,references 化对它不成立
    lines.push(
      `  1. 先砍复述:同一约束在 SKILL.md、模板、门禁注释里各写一遍是本仓最大的脂肪源。`,
      `     留一处权威,其余改成指向它的一句话。`,
      `  2. 只有「正文确实长、但读的人不必每次读全」的部分才拆成 references/,`,
      `     由 SKILL.md 显式指路 —— 散文按需引用靠的是「读到这里才知道要不要读」。`,
      `  3. 砍完仍超:走 distill 抬上限,并在 docs/theory.md 写清放宽换来了什么。`,
    );
    return lines.join("\n");
  }

  // 主文件(.mjs):完整的 references 化三步
  lines.push(
    `  1. ${REFACTOR.core}`,
    `     —— 判据:这个文件是「程序」还是「程序 + 一堆规则表」?后者里的表就是按需引用的内容。`,
    `  2. ${REFACTOR.ref}`,
    `     本仓已有先例,照着拆:`,
    `     skills/ 侧 → references/<契约名>.mjs(上限 200),`,
    `     tools/   侧 → 独立模块如 gh-issues / rule-baseline / module-registry。`,
    `     判据:那部分内容**主流程不需要每行都读**,只在特定分支才用到。`,
    `  3. ${REFACTOR.call}`,
    `  4. ${REFACTOR.why}:`,
    `     删掉超限那部分,下一次同类问题会以什么形式回来?答不上来就说明它是新能力,`,
    `     该走 distill 抬上限,不该拆。`,
  );
  const near = nearestSiblings(p, counts);
  if (near.length)
    lines.push(`  邻居参考:${near.join("、")} —— 看它们各占多少行,拆到同一量级`);
  return lines.join("\n");
}

/** 找同目录下量级最接近的兄弟文件,给出「拆到这一量级」的参照 */
function nearestSiblings(p, counts) {
  const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
  return Object.entries(counts)
    .filter(([q]) => q !== p && (q.includes("/") ? q.slice(0, q.lastIndexOf("/")) : "") === dir)
    .sort((a, b) => Math.abs(a[1] - 120) - Math.abs(b[1] - 120))
    .slice(0, 3)
    .map(([q, k]) => `${q} ${k} 行`);
}
