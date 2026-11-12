// REQ 处置台账解析模块自测 —— references/req-ledger.mjs 的口径自证(23-01 T1)。
//
// 为什么单独一份自测:覆盖门与看板都吃这份台账口径,读错了是「该红的 REQ 被静默销红」
// (假销账 = RC2 复发),肉眼很难发现,只能靠机器断言锁住。
//
// 夹具全是纯函数输入,内联字符串即可;唯一要落盘的是 import 副作用探针的空临时目录。
//
// 跑法:node skills/mm-gsd-loop/selftests/req-ledger.selftest.mjs
// 退出码即判据:0 = 全过,1 = 有不过。

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { parseReqLedger, reqState, successorExists } from "../references/req-ledger.mjs";

const MODULE_PATH = fileURLToPath(new URL("../references/req-ledger.mjs", import.meta.url));

// ---- 夹具(形状照 D-01:四列表格 REQ / 处置 / 指向 / 说明)----------------------------

/** REQUIREMENTS.md 夹具:REQ-1..REQ-5。 */
const REQUIREMENTS = `# 需求

- REQ-1: 第一条需求
- REQ-2: 第二条需求
- REQ-3: 第三条需求(REQ-2 的继任者)
- REQ-4: 第四条需求
- REQ-5: 第五条需求
`;

/** 台账夹具:REQ-1 delivered / REQ-2 superseded → REQ-3 / REQ-4 obsolete 挂 D-01;REQ-5 无行。 */
const LEDGER = `# REQ 处置台账

> append-only:原件 REQUIREMENTS.md 零改动,处置记在这里(D-01)。

| REQ | 处置 | 指向 | 说明 |
|---|---|---|---|
| REQ-1 | delivered | v0.5.0 | 已随 0.5.0 发布 |
| REQ-2 | superseded | → REQ-3 | 由 REQ-3 承接 |
| REQ-4 | obsolete | — | 挂 D-01 |
`;

/** 变体台账:REQ-2 的继任者写成 REQ-99(REQUIREMENTS 里不存在)—— 缺席名单用例的靶子。 */
const LEDGER_BAD_SUCCESSOR = LEDGER.replace("→ REQ-3", "→ REQ-99");

/** 变体台账:处置值拼写漂移(deleivered)—— 未知值不销红用例的靶子。 */
const LEDGER_TYPO = `| REQ | 处置 | 指向 | 说明 |
|---|---|---|---|
| REQ-1 | deleivered | v0.5.0 | 拼写漂移 |
`;

// ---- 断言小工具 ----------------------------------------------------------------

const results = [];

function ok(name, cond, detail = "") {
  results.push({ name, pass: !!cond, detail });
  if (cond) console.log(`✓ ${name}`);
  else console.log(`✗ ${name}${detail ? ` —— ${detail}` : ""}`);
}

// ---- 主体 ------------------------------------------------------------------

function main() {
  const rows = parseReqLedger(LEDGER);

  // 1. delivered 的 REQ 判 delivered
  ok("delivered 的 REQ 判 delivered", reqState(rows, "REQ-1") === "delivered", `got=${reqState(rows, "REQ-1")}`);

  // 2. superseded 的 REQ 判 superseded
  ok("superseded 的 REQ 判 superseded", reqState(rows, "REQ-2") === "superseded", `got=${reqState(rows, "REQ-2")}`);

  // 3. obsolete 的 REQ 判 obsolete
  ok("obsolete 的 REQ 判 obsolete", reqState(rows, "REQ-4") === "obsolete", `got=${reqState(rows, "REQ-4")}`);

  // 4. 无台账行的 REQ 判 active
  ok("无台账行的 REQ 判 active", reqState(rows, "REQ-5") === "active", `got=${reqState(rows, "REQ-5")}`);

  // 5. superseded 继任者不存在 → 进缺席名单
  const badRows = parseReqLedger(LEDGER_BAD_SUCCESSOR);
  ok(
    "superseded 继任者不存在 → 进缺席名单",
    JSON.stringify(successorExists(badRows, REQUIREMENTS)) === JSON.stringify(["REQ-2"]),
    `got=${JSON.stringify(successorExists(badRows, REQUIREMENTS))}`,
  );

  // 6. 继任者存在 → 缺席名单为空
  ok(
    "继任者存在 → 缺席名单为空",
    successorExists(rows, REQUIREMENTS).length === 0,
    `got=${JSON.stringify(successorExists(rows, REQUIREMENTS))}`,
  );

  // 7. 表头行与分隔行不算条目
  ok(
    "表头行与分隔行不算条目",
    rows.length === 3 && !rows.some((r) => r.req === "REQ" || /^:?-{2,}:?$/.test(r.req)),
    `got=${JSON.stringify(rows.map((r) => r.req))}`,
  );

  // 8. 认不出的处置值 → active(拼写漂移不销红)
  ok(
    "认不出的处置值 → active(拼写漂移不销红)",
    reqState(parseReqLedger(LEDGER_TYPO), "REQ-1") === "active",
    `got=${reqState(parseReqLedger(LEDGER_TYPO), "REQ-1")}`,
  );

  // import 无副作用探针:模块被 import 时顶层不执行任何 I/O,
  // 子进程 stdout 恰好等于标记才算过(读代码看着没有不算,实测兜住)。
  probeImportSideEffects();

  const bad = results.filter((r) => !r.pass);
  if (bad.length === 0) {
    console.log("✓ 全过");
    process.exit(0);
  }
  console.log(`${bad.length} 项不过`);
  process.exit(1);
}

/** import 副作用探针:spawn 子进程 import 该模块并打印固定标记,stdout 必须逐字节等于标记。 */
function probeImportSideEffects() {
  const marker = "REQ_LEDGER_IMPORT_OK";
  const emptyDir = mkdtempSync(join(tmpdir(), "req-ledger-empty-"));
  const url = pathToFileURL(MODULE_PATH).href;
  const code = `await import(${JSON.stringify(url)});\nprocess.stdout.write(${JSON.stringify(marker)});`;
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: emptyDir,
    encoding: "utf8",
  });
  rmSync(emptyDir, { recursive: true, force: true });

  ok(
    "import 模块无副作用:子进程 stdout 恰好等于标记",
    res.status === 0 && res.stdout === marker,
    `status=${res.status} stdout=${JSON.stringify(res.stdout)} stderr=${JSON.stringify(res.stderr)}`,
  );
}

// ---- 入口 ------------------------------------------------------------------

const invokedAs = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedAs && import.meta.url === invokedAs) main();
