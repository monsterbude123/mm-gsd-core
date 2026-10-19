// 门禁自测 —— 独立成文件,不塞进 gsd-state-check.mjs。
//
// 为什么单独放:自测是"门禁对自己的检查",不是"对项目的检查"。
// 两者混在一个文件里,行数很快顶破 700 上限(2026-10-19 就顶过 713)。
// 跟 template-gates.mjs 一个套路:按需 import,主文件不胖。
//
// 为什么必须有:GitHub #6/#7/#8 三条都是"门禁看起来在跑、实际判错"——
//   #6 VAGUE_FILE 的 N\/A 无左右断言,把 admin/ 路径全判成模糊项
//   #7 depends_on 只认半角括号,中文 STATE.md 的整条依赖链解析为空
//   #8 derived 只判 SHIP 文件存在、不读 status,held 被推成 shipped
// 三条都不是崩溃,是安静地给错答案。T-03 说门禁上线前必须先证明它会红,
// 而"会红"只能靠这些用例证明。

/** 跑一遍自测,返回失败条数 */
export function runSelfTest(VAGUE_FILE, DEP_RE, splitDeps) {
  let bad = 0;
  const eq = (re, s, want, why) => {
    const got = re.test(s), good = got === want;
    if (!good) bad++;
    console.log(`  ${good ? "✓" : "✗"} ${why}: ${JSON.stringify(s)} → ${got}`);
  };
  const eqArr = (got, want, why) => {
    const good = JSON.stringify(got) === JSON.stringify(want);
    if (!good) bad++;
    console.log(`  ${good ? "✓" : "✗"} ${why}: ${JSON.stringify(got)} → ${good ? "" : JSON.stringify(want)}`);
  };
  console.log("\n=== mm-gsd 门禁自测 ===");
  // N\/A 要左右断言:\b 挡不住 admin/auth —— n 是词字符、/ 不是,边界本就存在
  eq(VAGUE_FILE, "src/app/[locale]/admin/admin.css", false, "admin 路径不该被判模糊");
  eq(VAGUE_FILE, "messages/en/adminConsole.json", false, "adminConsole 不该被判模糊");
  eq(VAGUE_FILE, "config/N/A", true, "N/A 本身是模糊写法");
  eq(VAGUE_FILE, "docs/等等.md", true, "等等是模糊写法");
  eq(VAGUE_FILE, "src/app/相关.tsx", true, "相关是模糊写法");
  eq(VAGUE_FILE, "src/a/b/N/Ax.ts", false, "N/Ax 不是 N/A");
  // depends_on 的括号必须认全角:U+FF08/FF09 是中文 STATE.md 的实际写法
  eq(DEP_RE, "02 — 面板 (depends_on: 01)", true, "半角括号依赖");
  eq(DEP_RE, "02 — 面板 （depends_on: 01）", true, "全角括号依赖");
  eq(DEP_RE, "02 — 面板（depends_on：01, 03）", true, "全角括号 + 全角冒号 + 多依赖");
  eq(DEP_RE, "02 — 面板", false, "无依赖不该误匹配");
  // 「无」是"没有依赖",不是依赖了一个叫"无"的 phase —— #7 修完后连带暴露的
  eqArr(splitDeps("无"), [], "depends_on: 无 应解析为空依赖");
  eqArr(splitDeps("无依赖"), [], "depends_on: 无依赖 应解析为空依赖");
  eqArr(splitDeps("none"), [], "depends_on: none 应解析为空依赖");
  eqArr(splitDeps("01, 03"), ["01", "03"], "多依赖应拆分");
  console.log(bad ? `\n${bad} 项自测不过 —— 门禁本身是坏的,先修门禁` : "\n✓ 门禁自测全过");
  return bad;
}
