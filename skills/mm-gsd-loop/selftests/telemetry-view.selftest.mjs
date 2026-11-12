// 工具遥测视图自测 —— references/telemetry-view.mjs 的口径自证(22-01 T3 / 22-CONTEXT D-03)。
//
// 为什么必须单独一份自测:这个模块的两个口径(按**本地日**切桶、归一后按 cwd 等值比较)写死在代码里,
// 看板读错了不报错 —— 图照样出,只是「天」差一天、或者永远空。图错了比图没了更难发现。
//
// 夹具自己钉住判别力(22-CONTEXT D-03「判别力口径」):instant 取**本地凌晨 02:00** 与
// **次日本地凌晨 02:00** —— 本地构造器 `new Date(y, m, d, 2, 0, 0)` 造(本地构造器即本地时区,
// 不调用实现的切桶函数)。凌晨 02:00 在东八区这类宿主上落在**前一个 UTC 日**,于是「按本地日切桶」
// 与「按 UTC 日切桶」在这份夹具上结果不同 —— 只在白天时刻取样的话两种实现输出一样,
// 断言对错误实现同样为真。
// (UTC 宿主上本地日就等于 UTC 日,这个差异不可观测 —— 宿主时区决定的已知边界,不写降级分支,
//  也不因此判红。)
//
// 为什么 spawn 子进程起服务:mm-gsd-web.mjs 顶层就 server.listen,import 进来会在本进程里
// 起一个常驻服务(端口不释放、health 进程挂住)。夹具放在临时目录,仓库的 .planning 一个字节都不碰。
//
// 跑法:node skills/mm-gsd-loop/selftests/telemetry-view.selftest.mjs
// 退出码即判据:0 = 全过,1 = 有不过。

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { aggregateByDay } from "../references/telemetry-view.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_MJS = join(HERE, "..", "scripts", "mm-gsd-web.mjs");
const TEMPLATE = join(HERE, "..", "templates", "web.html");
const MODULE_PATH = fileURLToPath(new URL("../references/telemetry-view.mjs", import.meta.url));
/** 仓库根(= skills/mm-gsd-loop/selftests 上三级):夹具里的「项目根」就是它。 */
const PROJECT_ROOT = resolve(HERE, "..", "..", "..");

// ---- 断言小工具 ------------------------------------------------------------

const results = [];

function ok(name, cond, detail = "") {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "✓" : "✗"} ${name}${cond || !detail ? "" : " —— " + detail}`);
}

function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(name, g === w, `got=${g} want=${w}`);
}

// ---- 夹具helpers ----------------------------------------------------------

/** 本地日 `YYYY-MM-DD`(月/日补零):自测自己算,不调用实现的切桶函数。 */
const localDay = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

/**
 * 同一个目录的「大小写混合 + 反斜杠 + 尾斜杠」变体。
 * Windows 上大小写不敏感,同一个目录能这么写;直接等值比较会把行全滤掉 → 永远空图(D-03)。
 */
function pathVariant(p) {
  const seg = p.split(/[\\/]/);
  seg[seg.length - 1] = seg[seg.length - 1].toUpperCase(); // 大小写混合
  return seg.join("\\") + "\\"; // 反斜杠 + 尾斜杠
}

/** 极简 HTTP 客户端(零依赖):agent:false 免得 keep-alive 把进程吊住。 */
function httpCall(port, method, path) {
  return new Promise((res, rej) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, agent: false }, (r) => {
      let data = "";
      r.setEncoding("utf8");
      r.on("data", (c) => (data += c));
      r.on("end", () => res({ status: r.statusCode, body: data }));
    });
    req.on("error", rej);
    req.end();
  });
}

/** 起服务,--port 0 让系统挑一个空闲端口(随机端口且不会撞上占用)。 */
function startServer(cwd, env) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [WEB_MJS, "--port", "0"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      rej(new Error("服务启动超时:" + (err || out)));
    }, 15000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      out += c;
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        res({ child, port: Number(m[1]) });
      }
    });
    child.stderr.on("data", (c) => (err += c));
    child.on("exit", (code) => {
      clearTimeout(timer);
      rej(new Error(`服务提前退出 code=${code}:${err || out}`));
    });
  });
}

/** import 副作用探针:模块被 import 时不能有输出、不能落文件、不能 exit。 */
function probeImportSideEffects() {
  const marker = "TELEMETRY_VIEW_IMPORT_OK";
  const emptyDir = mkdtempSync(join(tmpdir(), "telemetry-view-empty-"));
  const url = pathToFileURL(MODULE_PATH).href;
  const code = `await import(${JSON.stringify(url)});\nprocess.stdout.write(${JSON.stringify(marker)});`;
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: emptyDir, encoding: "utf8" });
  const left = readdirSync(emptyDir);
  rmSync(emptyDir, { recursive: true, force: true });

  ok(
    "import 模块无副作用(R-16 会真导入 references/):子进程 stdout 恰好只有标记、目录仍然为空",
    res.status === 0 && res.stdout === marker && res.stderr === "" && left.length === 0,
    `status=${res.status} stdout=${JSON.stringify(res.stdout)} stderr=${JSON.stringify(res.stderr)} left=${JSON.stringify(left)}`,
  );
}

// ---- 主体 ------------------------------------------------------------------

async function main() {
  // ── 夹具的 instant:本地凌晨 02:00 与次日本地凌晨 02:00 ──
  const now = new Date();
  const instantA = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 2, 0, 0);
  const instantB = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 2, 0, 0);
  const tsA = instantA.toISOString();
  const tsB = instantB.toISOString();
  // 本地日由自测自己从 ts 算(new Date(ts) 的 getFullYear/getMonth/getDate)
  const dayA = localDay(new Date(tsA));
  const dayB = localDay(new Date(tsB));

  const variant = pathVariant(PROJECT_ROOT);
  const otherDir = PROJECT_ROOT + "-other";

  // 夹具落盘(真实文件 API):四行 {ts, cwd, tool}
  const fixtureDir = mkdtempSync(join(tmpdir(), "mm-gsd-tel-fixture-"));
  const fixtureFile = join(fixtureDir, "tools.jsonl");
  const fixtureRows = [
    { ts: tsA, cwd: variant, tool: "Bash" }, // 归一后命中(大小写混合 + 反斜杠 + 尾斜杠)
    { ts: tsA, cwd: PROJECT_ROOT, tool: "Bash" },
    { ts: tsB, cwd: PROJECT_ROOT, tool: "Read" },
    { ts: tsB, cwd: otherDir, tool: "Write" }, // 异 cwd → 不计入
  ];
  writeFileSync(fixtureFile, fixtureRows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  // 从磁盘读回来的行(不拿内存对象当输入:换行符/末尾空行的差别是真实存在的)
  const rows = readFileSync(fixtureFile, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

  const tel = aggregateByDay(rows, PROJECT_ROOT);

  // ① 夹具自证有判别力:两个 instant 落在两个不同的本地日(相等即红)
  ok(
    "夹具自证有判别力:两个 instant 落在两个不同的本地日(localDay(A) !== localDay(B))",
    dayA !== dayB,
    `dayA=${dayA} dayB=${dayB}`,
  );

  // ② 桶日期集合 === {localDay(A), localDay(B)}(自测独立拼,YYYY-MM-DD 补零)
  const dates = [...new Set(tel.series.map((s) => s.date))].sort();
  eq("桶日期集合 === {localDay(A), localDay(B)}(按本地日切桶,不按 UTC 日)", dates, [dayA, dayB].sort());

  // ③ 异 cwd 的行不计入
  ok(
    "异 cwd 的行不计入(归一后与项目根不等值的行被滤掉)",
    tel.byTool.Write === undefined && tel.total === 3,
    `byTool=${JSON.stringify(tel.byTool)} total=${tel.total}`,
  );

  // ④ 硬编码期望值(不按同一套归一规则再数一遍)
  eq("total === 3", tel.total, 3);
  eq("byTool 写死为 {Bash: 2, Read: 1}", { Bash: tel.byTool.Bash, Read: tel.byTool.Read, keys: Object.keys(tel.byTool).sort() }, { Bash: 2, Read: 1, keys: ["Bash", "Read"] });
  eq("series.length === 2", tel.series.length, 2);
  eq("empty === false", tel.empty, false);

  // ⑤ 空夹具走空态分支
  const emptyTel = aggregateByDay([], PROJECT_ROOT);
  ok(
    "空夹具:series 为空且 empty 为真",
    emptyTel.series.length === 0 && emptyTel.empty === true,
    JSON.stringify(emptyTel),
  );

  // ⑥ 模块顶层无副作用(R-16 真导入 references/:顶层 exit 会让整场 health 假绿)
  probeImportSideEffects();

  // ⑦ 模板侧:内联 SVG + 零命中文案
  const html = readFileSync(TEMPLATE, "utf8");
  ok("模板含内联 <svg(零第三方图表库,守 R-06)", html.includes("<svg"), "");
  ok("模板含零命中文案「本项目暂无工具遥测记录」", html.includes("本项目暂无工具遥测记录"), "");

  // ⑧ 服务侧:spawn 子进程(tmpdir 作 cwd、随机端口、遥测路径经环境变量注入)
  const webRoot = mkdtempSync(join(tmpdir(), "mm-gsd-tel-web-"));
  const oneFile = join(fixtureDir, "tools-one.jsonl");
  writeFileSync(oneFile, JSON.stringify({ ts: tsA, cwd: pathVariant(webRoot), tool: "Bash" }) + "\n", "utf8");
  let child = null;
  try {
    const started = await startServer(webRoot, { ...process.env, GSD_TOOL_TELEMETRY_PATH: oneFile });
    child = started.child;
    const st = JSON.parse((await httpCall(started.port, "GET", "/api/state")).body);

    ok("/api/state 含 telemetry 字段", !!st.telemetry && Array.isArray(st.telemetry.series) && !!st.telemetry.byTool, JSON.stringify(Object.keys(st.telemetry || {})));
    eq("/api/state 的 telemetry.total === 1(注入文件只有一行,cwd 写成项目根变体)", st.telemetry.total, 1);
    ok(
      "/api/state 的 telemetry 自洽:total === series 之和且 empty 为假",
      st.telemetry.total === st.telemetry.series.reduce((n, s) => n + s.count, 0) && st.telemetry.empty === false,
      JSON.stringify(st.telemetry),
    );
  } catch (e) {
    ok("服务探针异常", false, e && e.stack ? e.stack : String(e));
  } finally {
    if (child) {
      child.kill();
      await new Promise((r) => {
        if (child.exitCode !== null) return r();
        child.once("exit", r);
        setTimeout(r, 1500);
      });
    }
    for (const d of [webRoot, fixtureDir]) {
      try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* 残留临时目录不算失败 */ }
    }
  }

  const bad = results.filter((r) => !r.pass);
  console.log(`\n${results.length - bad.length}/${results.length} 条通过`);
  process.exit(bad.length ? 1 : 0);
}

// ---- 入口 ------------------------------------------------------------------

const invokedAs = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedAs && import.meta.url === invokedAs) main();
