#!/usr/bin/env node
// mm-gsd-web —— 过程看板:固定模板 + 实时 .planning 只读渲染 + 批注唯一写通道(phase 21,REQ-19/20);
// phase 23 起多项目聚合(D-04,REQ-27):全局名单 ~/.agents/mm-gsd-board.json,启动自动注册 cwd,
// ?project= 参数化 /api/state 与批注落点,端口被占(EADDRINUSE)优雅退让不崩。
//
// 零依赖(node 内置 http);只绑 127.0.0.1;对 .planning 只读 —— 唯一写通道是 POST /api/annotations
// (落 annotations.json,schema 校验,失败不落盘)。纯展示 + 批注,不提供改工件能力(D-10)。
//
// 自含解析逻辑,不 import checker —— checker 顶层有 MODE 分流与 process.exit 钩子,import 会拉入副作用;
// 代价是解析逻辑与 checker 各一份(预审 F8 已知取舍),对账由 fixture 断言兜(REQ 认领两种口径同数)。
//
// 例外:债面板口径(本地账 open / 未消化批注 / deferred 条目)走 references/debt-panel.mjs ——
// 那个模块是零 I/O 纯函数,顶层不执行任何东西,import 无副作用(22-CONTEXT D-02/D-05)。
// 口径写两处必然漂:一处按台账、一处按原件状态,屏上会打出两个打架的「本地账 open」数字。
//
// 例外:工具遥测口径(按本地日切桶 + 按 cwd 归一比较)走 references/telemetry-view.mjs ——
// 同样是零 I/O 纯函数;读文件在 buildState() 里做(每次请求现读现算,只读、不外发、不缓存)。

import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDebt } from "../references/debt-panel.mjs";
import { parseReqLedger, reqState } from "../references/req-ledger.mjs";
import { readRows } from "../references/telemetry-aggregate.mjs";
import { aggregateByDay } from "../references/telemetry-view.mjs";
// 拓扑口径(24-01 T1a,D-01):depends_on 解析逐字照抄 checker 基线、分层/剪环/幽灵边防御都在
// references/phase-topo.mjs 一处 —— 同一份 STATE 行,--phases 与看板必须同答案(预审 W1/W2)。
import { topoLevels, parseDepends } from "../references/phase-topo.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(SCRIPT_DIR, "..", "templates", "web.html");

const argv = process.argv.slice(2);
const portArg = argv.includes("--port") ? Number(argv[argv.indexOf("--port") + 1]) : NaN;
const PORT = Number.isFinite(portArg) ? portArg : 4620;
const ROOT = process.cwd();
const addArg = argv.includes("--add") && argv[argv.indexOf("--add") + 1] ? resolve(argv[argv.indexOf("--add") + 1]) : null;
const P = (root, ...s) => join(root, ".planning", ...s);

// 全局看板配置(D-04):~/.agents/mm-gsd-board.json,可用环境变量 GSD_BOARD_CONFIG_PATH 覆盖
// (自测注入用,不碰真实配置)。形状 {"projects": ["<归一化绝对路径>",...]};
// 路径 windows 反斜杠转正斜杠,名单比较按归一化后全串等值(I2)。
const CONFIG_PATH = process.env.GSD_BOARD_CONFIG_PATH || join(homedir(), ".agents", "mm-gsd-board.json");
const normPath = (p) => String(p ?? "").replace(/\\/g, "/");
const ROOT_N = normPath(ROOT);

function readProjects() {
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return Array.isArray(cfg.projects) ? cfg.projects.map(normPath).filter(Boolean) : [];
  } catch { return []; }
}

// merge-on-write(预审 W1):写前重读只追加缺项,防两进程互覆盖 —— 单机单用户,不做文件锁(残余入 deferred)
function registerProjects(roots) {
  const merged = [...readProjects()];
  let changed = false;
  for (const r of roots) if (r && !merged.includes(r)) { merged.push(r); changed = true; }
  if (!changed) return;
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify({ projects: merged }, null, 2) + "\n");
}

// ?project= 解析:每请求现读全局配置(预审 B2)—— 运行中的服务因此能看见别处新注册的项目。
// 归一化后与名单全串等值;不在名单 → ok:false(400);缺省 = 服务 cwd。
function resolveProject(url) {
  const projects = readProjects();
  const qp = url.searchParams.get("project");
  if (qp == null) return { root: ROOT, projects, ok: true };
  const n = normPath(qp);
  return { root: n, projects, ok: projects.includes(n) };
}

// 工具遥测日志(只读):默认 ~/.agents/mm-gsd-tools.jsonl,可用环境变量覆盖(自测注入用)。
// 现读现算、不缓存、不外发 —— 看板不因遥测向任何外部发请求(守 R-06)。
const TELEMETRY_PATH = process.env.GSD_TOOL_TELEMETRY_PATH || join(homedir(), ".agents", "mm-gsd-tools.jsonl");

const TYPES = ["需求遗漏", "方向不对", "验收不过", "备注"];

function fm(text) {
  const m = String(text ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "").replace(/\s+#.*$/, "");
  }
  return out;
}

function walkPl(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of names) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkPl(p, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function ticketsOf(txt) {
  const tickets = [];
  let cur = null;
  for (const line of String(txt ?? "").split(/\r?\n/)) {
    const h = line.match(/^#{2,4}\s+T(\d+[A-Za-z]*)\b\s*(.*)$/);
    if (h) { cur = { id: "T" + h[1], title: h[2].trim(), files: "", verify: "", done: "" }; tickets.push(cur); continue; }
    if (!cur) continue;
    const f = line.match(/^\s*-\s+\*{0,2}files\*{0,2}\s*:\s*(.*)$/i);
    const v = line.match(/^\s*-\s+\*{0,2}verify\*{0,2}\s*:\s*(.*)$/i);
    const d = line.match(/^\s*-\s+\*{0,2}done\*{0,2}\s*:\s*(.*)$/i);
    if (f) cur.files = f[1].trim();
    if (v) cur.verify = v[1].trim();
    if (d) cur.done = d[1].trim();
  }
  return tickets;
}

function coversOf(txt) {
  const out = { reqs: [], decisions: [] };
  for (const m of String(txt ?? "").matchAll(/- \*{0,2}covers\*{0,2}\s*:\s*(.*)$/gim)) {
    for (const tok of m[1].split(/[,\s]+/)) {
      if (/^REQ-[\w.-]+$/i.test(tok)) out.reqs.push(tok.toUpperCase());
      else if (/^D-\d+$/.test(tok)) out.decisions.push(tok);
    }
  }
  return out;
}

// 工具遥测(22-CONTEXT D-03):只读本机日志,现读现算 —— 不缓存(日志会一直追加),
// 不外发(看板不对任何外部发请求,守 R-06)。
// 口径(按本地日切桶 + cwd 归一后等值比较)只在 references/telemetry-view.mjs 一处。
function readTelemetry(root) {
  try {
    return aggregateByDay(readRows(TELEMETRY_PATH), root);
  } catch {
    // 遥测读不到不是看板的错 —— 屏上给空态文案,不报 500。
    return { series: [], byTool: {}, total: 0, empty: true };
  }
}

function buildState(root) {
  const stateFm = existsSync(P(root, "STATE.md")) ? fm(readFileSync(P(root, "STATE.md"), "utf8")) : {};
  const body = existsSync(P(root, "STATE.md")) ? readFileSync(P(root, "STATE.md"), "utf8") : "";
  const phasesFromState = [];
  let inPh = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^##[ \t]*Phases[ \t]*$/i.test(line)) { inPh = true; continue; }
    if (inPh && /^##[ \t]/.test(line)) inPh = false;
    if (inPh) {
      const m = line.match(/^-\s*\[( |x|X)\]\s*(\S+)\s*[—–-]?\s*(.*)$/);
      if (m) phasesFromState.push({ id: m[2], title: m[3].trim(), done: m[1].toLowerCase() === "x", depends_on: parseDepends(m[3]) });
    }
  }

  const allMd = existsSync(P(root, ".")) ? walkPl(P(root, ".")) : [];
  const planPaths = allMd.filter((f) => f.endsWith("-PLAN.md"));
  const checkPaths = new Set(allMd.filter((f) => f.endsWith("-PLAN-CHECK.md")));
  const sumPaths = new Set(allMd.filter((f) => f.endsWith("-SUMMARY.md")));
  const verPaths = new Set(allMd.filter((f) => f.endsWith("-VERIFICATION.md")));
  const shipPaths = new Set(allMd.filter((f) => f.endsWith("-SHIP.md")));
  const ctxPaths = allMd.filter((f) => f.endsWith("-CONTEXT.md"));

  const reqRe = /- (REQ-[\w.-]+)(\(baseline[^)]*\))?:\s*(.*)/;
  const reqs = [];
  if (existsSync(P(root, "REQUIREMENTS.md"))) {
    for (const line of readFileSync(P(root, "REQUIREMENTS.md"), "utf8").split(/\r?\n/)) {
      const m = line.match(reqRe);
      if (m) reqs.push({ id: m[1], baseline: Boolean(m[2]), text: m[3].trim(), claimed: [] });
    }
  }

  const phases = new Map();
  const claimByReq = new Map(reqs.map((r) => [r.id, r]));
  for (const pp of planPaths) {
    const txt = readFileSync(pp, "utf8");
    const f = fm(txt);
    const base = pp.split(/[\\/]/).pop().replace(/-PLAN\.md$/, "");
    const phase = String(f.phase ?? base.slice(0, 2));
    const covers = coversOf(txt);
    const tickets = ticketsOf(txt);
    if (!phases.has(phase)) {
      const st = phasesFromState.find((x) => x.id === phase);
      phases.set(phase, {
        phase, title: st?.title ?? "", done: Boolean(st?.done),
        context: ctxPaths.find((x) => x.split(/[\\/]/).pop().startsWith(phase + "-")) ?? null,
        plans: [], summaries: [], verification: null, ship: null, planChecks: [],
      });
    }
    const card = phases.get(phase);
    const claimedTickets = tickets.map((t) => `${base} ${t.id}`);
    for (const rq of covers.reqs) {
      const r = claimByReq.get(rq);
      if (r) for (const t of claimedTickets) if (!r.claimed.includes(t)) r.claimed.push(t);
    }
    card.plans.push({
      file: pp.split(/[\\/]/).pop(), plan: base, goal: f.goal ?? "",
      isRepair: /-R\d+$/.test(base), wave: f.wave ?? "",
      tickets, coversReq: covers.reqs, coversD: covers.decisions,
      check: (() => {
        const c = [...checkPaths].find((x) => x.split(/[\\/]/).pop().startsWith(base + "-") && x.endsWith("-PLAN-CHECK.md"));
        return c ? { file: c.split(/[\\/]/).pop(), status: fm(readFileSync(c, "utf8")).status ?? "?" } : null;
      })(),
      summary: (() => {
        const c = [...sumPaths].find((x) => x.split(/[\\/]/).pop().startsWith(base + "-"));
        return c ? { file: c.split(/[\\/]/).pop(), status: fm(readFileSync(c, "utf8")).status ?? "?", commits: fm(readFileSync(c, "utf8")).commits ?? "" } : null;
      })(),
    });
  }
  for (const vp of verPaths) {
    const base = vp.split(/[\\/]/).pop().replace(/-VERIFICATION\.md$/, "");
    const phase = base.slice(0, 2);
    if (phases.has(phase)) phases.get(phase).verification = { file: vp.split(/[\\/]/).pop(), status: fm(readFileSync(vp, "utf8")).status ?? "?" };
  }
  for (const sp of shipPaths) {
    const base = sp.split(/[\\/]/).pop().replace(/-SHIP\.md$/, "");
    const phase = base.slice(0, 2);
    if (phases.has(phase)) phases.get(phase).ship = { file: sp.split(/[\\/]/).pop(), status: fm(readFileSync(sp, "utf8")).status ?? "?" };
  }

  let annotations = [];
  try { annotations = JSON.parse(readFileSync(P(root, "annotations.json"), "utf8")); } catch {}

  const contexts = {};
  for (const cp of ctxPaths) {
    const base = cp.split(/[\/]/).pop().replace(/-CONTEXT\.md$/, "");
    const phase = base.slice(0, 2);
    const m = readFileSync(cp, "utf8").match(/<domain>([\s\S]*?)<\/domain>/);
    if (m) contexts[phase] = m[1].trim().slice(0, 6000);
  }

  // 债面板三源(22-CONTEXT D-02/D-05):本地账 open 问题 + 未消化批注 + deferred 条目。
  // 口径只在 references/debt-panel.mjs 一处 —— 这里只把文件文本喂进去,不另读原件状态:
  // 台账处置列是唯一权威,原件「## 状态」只在台账无行时兜底(22-CONTEXT D-02)。
  const planningDir = {};
  for (const abs of allMd) {
    const rel = relative(P(root, "."), abs).split(/[\\/]/).join("/");
    planningDir[rel] = readFileSync(abs, "utf8");
  }
  const debt = buildDebt({ planningDir, annotations });

  // 本地账问题清单:全量入列,每项的 open 走台账口径(与 debt.localIssues 同一判定)。
  // KPI 与清单同源 —— 屏上不会出现两个口径不同的「本地账 open」数字(D-02)。
  const issues = [];
  for (const [rel, text] of Object.entries(planningDir)) {
    if (!/(^|\/)I-[^/]+\.md$/i.test(rel)) continue;
    const base = rel.split("/").pop();
    const id = base.replace(/\.md$/i, "");
    const status = (text.match(/##\s*状态\s*\n+([^\n]+)/) || [])[1]?.trim() ?? "?";
    const title = (text.match(/^#\s+(.+)$/m) || [])[1]?.trim() ?? base;
    issues.push({ id, title: title.replace(new RegExp(`^${id}\\s*`), ""), status, open: false, file: base });
  }
  issues.sort((a, b) => a.id.localeCompare(b.id));
  const openIds = new Set(debt.localIssues.map((x) => x.id));
  for (const i of issues) i.open = openIds.has(i.id.toUpperCase());
  const issuesOpen = debt.localIssues.length;

  // REQ 台账对账读端(REQ-26,23-CONTEXT D-01 写端的读端):扫全部 *-SHIP.md 与对应 PLAN 的
  // product_surface: 声明,SHIP 后 req-ledger 缺该批 REQ 的 delivered 行 → 逐条黄警告
  // (渲染由 23-02 总览票接线)。台账解析口径只在 references/req-ledger.mjs 一处。
  const reqLedgerRows = existsSync(P(root, "req-ledger.md")) ? parseReqLedger(readFileSync(P(root, "req-ledger.md"), "utf8")) : [];
  const productSurfaceWarn = [];
  for (const sp of shipPaths) {
    const base = sp.split(/[\\/]/).pop().replace(/-SHIP\.md$/, "");
    const pp = planPaths.find((x) => x.split(/[\\/]/).pop().replace(/-PLAN\.md$/, "") === base);
    if (!pp) continue;
    const declared = String(fm(readFileSync(pp, "utf8")).product_surface ?? "").match(/REQ-[\w.-]+/gi) ?? [];
    for (const raw of declared) {
      const req = raw.toUpperCase();
      if (reqState(reqLedgerRows, req) !== "delivered")
        productSurfaceWarn.push(`${req} 已随 ${base} 声明 product_surface,但 req-ledger 无 delivered 行 —— SHIP 后落台账(D-01)`);
    }
  }
  // reqs[] 并入台账处置状态(REQ-25/D-01,经 req-ledger 模块;reqLedgerRows 已在对账读端解析,
  // 屏上渲染由 23-02 总览票接线)
  for (const r of reqs) r.disposition = reqState(reqLedgerRows, r.id);

  // state 条(21-01 PLAN 契约):声明 / phase / 工件计数(含 R 票 pending 数)——
  // 只有计数,不含推导判定:推导单一来源是 checker(预审 F3)
  // phase 挂账数(D-05,REQ-28 总览列唯一口径):该 phase 工件里的未清偿 deferred 条数,
  // 按 deferred 条目 source 路径的 <NN>- 前缀归 phase;取分类感知后的未清偿口径(buildDebt 的
  // deferred,parked 已剔除)。总览「挂账」列与「只看有挂账」筛选都消费这一字段 —— 屏上不出现第二个口径。
  const debtByPhase = {};
  for (const d of debt.deferred) {
    const m = String(d.source ?? "").match(/(?:^|\/)(\d{2})-/);
    if (m) debtByPhase[m[1]] = (debtByPhase[m[1]] ?? 0) + 1;
  }
  const phaseList = [...phases.values()].sort((a, b) => a.phase.localeCompare(b.phase));
  // 依赖拓扑(D-01/24-01 T1a):分层与边由服务端纯函数算好,客户端只渲染不计算(T1b)。
  // 只有 STATE 行尾 (depends_on: NN) 注记才有依赖;无注记 = 空数组。无 PLAN 的 phase 不进 phases Map
  // (既有口径),拓扑只在有 PLAN 的 phase 上算。
  const depByPhase = new Map(phasesFromState.map((s) => [s.id, s.depends_on]));
  const topo = topoLevels(phaseList.map((p) => ({ id: p.phase, depends_on: depByPhase.get(p.phase) ?? [] })));
  const levelByPhase = new Map(topo.levels.flatMap((group, li) => group.map((id) => [id, li])));
  for (const p of phaseList) {
    p.debt = debtByPhase[p.phase] ?? 0;
    p.depends_on = depByPhase.get(p.phase) ?? [];
    p.level = levelByPhase.get(p.phase) ?? 0;
  }
  const allPlans = [...phases.values()].flatMap((p) => p.plans);
  return {
    generated: new Date().toISOString(),
    root: normPath(root),
    declared: stateFm.status ?? null,
    activePhase: stateFm.active_phase ?? null,
    state: {
      declared: stateFm.status ?? null,
      activePhase: stateFm.active_phase ?? null,
      plans: allPlans.length,
      summaries: allPlans.filter((x) => x.summary).length,
      repairsPending: allPlans.filter((x) => x.isRepair && !x.summary).length,
    },
    phases: phaseList,
    topo: { edges: topo.edges },
    contexts,
    reqs, annotations,
    issuesOpen, issues,
    debt,
    productSurfaceWarn,
    telemetry: readTelemetry(root),
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw));
    req.on("error", () => resolve(""));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/") {
    try {
      const html = readFileSync(TEMPLATE_PATH);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("模板缺失:templates/web.html");
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/projects") {
    // 项目名单(D-04):每请求现读全局配置 —— 别处新注册的项目,刷新即可见(预审 B2)
    const projects = readProjects();
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(projects.map((root) => ({ root, name: root.split("/").pop() || root, exists: existsSync(root) }))));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/state") {
    const pr = resolveProject(url);
    if (!pr.ok) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, problems: ["project 不在注册名单:" + url.searchParams.get("project")] }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(buildState(pr.root)));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/annotations") {
    // 唯一写通道:schema 校验失败不落盘;只追加 annotations.json,不碰其他工件(D-03/D-10)
    // 批注随项目(预审 B3):?project= 与 /api/state 同一份名单校验,落该项目自己的 annotations.json
    const pr = resolveProject(url);
    if (!pr.ok) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, problems: ["project 不在注册名单:" + url.searchParams.get("project")] }));
      return;
    }
    let body = null;
    try { body = JSON.parse(await readBody(req) || "{}"); } catch {}
    const target = String(body.target ?? "").trim();
    const type = String(body.type ?? "").trim();
    const text = String(body.text ?? "").trim();
    const problems = [];
    if (!target) problems.push("target 缺失(REQ-N / phase:NN / ticket:NN-MM)");
    if (!TYPES.includes(type)) problems.push("type 必须是 " + TYPES.join("/"));
    if (!text) problems.push("text 缺失");
    if (problems.length) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, problems }));
      return;
    }
    let list = [];
    try { list = JSON.parse(readFileSync(P(pr.root, "annotations.json"), "utf8")); } catch {}
    const ann = { id: "a-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6), ts: new Date().toISOString(), target, type, text, status: "open" };
    list.push(ann);
    try {
      writeFileSync(P(pr.root, "annotations.json"), JSON.stringify(list, null, 2) + "\n");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, id: ann.id }));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, problems: ["落盘失败:" + e.message] }));
    }
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
});

// 启动即注册(D-04):cwd(--add 时连同追加目录)merge 进全局配置;写失败不挡看板启动
try { registerProjects([ROOT_N, ...(addArg ? [normPath(addArg)] : [])]); } catch {}

// 端口占用优雅退让(D-04):EADDRINUSE 不崩 —— 把 cwd 注册进全局配置后交棒给已运行的服务,退出码 0
server.on("error", (e) => {
  if (e && e.code === "EADDRINUSE") {
    try { registerProjects([ROOT_N]); } catch {}
    console.log(`已注册到运行中的看板 http://127.0.0.1:${PORT} —— 刷新即可见,Ctrl+C 退出`);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, "127.0.0.1", () => {
  // 打印实际绑定端口(--port 0 = 让系统挑一个空闲端口,自测探针用得上)
  console.log(`mm-gsd web → http://127.0.0.1:${server.address().port}  (cwd: ${ROOT};Ctrl+C 停止)`);
});
