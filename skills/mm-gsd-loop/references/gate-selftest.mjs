// 门禁自测 —— 独立成文件,不塞进 gsd-state-check.mjs(自测是"门禁对自己的检查",不是"对项目的检查";混在一起行数很快顶破 700 上限)。跟 template-gates.mjs 一个套路:按需 import,主文件不胖。
// 为什么必须有:GitHub #6/#7/#8 三条都是"门禁看起来在跑、实际判错"(VAGUE_FILE 的 N\/A 无左右断言 /
// depends_on 只认半角括号 / derived 只判 SHIP 文件存在不读 status)—— 不是崩溃,是安静地给错答案。

import { validateVerification } from "./verification-gates.mjs";
import { VAGUE_FILE, DEP_RE } from "./state-derive.mjs";   // REQ-69:被测正则 import 唯一定义,不再吃主脚本注入
import { mmGsdVersion, splitByVersion } from "./version.mjs";
import { runContractCases } from "./selftest-contracts.mjs";
import { runPlanGateCases } from "./selftest-plan-gates.mjs";
import { runAntiFalseGreenCases } from "./selftest-antifalsegreen.mjs";
import { runToolchainCases } from "./selftest-toolchain.mjs";
import { runIntegrationCases } from "./selftest-integrations.mjs";
import { mkAssert } from "./selftest-suite.mjs";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHECKER = fileURLToPath(new URL("../scripts/gsd-state-check.mjs", import.meta.url));

/** 跑一遍自测,返回失败条数 */
// 断言总数基线(phase 30 T3):与 --selfcheck 的总断言数一致;有意增删断言时人工 bump。
const SELFTEST_CASES_TOTAL = 478;

export function runSelfTest(splitDeps) {
  const { eq, eqN, eqArr, st } = mkAssert();
  // 自测必须声明自己的沙箱身份(26-06 / D-11 / REQ-39):自测故意造的失败写进共享遥测文件,
  // 会让 observe 的诊断排行被自己的噪声淹没 —— 实测 1488 条门禁失败里 1303 条(87.6%)来自这里。
  // 声明式标记:由跑沙箱的一方声明,不猜路径(gsd-state-check.mjs:44-48 的既定语义)。
  const SELFTEST_TMP = mkdtempSync(join(tmpdir(), "mm-gsd-selftest-"));
  const SELFTEST_TELEMETRY = join(SELFTEST_TMP, "telemetry.jsonl");
  const ENV_BACKUP = { GSD_SANDBOX: process.env.GSD_SANDBOX, GSD_TELEMETRY: process.env.GSD_TELEMETRY, GSD_TELEMETRY_PATH: process.env.GSD_TELEMETRY_PATH };
  process.env.GSD_SANDBOX = "1";
  process.env.GSD_TELEMETRY_PATH = SELFTEST_TELEMETRY;
  // 第三个不可省:用户环境里若已 export GSD_TELEMETRY=0(本仓教用户这么设),
  // 子进程的 TELEMETRY 会是 false → 压根不写文件 → 下面「临时文件非空」恒红。
  process.env.GSD_TELEMETRY = "1";
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
  // 验收结论一致性闸:一条证明会红,一条证明不误伤。小节标题逐字抄自 templates/verification.md(含括号后缀):第一版写的是裸标题,自测永远绿而真实报告永远不触发。
  const HUMAN_H = "## Human Verification Required(机器验不了,恒发不省略)";
  const vt = (status, rows, human, extra = "") => {
    const v = rows.filter((r) => r.startsWith("✓")).length;
    const doc = `---\nstatus: ${status}\nscore: ${v}/${rows.length}\n---\n\n## Observable Truths\n\n| # | Truth | 状态 | 证据 |\n|---|---|---|---|\n`
      + rows.map((r, i) => `| T${i + 1} | 导出 CSV | ${r} | 证据 ${i + 1} |`).join("\n")
      + `\n${extra}\n${HUMAN_H}\n\n${human}\n`;
    return validateVerification(doc, status).filter((i) => i.level !== "warn").length;
  };
  eqN(vt("passed", ["✓ VERIFIED", "✗ FAILED"], "None"), 1, "正文有 FAILED 却写 passed 应判红");
  eqN(vt("passed", ["✓ VERIFIED", "✓ VERIFIED"], "None"), 0, "全 VERIFIED + 无人工项不应误伤");
  // 下面四条用「闸作者模板之外」的输入(2026-10-20 教训):第一版 fixture 照模板写,模板与闸互不兼容永远暴露不出来。
  // 共享输入显式传递(断言工具与被测解析器/正则/夹具 —— 拆出模块不自建、不重读)
  const t = { eq, eqN, eqArr };
  const x = { CHECKER, vt };
  { // phase 30 T2:本段搬入 runContractCases(见 runContractCases 所在模块);顺序保持,总数不变
    runContractCases(t, x);
  }
  { // phase 30 T2:本段搬入 runPlanGateCases(见 runPlanGateCases 所在模块);顺序保持,总数不变
    runPlanGateCases(t, x);
  }
  { // phase 30 T2:本段搬入 runAntiFalseGreenCases(见 runAntiFalseGreenCases 所在模块);顺序保持,总数不变
    runAntiFalseGreenCases(t, x);
  }
  { // phase 30 D-OV-2:本段搬入 runToolchainCases(见 selftest-toolchain.mjs);顺序保持,总数不变
    runToolchainCases(t);
  }
  { // phase 30 D-OV-2:本段搬入 runIntegrationCases(见 selftest-integrations.mjs);顺序保持,总数不变
    runIntegrationCases(t);
  }
  // ---- 自测遥测隔离(26-06 T1 / D-11 / REQ-39):自测产生的门禁失败必须带 sandbox 标记 ----
  // 顺序写死:先跑完全部断言 → 再还原 env → 再删临时目录(断言要读这个文件,先删会 ENOENT 崩栈而不是判红)。
  {
    const rows = existsSync(SELFTEST_TELEMETRY)
      ? readFileSync(SELFTEST_TELEMETRY, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } })
      : [];
    eqN(rows.length > 0 && rows.every((r) => r.sandbox === true), true, "自测遥测:telemetry-sandbox 临时文件非空且每条记录都带 sandbox 标记");
    eqN(rows.filter((r) => r.exit === 1 && r.sandbox !== true).length, 0, "自测遥测:telemetry-sandbox 没有未标 sandbox 的失败记录");
  }
  // ---- 版本自报(phase 27 T1 / D-04 / REQ-50):遥测行带 ver,版本解析与分桶可判 ----
  {
    const hereDir = dirname(fileURLToPath(import.meta.url));
    const skillDir = dirname(dirname(CHECKER));   // = skills/mm-gsd-loop(仓库与安装布局同形)
    const expectVer = mmGsdVersion(skillDir);
    eqN(expectVer !== "unknown", true, "ver-1 版本可解析(仓库 package.json 或安装清单),不落 unknown");
    eqN(mmGsdVersion(hereDir), expectVer, "ver-1 版本解析:references 目录往上找 = 检查器视角的版本");
    const vTmp = mkdtempSync(join(tmpdir(), "mm-gsd-ver-"));
    const noFile = join(vTmp, "no-such.json");
    eqN(mmGsdVersion(vTmp, { manifestPath: noFile, installManifestPath: noFile }), "unknown", "ver-2 两个口子都读不到 → unknown(不许崩、不许瞎猜)");
    writeFileSync(join(vTmp, "fake.json"), JSON.stringify({ version: "9.9.9" }), "utf8");
    eqN(mmGsdVersion(join(vTmp, "no-such-dir"), { installManifestPath: join(vTmp, "fake.json") }), "9.9.9", "ver-2 起点目录不存在 → 不往上找,读安装清单的 9.9.9");
    const b3 = splitByVersion([{ ver: expectVer }, { ver: "0.0.1" }, {}, { ver: "unknown" }], expectVer);
    eqN(b3.cur.length, 1, "ver-3 分桶:当前版本的行进 cur");
    eqN(b3.old.length, 3, "ver-3 分桶:旧版本行 / 无 ver 老行 / unknown 行都进 old(不许丢)");
    const u3 = splitByVersion([{ ver: "unknown" }, {}, { ver: expectVer }], "unknown");
    eqN(u3.cur.length, 0, "ver-3 观察方版本未知 → 全部归 old(没有已知版本就没有「当前版本」)");
    const tel4 = join(vTmp, "run.jsonl");
    execFileSync(process.execPath, [CHECKER, "--stats"], { cwd: tmpdir(), encoding: "utf8", stdio: "pipe", env: { ...process.env, GSD_TELEMETRY: "1", GSD_TELEMETRY_PATH: tel4, GSD_SANDBOX: "1" } });
    const rec4 = JSON.parse(readFileSync(tel4, "utf8").split("\n").filter(Boolean).pop());
    eqN(rec4.ver, expectVer, "ver-4 遥测行带 ver 且等于写记录方自报的版本");
    rmSync(vTmp, { recursive: true, force: true });
  }
  // 还原环境变量:原值不存在就用 delete —— 写 = undefined 会被 Node 变成字符串 "undefined"(truthy),
  // 之后任何 spawn 检查器都会往一个叫 undefined 的文件写遥测。
  for (const [k, v] of Object.entries(ENV_BACKUP)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // 断言总数基线门(phase 30 T3,REQ-66):纯搬移不该改变总数;总数变了而 N 没改 = 覆盖被拆丢或重复跑。
  // N 是本文件顶部的冻结常量,只在有意增删断言时人工 bump(30-02 拆族/30-03 加夹具断言时各 bump 一次)。
  if (st.total !== SELFTEST_CASES_TOTAL) {
    st.bad++;
    console.log(`
✗ 断言总数 ${st.total} ≠ 基线 ${SELFTEST_CASES_TOTAL} —— 覆盖被拆丢或重复跑;有意增删断言时人工 bump SELFTEST_CASES_TOTAL`);
  } else {
    console.log(`
✓ 断言总数 ${st.total} == 基线 ${SELFTEST_CASES_TOTAL}(覆盖完整)`);
  }
  rmSync(SELFTEST_TMP, { recursive: true, force: true });
  console.log(st.bad ? `\n${st.bad} 项自测不过 —— 门禁本身是坏的,先修门禁` : "\n✓ 门禁自测全过");
  return st.bad;
}
