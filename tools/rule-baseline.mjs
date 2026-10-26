// 台账基线 —— 从 mmc.mjs 抽出来的独立模块。
//
// 为什么抽:mmc.mjs 曾两次顶破单文件上限,本仓的先例是 gh-issues.mjs(当初也是顶破才抽的)。
// 这份基线虽然只有十几行,但它必须待在 mmc 的**台账驱动循环之外**,放在那儿会让主文件更难读。
//
// 为什么需要它:R-NN 由 ledger.json 驱动,而 ledger 与门禁在同一个可编辑的仓库、同一次
// 提交里改 —— 于是「唯一能发现某条门禁被删了」的那个 check,就住在它自己身上。
// 实测:从 ledger 删掉 R-16 那一行 → health 照常 exit 0,打印「15 条规则门禁全通过」。
// 删掉一条规则就等于删掉了唯一会发现它被删掉的东西。
//
// 所以基线必须是 ledger 之外的第二份记录,并且无条件执行。
// 要退役某条规则:改这里的数组,并在 docs/theory.md 写清为什么 —— 只删台账不算。

// R-03(体积硬顶)于 2026-10-26 退役 —— 退役理由见 docs/theory.md T-16。
export const BASELINE_RULES = [
  "R-01", "R-02", "R-04", "R-05", "R-06", "R-07", "R-08",
  "R-09", "R-10", "R-11", "R-12", "R-13", "R-14", "R-15", "R-16", "R-17", "R-18", "R-19", "R-20", "R-21", "R-22", "R-23",
];

/** 返回台账里缺失的基线规则;空数组表示齐全 */
export function missingRules(led) {
  const have = new Set((led.rules ?? []).filter((r) => r.status === "active").map((r) => r.id));
  return BASELINE_RULES.filter((id) => !have.has(id));
}
