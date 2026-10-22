// 自测断言 —— 从 gate-selftest.mjs 抽出来,给别的自测模块复用。
//
// 为什么抽:gate-selftest.mjs 贴着 references/ 的 200 行上限(实测 194),
// 而门禁自测的用例只会继续长 —— 每加一条契约就要加用例,断言却只有一份实现。
// 抄一份断言就是抄一份会走偏的判据,而「判据走偏」正是自测存在的理由。
//
// 三种断言:eq(正则)、eqN(单值)、eqArr(数组)。全部把失败计入 st.bad。

/** 造一组断言。返回的 st.bad 是失败条数 —— 调用方自己决定怎么汇报 */
export function mkAssert() {
  const st = { bad: 0 };
  const eq = (re, s, want, why) => {
    const got = re.test(s), good = got === want;
    if (!good) st.bad++;
    console.log(`  ${good ? "✓" : "✗"} ${why}: ${JSON.stringify(s)} → ${got}`);
  };
  const eqN = (got, want, why) => {
    const good = got === want;
    if (!good) st.bad++;
    console.log(`  ${good ? "✓" : "✗"} ${why}: ${got} → ${good ? "" : want}`);
  };
  const eqArr = (got, want, why) => {
    const good = JSON.stringify(got) === JSON.stringify(want);
    if (!good) st.bad++;
    console.log(`  ${good ? "✓" : "✗"} ${why}: ${JSON.stringify(got)} → ${good ? "" : JSON.stringify(want)}`);
  };
  return { eq, eqN, eqArr, st };
}
