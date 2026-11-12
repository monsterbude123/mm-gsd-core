// 看板探针自测 —— 22-01 T2:债面板上屏 + 处置口径全屏统一(D-02/D-05)。
//
// 为什么必须 spawn 子进程起服务:mm-gsd-web.mjs 顶层就 server.listen,import 进来会在本进程里
// 起一个常驻服务(端口不释放、health 进程挂住)。夹具放在临时目录、服务 cwd = 临时目录,
// 仓库的 .planning 一个字节都不碰。
//
// 为什么临时夹具里 LEDGER 处置 closed/fixed 而原件状态还写着 open:这正是要防的那个 bug ——
// 面板按原件状态数会虚报「未闭环问题」(D-02:台账处置列是唯一权威,原件是审计痕迹一行不改)。
//
// 退出码即判据:任一断言失败 → 1。

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_MJS = join(HERE, "..", "scripts", "mm-gsd-web.mjs");
const TEMPLATE = join(HERE, "..", "templates", "web.html");

/** 极简 HTTP 客户端(零依赖):agent:false 免得 keep-alive 把进程吊住。 */
function httpCall(port, method, path, body) {
  return new Promise((res, rej) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method, agent: false, headers: body ? { "content-type": "application/json" } : {} },
      (r) => {
        let data = "";
        r.setEncoding("utf8");
        r.on("data", (c) => (data += c));
        r.on("end", () => res({ status: r.statusCode, body: data }));
      },
    );
    req.on("error", rej);
    if (body) req.write(body);
    req.end();
  });
}

/** 造夹具:.planning/ 下 issues/ 三件 + 台账 + 两个工件 + 批注 + STATE。 */
function writeFixture(root) {
  const pl = join(root, ".planning");
  mkdirSync(join(pl, "issues"), { recursive: true });

  const issue = (id, title) => `# ${id} ${title}\n\n## 状态\n\nopen\n\n## 证据\n\n(夹具,不展开)\n`;
  writeFileSync(join(pl, "issues", "I-001.md"), issue("I-001", "台账已 closed"));
  writeFileSync(join(pl, "issues", "I-002.md"), issue("I-002", "台账无行,回退原件"));
  writeFileSync(join(pl, "issues", "I-003.md"), issue("I-003", "台账已 fixed"));

  // 台账:处置列是唯一权威;I-002 故意不给行(逼出「回退原件状态」这条路)
  writeFileSync(
    join(pl, "issues", "LEDGER.md"),
    [
      "# 豁免台账 —— 本地账 I-* 处置登记",
      "",
      "| 件 | 处置 | 挂靠 | 说明 |",
      "|---|---|---|---|",
      "| I-001.md | closed | — | 已修 |",
      "| I-003.md | fixed | — | 已修留尾巴 |",
      "",
    ].join("\n"),
  );

  // CONTEXT 的 <deferred> 四列表格(项 / 分类 / 触发条件或关闭理由 / 归属)
  writeFileSync(
    join(pl, "01-CONTEXT.md"),
    [
      "# 上下文",
      "",
      "<deferred>",
      "",
      "| 项 | 分类 | 触发条件 / 关闭理由 | 归属 |",
      "|---|---|---|---|",
      "| 宿主事件面补精确耗时 | 挂条件 | 宿主新增 PostToolUse → 升级为精确值 | 每次 release 后查一次 |",
      "| 多项目看板 | 关闭 | 单项目已够,换项目再起一个 | 不重开 |",
      "",
      "</deferred>",
      "",
    ].join("\n"),
  );

  // SUMMARY 的 ## Deferred Issues 段
  writeFileSync(
    join(pl, "01-01-SUMMARY.md"),
    ["# 01-01 摘要", "", "## Deferred Issues", "", "- 票级归属细化", "- 沙箱机制研究", "- 历史票隔离口径", "",].join("\n"),
  );

  // 批注:一条 open、一条 digested —— 只数 open
  writeFileSync(
    join(pl, "annotations.json"),
    JSON.stringify(
      [
        { id: "a-1", ts: "2026-01-01T00:00:00.000Z", target: "REQ-22", type: "备注", text: "还没消化", status: "open" },
        { id: "a-2", ts: "2026-01-01T00:00:00.000Z", target: "phase:22", type: "需求遗漏", text: "已消化", status: "digested" },
      ],
      null,
      2,
    ) + "\n",
  );

  writeFileSync(join(pl, "STATE.md"), ['---', 'status: active', 'active_phase: "22"', '---', "", "# 状态", ""].join("\n"));
}

/** 起服务,--port 0 让系统挑一个空闲端口(随机端口且不会撞上占用)。 */
function startServer(cwd) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [WEB_MJS, "--port", "0"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
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

/**
 * 从服务源码里抽出「方法为 POST 且绑定路径」的路由(语义抽取,不用文本计数)。
 * 容错:引号单双、空白多少、方法与路径的先后顺序都认。
 * @param {string} src 服务源码
 * @returns {string[]} 抽出的路径集合(已去重排序)
 */
export function extractPostRoutes(src) {
  const routes = new Set();
  const re = /\bmethod\b\s*(?:===|==|=)\s*["']POST["']/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    // 回退到包住该判定的最内层 if( ... ) 条件,再在条件里找路径字面量
    const before = src.slice(0, m.index);
    let ifAt = -1;
    for (const hit of before.matchAll(/\bif\s*\(/g)) ifAt = hit.index;
    if (ifAt < 0) continue;
    const open = src.indexOf("(", ifAt);
    if (open < 0 || open > m.index) continue;
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) continue;
    const cond = src.slice(open + 1, end);
    const pm = /\b(?:path|pathname|url|originalUrl)\b\s*(?:===|==|=)\s*["']([^"']+)["']/i.exec(cond);
    if (pm) routes.add(pm[1]);
  }
  return [...routes].sort();
}

/**
 * 找「把 deferred: 当写目标值」的写法(判据按模式,不按裸子串)。
 * 引号可前可后两种都要挡;CSS 伪类 #debt-deferred:hover 不算写目标。
 * @param {string} text 模板文本
 * @returns {string[]} 命中的片段(空数组 = 干净)
 */
export function deferredWriteHits(text) {
  const PATTERNS = [
    /["']deferred\s*:/, // "deferred:x" / 'deferred:x'
    /deferred\s*:\s*["']/, // deferred:"x" / deferred:'x'
    /\b(?:data-t|value)\s*=\s*["']?[^"'\s>]*\bdeferred\s*:/i, // 写目标属性里带 deferred:
  ];
  const hits = [];
  for (const re of PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push(m[0]);
  }
  return hits;
}

async function main() {
  const results = [];
  const ok = (name, cond, detail = "") => {
    results.push({ name, pass: !!cond });
    console.log(`${cond ? "✓" : "✗"} ${name}${cond || !detail ? "" : " —— " + detail}`);
  };

  const root = mkdtempSync(join(tmpdir(), "mm-gsd-board-probe-"));
  let child = null;
  try {
    writeFixture(root);
    const started = await startServer(root);
    child = started.child;
    const port = started.port;

    const st = JSON.parse((await httpCall(port, "GET", "/api/state")).body);
    const html = (await httpCall(port, "GET", "/")).body;

    // ① debt 字段在
    const hasDebt = !!st.debt && typeof st.debt === "object"
      && Array.isArray(st.debt.localIssues) && Array.isArray(st.debt.openAnnotations)
      && Array.isArray(st.debt.deferred) && !!st.debt.counts;
    ok("/api/state 含 debt 字段", hasDebt, JSON.stringify(Object.keys(st.debt || {})));

    // ② 三个数与三份清单同长
    const c = st.debt.counts;
    ok(
      "数量自洽:counts.openIssues===debt.localIssues.length 且 counts.openAnnotations===debt.openAnnotations.length 且 counts.deferred===debt.deferred.length",
      c.openIssues === st.debt.localIssues.length
        && c.openAnnotations === st.debt.openAnnotations.length
        && c.deferred === st.debt.deferred.length,
      `counts=${JSON.stringify(c)} lens=${st.debt.localIssues.length}/${st.debt.openAnnotations.length}/${st.debt.deferred.length}`,
    );

    // ③ 台账 closed 的不算欠账
    ok("台账处置 closed 的 I-001 不进 localIssues", !st.debt.localIssues.some((x) => x.id === "I-001"), JSON.stringify(st.debt.localIssues.map((x) => x.id)));

    // ④ 台账 fixed 的不算欠账
    ok("台账处置 fixed 的 I-003 不进 localIssues", !st.debt.localIssues.some((x) => x.id === "I-003"), JSON.stringify(st.debt.localIssues.map((x) => x.id)));

    // ⑤ 台账无行 → 回退原件状态,原件 open 才算
    ok("无台账行且原件 open 的 I-002 进 localIssues", st.debt.localIssues.some((x) => x.id === "I-002"), JSON.stringify(st.debt.localIssues.map((x) => x.id)));

    // ⑥ 已消化的批注不计入
    ok("digested 的批注不计入 openAnnotations(只数到 1)", st.debt.openAnnotations.length === 1, `实际 ${st.debt.openAnnotations.length}`);

    // ⑦ KPI 与清单同口径
    const i001 = (st.issues || []).find((i) => i.id === "I-001");
    ok(
      "KPI 与清单同口径:st.issuesOpen === st.debt.localIssues.length 且 st.issues.find(i=>i.id==='I-001').open === false",
      st.issuesOpen === st.debt.localIssues.length && !!i001 && i001.open === false,
      `issuesOpen=${st.issuesOpen} localIssues=${st.debt.localIssues.length} I-001.open=${i001 ? i001.open : "缺件"}`,
    );

    // ⑧ 欠账区四个锚点 id 都在模板里
    const anchors = ['id="debt"', 'id="debt-issues"', 'id="debt-anns"', 'id="debt-deferred"'];
    const missing = anchors.filter((a) => !html.includes(a));
    ok("模板含欠账区四个 id:id=\"debt\"、id=\"debt-issues\"、id=\"debt-anns\"、id=\"debt-deferred\" 四个字符串都在模板里", missing.length === 0, "缺:" + missing.join(","));

    // ⑨ 模板里不得把 deferred: 当写目标值(模式判据;CSS 伪类放行)
    const hits = deferredWriteHits(html);
    const detectorAlive = deferredWriteHits('data-t="deferred:x"').length > 0;
    const cssOk = deferredWriteHits("#debt-deferred:hover").length === 0;
    ok(
      "模板不含写目标里的 deferred: —— 判据按模式而非子串:模板里不得出现把 deferred: 当写目标值的写法(引号可前可后:deferred:\"x\" / \"deferred:x\" 两种都要挡住),但允许 CSS 伪类写法(如 #debt-deferred:hover),所以不许用裸子串判",
      hits.length === 0 && detectorAlive && cssOk,
      `命中=${JSON.stringify(hits)} 探针自检(能抓到=${detectorAlive},不误伤CSS=${cssOk})`,
    );

    // ⑩ 写端点唯一:源码语义抽取 + 运行时虚构路径 404/405(整段探针不碰批注端点)
    const src = (await import("node:fs")).readFileSync(WEB_MJS, "utf8");
    const routes = extractPostRoutes(src);
    const fake = await httpCall(port, "POST", "/api/__probe_no_such_route__", JSON.stringify({ target: "REQ-22", type: "备注", text: "x" }));
    ok(
      "唯一写端点(语义抽取,不用源码文本计数):从服务源码里用容错正则抽出所有「方法为 POST 且绑定路径」的路由(允许空格/引号差异),断言抽出的路径集合恰好等于 {批注端点} 这一个;再运行时 POST 一个虚构路径 → 404/405(证明未知路径不是写入口 —— 注意它不构成第二证:它证明不了「不存在第二个写入口」,唯一性仍由源码抽取那一证承担),且整个探针不向批注端点发请求(避免写脏夹具、避免改动前面的计数断言)",
      JSON.stringify(routes) === JSON.stringify(["/api/annotations"]) && (fake.status === 404 || fake.status === 405),
      `抽出=${JSON.stringify(routes)} 虚构路径状态=${fake.status}`,
    );
  } catch (e) {
    console.log(`✗ 探针异常:${e && e.stack ? e.stack : e}`);
    results.push({ name: "探针异常", pass: false });
  } finally {
    if (child) {
      child.kill();
      await new Promise((r) => {
        if (child.exitCode !== null) return r();
        child.once("exit", r);
        setTimeout(r, 1500);
      });
    }
    // Windows 上子进程刚退时目录可能还锁着;残留一个临时目录不算失败,重试几次即可
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留,忽略 */
    }
  }

  const bad = results.filter((r) => !r.pass);
  console.log(`\n${results.length - bad.length}/${results.length} 条通过`);
  process.exit(bad.length ? 1 : 0);
}

const invokedAs = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedAs && import.meta.url === invokedAs) main();
