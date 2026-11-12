// 债面板解析模块自测 —— references/debt-panel.mjs 的口径自证。
//
// 为什么要单独一份自测:这个模块的判定口径(台账处置列优先、无行才回退原件状态、
// deferred 三列不许丢)写死在代码里,看板读错了是「欠账面板虚报」,肉眼很难发现。
// 口径只能靠机器断言锁住。
//
// 夹具逐字照抄真实工件形状(.planning/issues/*.md 与 .planning/*-SUMMARY.md 的真实片段),
// 不自己编形状:编出来的形状只能证明代码符合编造者的想象。
//
// 跑法:node skills/mm-gsd-loop/selftests/debt-panel.selftest.mjs
// 退出码即判据:0 = 全过,1 = 有不过。

import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { parseDeferred, readLedger, issueState, openIssues, buildDebt } from "../references/debt-panel.mjs";

const MODULE_PATH = fileURLToPath(new URL("../references/debt-panel.mjs", import.meta.url));

// ---- 夹具(形状照抄真实工件)------------------------------------------------

/** 真实 I-001.md 的形状:一级标题 + `## 状态` 段(空行隔开)+ 状态值。 */
const I_001 = `# I-001 glob 匹配器静默空过,单文件上限检查从未生效

## 状态

open

## 证据

- 匹配器把 \`a//b\` 当成目录,单文件上限检查从未生效。
`;

const I_002 = `# I-002 检查器把模板里的多值 status 判为非法

github: #1
url: https://github.com/monsterbude123/mm-gsd-core/issues/1

## 状态

open

## 证据

- 没提取到证据。
`;

const I_003 = `# I-003 [verify-package 数技能时把 manifest 也数进去了]

github: #3
url: https://github.com/monsterbude123/mm-gsd-core/issues/3

## 状态

open

## 证据

- 已修 v0.1.0(0d630bd)。
`;

/**
 * 真实 LEDGER.md 的形状:标题 + 引用行(处置口径) + `## 证据` 散文 + 四列表格。
 * 注意台账里**没有 I-002 行** —— 回退原件状态的分支就靠这个缺行触发。
 */
const LEDGER = `# 豁免台账 —— 本地账 I-* 处置登记(checkIssueLedger 的第三条闭环路)

> 原则同 artifact-ledger:原件(I-*.md)是审计痕迹,一行不改;处置记在这里。
> 处置口径:closed = 已修(带修复版本/commit);fixed = 已修、遗留尾巴;open = 仍开(带重开条件或挂靠)。
> 行随修复状态维护 —— 假销账 = RC2 复发。创建于 phase 19(D-11)。

## 证据

处置判据全部可复核,不凭印象:
- 已修件的修复版本对照:\`git tag --contains <commit>\` —— 0d630bd → v0.1.0。

| 件 | 处置 | 挂靠 | 说明 |
|---|---|---|---|
| I-001.md | closed | — | 已修 |
| I-003.md | fixed | — | 已修留尾巴 |
`;

/** 真实 22-CONTEXT.md 的 `<deferred>` 段形状:标签独占一行 + 四列表格(表头/分隔行/数据行)。 */
const CONTEXT_01 = `# 01 CONTEXT

<deferred>

# 挂条件与关闭项(登记:条件成立即开工 / 为什么不做了)

| 项 | 分类 | 触发条件 / 关闭理由 | 归属 |
|---|---|---|---|
| PostToolUse 精确耗时 | 挂条件 | 宿主事件面新增 PostToolUse → 升级为精确值 | 每次 release 后查一次 |
| 多项目看板 | 关闭 | 单项目已够;换项目再起一个 \`mm-gsd web\` 即可(零代码) | 不重开 |

</deferred>
`;

/** 真实 01-01-SUMMARY.md 的 `## Deferred Issues` 形状:二级标题 + 无序列表(首条跨多行)。 */
const SUMMARY_01_01 = `# 01-01 SUMMARY

## Deferred Issues

- \`.planning/01-01-PLAN.md\` 的 Truth 写「本轮不净增行数」,实际 2931 vs 起点 2925 为 **+6**。
  净减的是 SKILL.md(300→280)与 diff 口径,差额来自 T2 新增的轮询代码与
  \`--help\`。
- 预算余 69 行(2931/3000)。
- 措辞修正留到下一轮 distill,不在执行期改已落盘的工件。

## Self-Check: PASSED

- 关键文件在盘。
`;

/** 批注真实形状:.planning/annotations.json 的一行。 */
const ANNOTATIONS = [
  { id: "a-1", ts: "2026-11-12T09:00:00Z", target: "src/x.js", type: "note", text: "这里没处理空值", status: "open" },
  { id: "a-2", ts: "2026-11-12T09:05:00Z", target: "src/y.js", type: "note", text: "已消化", status: "digested" },
];

// ---- 断言小工具 ------------------------------------------------------------

const results = [];

function ok(name, cond, detail = "") {
  results.push({ name, pass: !!cond, detail });
  if (cond) console.log(`✓ ${name}`);
  else console.log(`✗ ${name}${detail ? ` —— ${detail}` : ""}`);
}

function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(name, g === w, `got=${g} want=${w}`);
}

// ---- 主体 ------------------------------------------------------------------

function main() {
  // 夹具落盘:形状是照抄的,但用真实文件 API 落一次盘,免得「手写的内存对象」和
  // 「从磁盘读到的文本」之间有看不见的差别(换行符、末尾空行)。
  const dir = mkdtempSync(join(tmpdir(), "debt-panel-selftest-"));
  const files = {
    "issues/I-001.md": I_001,
    "issues/I-002.md": I_002,
    "issues/I-003.md": I_003,
    "issues/LEDGER.md": LEDGER,
    "01-CONTEXT.md": CONTEXT_01,
    "01-01-SUMMARY.md": SUMMARY_01_01,
  };
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
  }

  // 把磁盘上的文件读回来当输入(调用方把文本传进来,模块自己不碰文件系统)。
  const planningDir = {};
  for (const rel of Object.keys(files)) {
    const abs = join(dir, ...rel.split("/"));
    planningDir[rel] = readFileSync(abs, "utf8");
  }

  const debt = buildDebt({ planningDir, annotations: ANNOTATIONS });
  const ids = debt.localIssues.map((x) => x.id);

  // 1. 台账处置 closed → 该件不计入 open
  ok(
    "台账处置 closed → 该件不计入 open",
    !ids.includes("I-001") && issueState({ disposition: "closed" }, "open").open === false,
    `ids=${JSON.stringify(ids)}`,
  );

  // 2. 台账处置 fixed → 该件不计入 open
  ok(
    "台账处置 fixed → 该件不计入 open",
    !ids.includes("I-003") && issueState({ disposition: "fixed" }, "open").open === false,
    `ids=${JSON.stringify(ids)}`,
  );

  // 3. 台账无行 + 原件 open → 该件计入 open
  ok(
    "台账无行 + 原件 open → 该件计入 open",
    ids.includes("I-002") && issueState(null, "open").open === true,
    `ids=${JSON.stringify(ids)}`,
  );

  // 4. 件号带 .md 后缀也能匹配台账行
  const ledger = readLedger(LEDGER);
  eq("件号带 .md 后缀也能匹配台账行", ledger["I-001"]?.disposition, "closed");
  ok(
    "件号带 .md 后缀也能匹配台账行(原件 id 不带后缀时同样命中)",
    !openIssues(LEDGER, [{ id: "I-001", title: "x", status: "open" }]).some((x) => x.id === "I-001"),
  );

  // 5. 表格条目的 kind/condition/owner 三列不被归一丢掉
  const tableEntry = debt.deferred.find((d) => d.text === "PostToolUse 精确耗时");
  eq("表格条目的 kind/condition/owner 三列不被归一丢掉", tableEntry && {
    kind: tableEntry.kind,
    condition: tableEntry.condition,
    owner: tableEntry.owner,
  }, {
    kind: "挂条件",
    condition: "宿主事件面新增 PostToolUse → 升级为精确值",
    owner: "每次 release 后查一次",
  });

  // 6. 表格头行与分隔行不算条目
  ok(
    "表格头行与分隔行不算条目",
    !debt.deferred.some((d) => d.text === "项" || d.text === "分类" || d.text === "归属" || /^-+$/.test(d.text)),
    JSON.stringify(debt.deferred.map((d) => d.text)),
  );

  // 7. SUMMARY 的 Deferred Issues 条目进 deferred 列表
  const summaryTexts = debt.deferred.filter((d) => d.source === "01-01-SUMMARY.md").map((d) => d.text);
  ok(
    "SUMMARY 的 Deferred Issues 条目进 deferred 列表",
    summaryTexts.length === 3 && summaryTexts[1] === "预算余 69 行(2931/3000)。",
    JSON.stringify(summaryTexts),
  );

  // 8. 数量自洽
  ok(
    "数量自洽:localIssues.length===1 且 deferred.length===5 且 counts.openIssues===localIssues.length 且 counts.deferred===deferred.length",
    debt.localIssues.length === 1 &&
      debt.deferred.length === 5 &&
      debt.counts.openIssues === debt.localIssues.length &&
      debt.counts.deferred === debt.deferred.length,
    `localIssues=${debt.localIssues.length} deferred=${debt.deferred.length} counts=${JSON.stringify(debt.counts)}`,
  );

  // 9. 批注只数 open 的一条(digested 的不算欠账)
  ok(
    "批注只数 status=open 的,digested 的不计入",
    debt.openAnnotations.length === 1 && debt.openAnnotations[0].id === "a-1" && debt.counts.openAnnotations === 1,
    JSON.stringify(debt.openAnnotations.map((a) => a.id + ":" + a.status)),
  );

  // 10. 顶层无副作用:import 一次不产生任何输出、不落任何文件
  probeImportSideEffects();

  // 10. 另两类来源也走通(SHIP 的 `Deferred:` 行、VERIFICATION 的 `## Deferred Follow-Ups` 段)。
  //     PLAN 指定的八条只覆盖 CONTEXT 表格与 SUMMARY 两种形状,剩下两类不测就等于没实现。
  //     单独喂文本,不进上面的夹具目录 —— 进了会把第 8 条的数量断言带偏。
  const shipEntries = parseDeferred(
    "# 20 SHIP\n\n## 遗留\n\n- Deferred:PostToolUse 精确时长(宿主事件面扩展后);主/子调用精确归属(宿主补 session 标识后)。\n",
    "20-SHIP.md",
  );
  eq("SHIP 的 Deferred: 行进 deferred 列表", shipEntries.map((e) => e.text), [
    "PostToolUse 精确时长(宿主事件面扩展后);主/子调用精确归属(宿主补 session 标识后)。",
  ]);

  const verEntries = parseDeferred(
    "# 02 VERIFICATION\n\n## Deferred Follow-Ups(非缺口,不生成修复计划)\n\n- 将来写派生项会与主项撞身份。**取舍**,记录备查。\n- 另一条待办。\n\n## 下一步\n\n- 不是 deferred。\n",
    "02-VERIFICATION.md",
  );
  eq("VERIFICATION 的 Deferred Follow-Ups 段进 deferred 列表", verEntries.map((e) => e.text), [
    "将来写派生项会与主项撞身份。**取舍**,记录备查。",
    "另一条待办。",
  ]);

  const ctxList = parseDeferred(
    "<deferred>\n\n- PostToolUse 精确时长(宿主事件面扩展后)。\n- 主/子代理调用归因(宿主补 session 标识后)。\n\n</deferred>\n",
    "21-CONTEXT.md",
  );
  eq("CONTEXT 的 <deferred> 无序列表条目进 deferred 列表", ctxList.map((e) => e.kind), ["未分类", "未分类"]);

  rmSync(dir, { recursive: true, force: true });

  const bad = results.filter((r) => !r.pass);
  if (bad.length === 0) {
    console.log("✓ 全过");
    process.exit(0);
  }
  console.log(`${bad.length} 项不过`);
  process.exit(1);
}

/**
 * import 副作用探针:模块被 import 时不能有输出、不能落文件、不能 exit。
 * 顶层 I/O 在被 R-16 真导入时会把别人的 health 检查搅黄(缺路径抛错 / 顶层 exit 假绿),
 * 所以这条要实测,不能靠「读代码看着没有」。
 */
function probeImportSideEffects() {
  const marker = "DEBT_PANEL_IMPORT_OK";
  const emptyDir = mkdtempSync(join(tmpdir(), "debt-panel-empty-"));
  const url = pathToFileURL(MODULE_PATH).href;
  const code = `await import(${JSON.stringify(url)});\nprocess.stdout.write(${JSON.stringify(marker)});`;
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: emptyDir,
    encoding: "utf8",
  });
  const left = readdirSync(emptyDir);
  rmSync(emptyDir, { recursive: true, force: true });

  ok(
    "import 模块无副作用:子进程 stdout 恰好只有标记、目录仍然为空",
    res.status === 0 &&
      res.stdout === marker &&
      res.stderr === "" &&
      left.length === 0,
    `status=${res.status} stdout=${JSON.stringify(res.stdout)} stderr=${JSON.stringify(res.stderr)} left=${JSON.stringify(left)}`,
  );
}

// ---- 入口 ------------------------------------------------------------------

const invokedAs = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedAs && import.meta.url === invokedAs) main();
