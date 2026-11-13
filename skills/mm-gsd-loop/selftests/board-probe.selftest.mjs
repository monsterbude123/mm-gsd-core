// 看板探针自测 —— 22-01 T2:债面板上屏 + 处置口径全屏统一(D-02/D-05);23-02 T3 起兼测多项目聚合
// (全局配置注入 GSD_BOARD_CONFIG_PATH、自动注册、优雅退让、?project= 名单校验,D-04)。
//
// 为什么必须 spawn 子进程起服务:mm-gsd-web.mjs 顶层就 server.listen,import 进来会在本进程里
// 起一个常驻服务(端口不释放、health 进程挂住)。夹具放在临时目录、服务 cwd = 临时目录,
// 仓库的 .planning 一个字节都不碰。
//
// 为什么临时夹具里 LEDGER 处置 closed/fixed 而原件状态还写着 open:这正是要防的那个 bug ——
// 面板按原件状态数会虚报「未闭环问题」(D-02:台账处置列是唯一权威,原件是审计痕迹一行不改)。
//
// 退出码即判据:任一断言失败 → 1。

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
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

  // 防再积黄条夹具(25-CONTEXT D-03):循环生成 31 条未分类(不逐条手写),连同上面 3 条
  // 共 34 条未分类 > 阈值 30 → /api/state 的 debtWarn 非空
  writeFileSync(
    join(pl, "02-01-SUMMARY.md"),
    ["# 02-01 摘要", "", "## Deferred Issues", "",
      ...Array.from({ length: 31 }, (_, i) => `- 夹具未分类欠账 ${i + 1}`), ""].join("\n"),
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

  // PLAN 声明 product_surface(REQ-22)+ 同号 SHIP 已落盘:req-ledger 无 delivered 行
  // → productSurfaceWarn 应非空(REQ-26 对账读端;台账文件整个缺省 = 全部缺行)
  writeFileSync(
    join(pl, "01-01-PLAN.md"),
    ['---', 'phase: "01"', 'plan: "01"', "goal: 夹具计划", "rollback: 回退本票 commit", "product_surface: REQ-22", '---', "", "# 计划", ""].join("\n"),
  );
  writeFileSync(
    join(pl, "01-01-SHIP.md"),
    ['---', 'phase: "01"', "status: shipped", "delivered: 夹具交付(可核对位置)", "---", "", "# 交付", ""].join("\n"),
  );

  // STATE 补 Phases 节(24-01 T1a 夹具,预审 W4):一行带 (depends_on: NN) 注记、一行无;
  // 同号两个 PLAN 必须一起补 —— phases Map 只收有 PLAN 的 phase,只补 STATE 会让拓扑断言空转。
  writeFileSync(
    join(pl, "STATE.md"),
    ['---', 'status: active', 'active_phase: "22"', '---', "", "# 状态", "", "## Phases", "", "- [x] 21 — 已交付阶段", "- [ ] 22 — 进行中阶段 (depends_on: 21)", ""].join("\n"),
  );
  const planFor = (ph) => ['---', `phase: "${ph}"`, 'plan: "01"', "goal: 夹具计划", "rollback: 回退本票 commit", '---', "", "# 计划", ""].join("\n");
  writeFileSync(join(pl, "21-01-PLAN.md"), planFor("21"));
  writeFileSync(join(pl, "22-01-PLAN.md"), planFor("22"));
}

/**
 * 起服务,--port 0 让系统挑一个空闲端口(随机端口且不会撞上占用)。
 * @param {string} cwd 服务的工作目录(自动注册进全局配置的就是它)
 * @param {{port?: number, args?: string[], expectExit?: boolean}} opts
 *   expectExit=true:不解析监听行,等进程自然退出并带出退出码与输出 —— 供「端口被占优雅退让」用例(I1)。
 * @param {string} cfgPath 注入的 GSD_BOARD_CONFIG_PATH(仓库真实 ~/.agents/mm-gsd-board.json 一个字节不碰)
 */
function startServer(cwd, opts = {}, cfgPath) {
  const args = [WEB_MJS, "--port", String(opts.port ?? 0), ...(opts.args || [])];
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, GSD_BOARD_CONFIG_PATH: cfgPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
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
      if (opts.expectExit) return; // 预期提前退出:不按监听行解析
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        res({ child, port: Number(m[1]) });
      }
    });
    child.stderr.on("data", (c) => (err += c));
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (opts.expectExit) res({ code, out, err });
      else rej(new Error(`服务提前退出 code=${code}:${err || out}`));
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

  // 多项目夹具(23 D-04):base 下三个互不相干的目录 —— projA(沿用原夹具)、projB(最小 .planning/)、
  // 注入用的全局配置文件。真实 ~/.agents/mm-gsd-board.json 一个字节不碰。
  const base = mkdtempSync(join(tmpdir(), "mm-gsd-board-probe-"));
  const root = join(base, "projA");
  const rootB = join(base, "projB");
  const CFG_PATH = join(base, "board.json");
  const norm = (p) => String(p).replace(/\\/g, "/");
  const rootN = norm(root);
  const rootBN = norm(rootB);
  const readCfg = () => JSON.parse(readFileSync(CFG_PATH, "utf8")).projects;
  const kids = [];
  let child = null;
  try {
    writeFixture(root);
    mkdirSync(join(rootB, ".planning"), { recursive: true });
    const started = await startServer(root, {}, CFG_PATH);
    child = started.child;
    kids.push(child);
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

    // ⑪ 挂条件/关闭 → parked 不计数且 counts 只算未清偿(23 D-03)
    ok(
      "挂条件/关闭 → parked 不计数且 counts 只算未清偿",
      Array.isArray(st.debt.parked)
        && st.debt.parked.length === 2
        && st.debt.parked.every((d) => d.kind === "挂条件" || d.kind === "关闭")
        && !st.debt.deferred.some((d) => d.kind === "挂条件" || d.kind === "关闭")
        && st.debt.counts.parked === st.debt.parked.length
        && st.debt.counts.deferred === st.debt.deferred.length
        && st.debt.counts.total === st.debt.counts.openIssues + st.debt.counts.openAnnotations + st.debt.counts.deferred,
      `parked=${JSON.stringify(st.debt.parked.map((d) => [d.text, d.kind]))} counts=${JSON.stringify(st.debt.counts)}`,
    );

    // ⑫ product_surface 声明缺台账 delivered 行 → /api/state 的 productSurfaceWarn 非空(REQ-26 对账读端)
    ok(
      "product_surface 声明缺台账 delivered 行 → /api/state 的 productSurfaceWarn 非空",
      Array.isArray(st.productSurfaceWarn) && st.productSurfaceWarn.length > 0 && st.productSurfaceWarn.every((w) => w.includes("REQ-22")),
      JSON.stringify(st.productSurfaceWarn),
    );

    // ⑬ 启动自动注册 cwd 进全局配置(D-04)
    ok("启动自动注册 cwd 进全局配置", readCfg().includes(rootN), JSON.stringify(readCfg()));

    // ⑭ --add 追加并持久化(D-04)
    const bSrv = await startServer(rootB, { args: ["--add", rootB] }, CFG_PATH);
    kids.push(bSrv.child);
    ok("--add 追加并持久化", readCfg().includes(rootBN), JSON.stringify(readCfg()));

    // ⑮ 端口被占 → 优雅退让:注册后退出码 0 且不打印监听行(D-04 / I1)
    const y = await startServer(rootB, { port, expectExit: true }, CFG_PATH);
    ok(
      "端口被占 → 注册后退出码 0 且不打印监听行(优雅退让,不崩)",
      y.code === 0 && !/mm-gsd web →/.test(y.out + y.err) && readCfg().includes(rootBN),
      `code=${y.code} out=${JSON.stringify(String(y.out + y.err).slice(0, 200))}`,
    );

    // ⑯ /api/projects 报 exists(D-04:目录存在性就是全部健康检查)
    const prj = JSON.parse((await httpCall(port, "GET", "/api/projects")).body);
    const pa = prj.find((p) => p.root === rootN);
    ok("/api/projects 报 exists(A 在名单、目录存在、name 为目录名)", Array.isArray(prj) && !!pa && pa.exists === true && pa.name === "projA", JSON.stringify(prj));

    // ⑰ 不存在目录 → exists=false(服务不重启,名单改完下个请求就生效 —— 每请求现读)
    const ghost = norm(join(base, "no-such-dir"));
    writeFileSync(CFG_PATH, JSON.stringify({ projects: [...readCfg(), ghost] }, null, 2) + "\n");
    const prj2 = JSON.parse((await httpCall(port, "GET", "/api/projects")).body);
    const pg = prj2.find((p) => p.root === ghost);
    ok("不存在目录 → /api/projects exists=false(灰显依据)", !!pg && pg.exists === false, JSON.stringify(prj2.map((p) => [p.root, p.exists])));

    // ⑱ B 注册后 A 的 /api/projects 能看到 B(每请求现读全局配置 —— 预审 B2)
    ok("B 注册后 A 的 /api/projects 能看到 B(A 一直运行着,没重启)", prj2.some((p) => p.root === rootBN), JSON.stringify(prj2.map((p) => p.root)));

    // ⑲ ?project= 越名单 → /api/state 与批注都 400;批注落点随 ?project= 切到 B(预审 B3/I2)
    // 「越名单」必须是从未注册过的路径(⑰ 的 ghost 已进名单,不能再当越界样本)
    const stranger = norm(join(base, "stranger-dir"));
    const stB = await httpCall(port, "GET", "/api/state?project=" + encodeURIComponent(rootBN));
    const stGhost = await httpCall(port, "GET", "/api/state?project=" + encodeURIComponent(stranger));
    const annB = await httpCall(port, "POST", "/api/annotations?project=" + encodeURIComponent(rootBN), JSON.stringify({ target: "REQ-22", type: "备注", text: "落 B" }));
    const annGhost = await httpCall(port, "POST", "/api/annotations?project=" + encodeURIComponent(stranger), JSON.stringify({ target: "REQ-22", type: "备注", text: "越名单" }));
    let bAnns = [];
    try { bAnns = JSON.parse(readFileSync(join(rootB, ".planning", "annotations.json"), "utf8")); } catch {}
    ok(
      "?project= 越名单 → /api/state 与批注都 400;批注落点随 ?project= 切到 B 的 annotations.json(A 的批注不被串写)",
      stB.status === 200 && stGhost.status === 400 && annGhost.status === 400
        && annB.status === 200 && JSON.parse(annB.body).ok === true
        && bAnns.length === 1 && bAnns[0].text === "落 B",
      `stB=${stB.status} stGhost=${stGhost.status} annB=${annB.status} annGhost=${annGhost.status} bAnns=${JSON.stringify(bAnns)}`,
    );

    // ── 拓扑纯函数三例(24-01 T1a):spawn 子进程 import phase-topo.mjs 直测(req-ledger selftest 同款手法)──
    // 裸临时 cwd 里跑,stdout 必须恰好是目标 JSON;spawnSync 带超时,模块死循环会被杀成非零退出 ——
    // 「不挂死」本身就是判据的一部分。
    const topoProbe = (code, timeoutMs = 10000) => {
      const url = pathToFileURL(join(HERE, "..", "references", "phase-topo.mjs")).href;
      const dir = mkdtempSync(join(tmpdir(), "mm-gsd-topo-"));
      try {
        return spawnSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(url)});\n${code}`], { cwd: dir, encoding: "utf8", timeout: timeoutMs });
      } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 残留忽略 */ } }
    };
    const probeDetail = (r) => `status=${r.status} stdout=${JSON.stringify(String(r.stdout || "").slice(0, 160))} stderr=${JSON.stringify(String(r.stderr || "").slice(0, 160))}`;

    // ⑳ 注记解析,正负路径都钉(防零匹配空真):注记 → ['NN'],全角括号/冒号同答案,无注记/无/none → []
    {
      const r = topoProbe(`process.stdout.write(JSON.stringify([
        m.parseDepends("22 — 进行中阶段 (depends_on: 21)"),
        m.parseDepends("22 — 进行中阶段 （depends_on：21, 03）"),
        m.parseDepends("21 — 已交付阶段"),
        m.parseDepends("21 — 已交付阶段 (depends_on: 无)"),
        m.parseDepends("21 — 已交付阶段 (depends_on: none)"),
      ]));`);
      let got = null;
      try { got = JSON.parse(r.stdout); } catch { /* 非 JSON = 该用例红 */ }
      ok(
        "拓扑纯函数:depends_on 注记 → ['NN'],无注记 → [](正负路径都钉,防零匹配空真;全角括号/冒号与半角同答案 —— 解析逐字照抄 checker 基线)",
        r.status === 0 && JSON.stringify(got) === JSON.stringify([["21"], ["21", "03"], [], [], []]),
        probeDetail(r),
      );
    }

    // ㉑ 幽灵引用边被丢弃(指向不存在的 phase 不悬空,分层照算)
    {
      const r = topoProbe(`process.stdout.write(JSON.stringify(m.topoLevels([
        { id: "21", depends_on: [] },
        { id: "22", depends_on: ["21", "99"] },
        { id: "23", depends_on: ["22"] },
      ])));`);
      let got = null;
      try { got = JSON.parse(r.stdout); } catch { /* 非 JSON = 该用例红 */ }
      ok(
        "拓扑纯函数:幽灵引用边被丢弃(22 → 99 不存在,边不入 edges;其余边与分层照算)",
        r.status === 0
          && JSON.stringify(got) === JSON.stringify({ levels: [["21"], ["22"], ["23"]], edges: [["21", "22"], ["22", "23"]] }),
        probeDetail(r),
      );
    }

    // ㉒ 环输入 → 确定性剪边后分层有穷且确定(不挂死):21↔22 成环,丢 from-id 最大那条;打乱输入顺序结果不变
    {
      const r = topoProbe(`
        const cyc = [
          { id: "24", depends_on: ["23"] },
          { id: "23", depends_on: [] },
          { id: "21", depends_on: ["22"] },
          { id: "22", depends_on: ["21"] },
        ];
        process.stdout.write(JSON.stringify({ a: m.topoLevels(cyc), b: m.topoLevels([...cyc].reverse()) }));`);
      let got = null;
      try { got = JSON.parse(r.stdout); } catch { /* 非 JSON(含超时被杀)= 该用例红 */ }
      ok(
        "拓扑纯函数:环输入 → 剪边后分层有穷且确定(不挂死;21↔22 成环丢 from-id 最大那条,输入乱序结果逐字节相同)",
        r.status === 0 && !!got && JSON.stringify(got.a) === JSON.stringify(got.b)
          && JSON.stringify(got.a) === JSON.stringify({ levels: [["21", "23"], ["22", "24"]], edges: [["21", "22"], ["23", "24"]] }),
        probeDetail(r),
      );
    }

    // ㉓ /api/state 的 phases[].level 与 topo.edges 与夹具一致(服务端算好,客户端零计算 —— 24-01 T1b 的数据面)
    {
      const ph21 = st.phases.find((p) => p.phase === "21");
      const ph22 = st.phases.find((p) => p.phase === "22");
      ok(
        "/api/state 的 phases[].level 与 topo.edges 与夹具一致(21 无注记 → level 0 空依赖;22 注记 → level 1 依赖 21;顶层 topo.edges 恰含 21→22)",
        Array.isArray(st.topo?.edges)
          && JSON.stringify(st.topo.edges) === JSON.stringify([["21", "22"]])
          && !!ph21 && ph21.level === 0 && Array.isArray(ph21.depends_on) && ph21.depends_on.length === 0
          && !!ph22 && ph22.level === 1 && Array.isArray(ph22.depends_on) && JSON.stringify(ph22.depends_on) === JSON.stringify(["21"]),
        `topo=${JSON.stringify(st.topo)} ph21=${JSON.stringify(ph21 && { level: ph21.level, depends_on: ph21.depends_on })} ph22=${JSON.stringify(ph22 && { level: ph22.level, depends_on: ph22.depends_on })}`,
      );
    }

    // ㉔ 防再积黄条(25-CONTEXT D-03):夹具循环生成 31 条未分类 → /api/state 的 debtWarn 非空且带计数与阈值
    {
      const dw = st.debtWarn;
      // 当前未分类计数 = 循环生成的 31 条 + 01-01-SUMMARY 既有 3 条 = 34,阈值 30
      ok(
        "夹具循环生成 31 条未分类 → /api/state 的 debtWarn 非空且带计数(34 = 31 循环生成 + 3 既有)与阈值(30),措辞含「未分类」",
        Array.isArray(dw) && dw.length === 1 && dw[0].includes("未分类") && dw[0].includes("34") && dw[0].includes("30"),
        JSON.stringify(dw),
      );
    }
  } catch (e) {
    console.log(`✗ 探针异常:${e && e.stack ? e.stack : e}`);
    results.push({ name: "探针异常", pass: false });
  } finally {
    for (const k of kids.length ? kids : child ? [child] : []) {
      try {
        k.kill();
        await new Promise((r) => {
          if (k.exitCode !== null) return r();
          k.once("exit", r);
          setTimeout(r, 1500);
        });
      } catch {
        /* 已退出,忽略 */
      }
    }
    // Windows 上子进程刚退时目录可能还锁着;残留一个临时目录不算失败,重试几次即可
    try {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
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
