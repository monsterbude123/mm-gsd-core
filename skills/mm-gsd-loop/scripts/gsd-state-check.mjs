#!/usr/bin/env node
// gsd-state-check —— mm-gsd 隐式状态机的确定性检查器
//
// 状态不是散文约定,是工件存在性的推导:CONTEXT→PLAN→SUMMARY→VERIFICATION→SHIP。
// 读取 .planning/,推导"实际在哪一步",与 STATE.md 声明的 status 比对,
// 校验工件字段契约(fake-completed、commits 手填、假 status 都在此拦截)。
//
// 无参数  = 状态行 + 违规清单,违规 exit 1
//   --json    机读:{state, derived, errors, warnings}     --quiet  只退出码(CI)
//   --init    建 STATE.md          --plan  校验 PLAN 文件          --phases 算波次
//   --plan-check <PLAN>  显式校验:这份计划现在能不能开工(退出码 0 = 能)
//   --worktrees 跨 worktree 冲突  --templates 模板自检            --stats   遥测聚合(--tools 工具级视图)
//   --selfcheck  门禁对自己的正则自测(见 references/gate-selftest.mjs)
//
// 零依赖、跨平台(Windows/macOS/Linux)。GSD 原版等价物:verify.plan-structure +
// verification.status;这是它的极简版。

import { readFileSync, readdirSync, existsSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { mmGsdVersion } from "../references/version.mjs";
import { fileURLToPath } from "node:url";

// reopened = 已交付 phase 开了点修 R 票(D-09):重验 passed 后回 shipped;STATE 不许说谎,声明要与推导一致
const STATUSES = ["discussing", "planning", "executing", "verifying", "completed", "shipped", "reopened", "paused"];
const SUMMARY_STATUSES = ["complete", "halted"];
const VERIF_STATUSES = ["passed", "gaps_found", "human_needed"];
const SHIP_STATUSES = ["shipped", "held"];
const PLACEHOLDER = /To be filled|待补|PLACEHOLDER|placeholder|\bTBD\b/i;

// 项目根三态(phase 26 D-21/REQ-48):--planning 的参数 → GSD_PROJECT_DIR → cwd。
// 旧写法把两件事塞进一个 `??`:没有 --planning 时 argv[indexOf+1] 取到 argv[0](node 可执行文件路径),
// `??` 根本不触发 → root 变成 node.exe 所在目录 → 检查器在替别人看别的项目。
// 空串 = 没给(自测夹具故意传空串),--planning 不带值或下一个 token 是选项 → 不崩,按后面两级回落。
const planArg = process.argv.includes("--planning") ? process.argv[process.argv.indexOf("--planning") + 1] : null;
const envRoot = process.env.GSD_PROJECT_DIR && process.env.GSD_PROJECT_DIR.trim() ? process.env.GSD_PROJECT_DIR : null;
const root = planArg && !String(planArg).startsWith("-") ? String(planArg) : envRoot ? envRoot : process.cwd();
const P = (...s) => join(root, ".planning", ...s);

// ---- 遥测:检查器每跑一次自动记一行。放在用户目录,跨项目可比,且不依赖任何人记得写 ----
// 之前的设计是"agent 手工在项目里追加一行",实测零产出——需要自觉的探子等于没有探子。
const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const TELEMETRY = process.env.GSD_TELEMETRY !== "0";
// GSD_TELEMETRY_PATH:测试注入点 —— 自测要在临时路径验证「失败行必须带原因」,不能写真家目录
const TELEMETRY_PATH = process.env.GSD_TELEMETRY_PATH || join(homedir(), ".agents", "mm-gsd-runs.jsonl");
// 工具级遥测日志(REQ-18,hook 脚本 mm-gsd-tool-telemetry.mjs 写入);同构注入先例,缺省与 hook 一致
const TOOL_TELEMETRY_PATH = process.env.GSD_TOOL_TELEMETRY_PATH || join(homedir(), ".agents", "mm-gsd-tools.jsonl");
// sandbox 标记:由**跑沙箱的一方**声明,不由被观测方猜路径。
// 为什么不用「路径含 Temp 就当沙箱」:用户自己建在临时目录里的真项目会被误排除,
// 而自测沙箱也可能被挪到别处。声明式标记不会骗人。
// 用途:自测沙箱里的失败是**正常的**(那是在故意造失败),不该混进
// 「最该修的地方」排行 —— 否则 observe 环的诊断入口被自己的自测噪声淹掉。
const SANDBOX = process.env.GSD_SANDBOX === "1";
// 显式开工判定(--plan-check)与规划期体检(--plan)是**两个模式**:语义不同,不能共用一个开关。
const PLAN_CHECK = process.argv.includes("--plan-check");
const MODE = ["init", "worktrees", "plan", "plan-check", "phases", "stats", "route"].find((m) => process.argv.includes("--" + m))
  ?? (process.argv.includes("--json") ? "check-json" : "check");
const runRec = { ts: new Date().toISOString(), t0: Date.now(), mode: MODE, cwd: root, sandbox: SANDBOX, ver: mmGsdVersion(SKILL_DIR), declared: null, derived: null, phase: null, tier: null /* 无值源:路由 tier 声明是 REQ-73(phase 35)的交付,先记 null 不发明口径(预审 34-F7) */, errors: [], warnings: [] };
// exit 钩子保证每个 process.exit 路径都被记到,不靠人工在分支里记得写
process.on("exit", (code) => {
  if (!TELEMETRY) return;
  try {
    mkdirSync(dirname(TELEMETRY_PATH), { recursive: true });
    appendFileSync(TELEMETRY_PATH, JSON.stringify({ ...runRec, exit: code, duration_ms: Date.now() - runRec.t0 }) + "\n");
  } catch {}   // 遥测失败绝不阻断流程
});

const errors = [];
const warnings = [];
const err = (m, fix) => { errors.push({ message: m, fix: fix ?? "" }); runRec.errors.push(m); };
const warn = (m, fix) => { warnings.push({ message: m, fix: fix ?? "" }); runRec.warnings.push(m); };

/**
 * 早退出口 —— 打印给人看的同时**把原因写进遥测**。
 *
 * 为什么要有它:遥测里 97% 的失败是「零消息」(实测 4956 条真实记录、1822 次失败、
 * 1770 次 errors/warnings 全空)—— 这些路径直接 console.log + process.exit(1),不经过
 * err(),原因只进了 stdout。于是 --stats 报不出「高频报错类型排行」,observe 环看到的是
 * 一片无原因的失败,抓不到「同一处反复失败」。门禁失明了,observe 环就跟着失明。
 */
function die(message, fix) {
  if (message) console.log(message);
  if (fix) console.log(fix);
  err(message, fix);
  process.exit(1);
}

// ---- 极简 frontmatter 解析(不引 YAML 依赖);剥行尾 # 注释,否则模板照抄即报错 ----
// REQ-67:实现唯一化 —— 逻辑住 references/ssot.mjs(contractFrontmatter);
// REQ-68:STATE/PLAN 走 format-aware 读(镜像新鲜用 JSON,陈旧回落 Markdown)。
const { contractFrontmatter } = await import("../references/ssot.mjs");
function frontmatter(path) {
  return contractFrontmatter(join(root, ".planning"), path);
}

// ---- PLAN 解析(--plan / --phases / --worktrees 共用)----
// 模糊措辞让机器无法判断并行冲突。两条正则的唯一实现住 references/state-derive.mjs
// (REQ-69 收拢:此前主脚本与 gate-selftest 各持一份字面量 —— 两份必然走偏,phase 32 同一课);
// #6/#7 的坑注释随常量住在唯一定义点,用例与理由见 references/gate-selftest.mjs。
const { VAGUE_FILE, DEP_RE } = await import("../references/state-derive.mjs");
// 「无 / none」是"没有依赖"的写法,中文 STATE.md 实际都这么写。
// 不过滤就会报「phase 01 依赖了不存在的 phase 无」。
const splitDeps = (raw) => raw.split(/[,\s]+/).map(unquote)
  .filter((d) => d && !/^(无|无依赖|none|n\/a|-)$/i.test(d));
// 缩水措辞(skill「缩水禁令」);v1 只警告——"v1 API" 是合法命名,误杀成本更高
const SHRINK_STRONG = /simplified|placeholder|basic version|minimal implementation|skip for now|will be wired later|简化版|暂时先|先不做|后面再接/i;
const SHRINK_WEAK = /\bv1\b/i;
const NO_DIRECTION = /^(tbd|n\/?a|none|待补|待定|-|—|\.\.\.)$/i;
const ALWAYS_TRUE = /\|\|\s*true\b|2>\/dev\/null\s*\|\|\s*echo/i;

const unquote = (s) => String(s ?? "").replace(/^["']|["']$/g, "").trim();

/** 从 PLAN 全文抽 files_modified(三种写法)/ REQ-* / D-NN;cwd/batch_verify/red_windows 供 #16/#17/#18 的门禁用 */
function parsePlanFile(txt) {
  const files = new Set(), reqs = new Set(), decisions = new Set();
  const redWindows = [];
  let cwd = "", batchVerify = "", inBlock = false, inRed = false, inBv = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) {
      const k = kv[1].toLowerCase();
      if (k === "cwd") cwd = unquote(kv[2]);
      else if (k === "batch_verify") { const v = kv[2].trim(); if (v && !/^[|>][+-]?$/.test(v)) batchVerify = v; }
      inBlock = k === "files_modified";
      inRed = k === "red_windows";
      inBv = k === "batch_verify";
      if (inBlock) {
        for (const f of unquote(kv[2].replace(/^\[/, "").replace(/\]$/, "")).split(/[,\s]+/)) {
          if (f && f !== "-" && f.toLowerCase() !== "none") files.add(f);
        }
      }
      continue;
    }
    if (inBlock) {                                  // YAML 列表续行
      const li = line.match(/^\s+-\s+(.+?)\s*$/);
      if (li) { const f = unquote(li[1]); if (f) files.add(f); }
      else if (line.trim()) inBlock = false;         // 遇到新内容行 → 块结束
      continue;
    }
    if (inRed) {                                    // 红窗清单续行(phase 14 D-02)
      const li = line.match(/^\s+-\s+(.+?)\s*$/);
      if (li) redWindows.push(li[1]);
      else if (line.trim()) inRed = false;
      continue;
    }
    if (inBv) {                                     // batch_verify 多行续行(phase 15 D-01):空行跳过,缩进行逐条收
      if (!line.trim()) continue;
      if (/^\s/.test(line)) batchVerify = batchVerify ? batchVerify + "\n" + line.trim() : line.trim();
      else inBv = false;
    }
  }
  for (const m of txt.matchAll(/\bREQ-[A-Za-z0-9._-]+/g)) reqs.add(m[0]);
  for (const m of txt.matchAll(/\bD-\d+\b/g)) decisions.add(m[0]);
  return { files: [...files], reqs: [...reqs], decisions: [...decisions], cwd, batchVerify, redWindows };
}

/** 列出 .planning 下的 PLAN 文件(双布局) */
function listPlanFiles(plDir) {
  let out = [];
  try { out = readdirSync(plDir).filter((f) => f.endsWith("-PLAN.md")); } catch {}
  try {
    for (const d of readdirSync(join(plDir, "phases"), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const f of readdirSync(join(plDir, "phases", d.name))) {
        if (f.endsWith("-PLAN.md")) out.push(join("phases", d.name, f));
      }
    }
  } catch {}
  return out;
}

// ---- --worktrees:多工作树并发视图(必须早于 STATE 检查:主 worktree 可能根本没初始化)----
// 判定逻辑在 references/worktree-view.mjs —— 搬出去的理由见那个文件头(phase 04 腾头寸)。
// PLAN 的解析三件套在主脚本里,搬过来抄一份就是第二真相源,所以注入进去。
if (process.argv.includes("--worktrees")) {
  const { runWorktrees } = await import("../references/worktree-view.mjs");
  process.exit(runWorktrees({ cwd: process.cwd(), plan: { frontmatter, parsePlanFile, listPlanFiles }, die, err }));
}

// ---- --plan / --plan-check:计划质量门禁(散文约定 → 可执行检查)----
// --plan = 规划期体检:预审还没派不算红(那时预审本来就还没发生)。
// --plan-check = 开工判定:预审没做/结论非法/结论没 passed,一律判不能开工。
// 两者共用同一批机器判据,差的是「预审工件」这一层 —— 只有显式校验才问它。
if (process.argv.includes("--plan") || PLAN_CHECK) {
  const errs = [], warns = [];
  // 遥测同源(phase 18):局部 e/w 必须同步写 runRec,否则 --plan/--plan-check 的失败在遥测里零原因
  // —— 实测 91% 失败行无原因,observe 环对这两条最常用的模式全盲
  const e = (m, fix) => { errs.push({ message: m, fix: fix ?? "" }); runRec.errors.push(m); };
  const w = (m, fix) => { warns.push({ message: m, fix: fix ?? "" }); runRec.warnings.push(m); };

  const at = process.argv.indexOf(PLAN_CHECK ? "--plan-check" : "--plan");
  // #14:收集所有非 -- 开头的位置参数 —— 一批同 phase 计划一次圈定,批图才有比较对象
  const rest = process.argv.slice(at + 1).filter((a) => !a.startsWith("--"));
  const arg = rest[0];
  // 三种写法都收:.planning/02-01-PLAN.md、02-01-PLAN.md、绝对路径;已含 .planning 的别再拼一次
  const resolve = (rel) => {
    const n = rel.replace(/\\/g, "/");
    if (n.startsWith(".planning/") || n.includes("/.planning/") || /^[A-Za-z]:\//.test(n) || n.startsWith("/")) return n;
    return P(rel);
  };
  const targets = rest.length
    ? rest
    : (() => {                                        // 默认:当前 active_phase 的 PLAN
      const active = unquote(frontmatter(P("STATE.md"))?.active_phase);
      const all = listPlanFiles(P("."));
      if (!active) return all;
      const scoped = all.filter((f) => f.split(/[\\/]/).pop().startsWith(active + "-") || f.includes(join("phases", active)));
      // #14:圈定导致其它 phase 的计划一份未查时,必须说出口 —— 静默会让人以为「全批都过了」
      const others = all.filter((f) => !scoped.includes(f));
      if (others.length) {
        const ph = [...new Set(others.map((f) => f.split(/[\\/]/).pop().slice(0, 2)))].join("/");
        console.log("  · active_phase=" + active + ";另有 " + others.length + " 份其它 phase(" + ph + ")的计划未检查 —— 用 --plan <路径…> 显式圈定(issue #14)");
      }
      return scoped.length ? scoped : all;
    })();

  if (!targets.length) {
    die("未找到任何 *-PLAN.md —— 先按 templates/plan.md 落盘,再跑本检查。");
  }

  const batchPlans = [], review = [], reviewErrs = [];
  const { checkTicketBudget } = await import("../references/worktree-view.mjs");
  const { checkDiscriminatingLints, checkZeroMatchErrors, checkBatchVerifyLints } = await import("../references/verification-gates.mjs");
  // 已收口的票(status: complete)退出该票的全部门禁(phase 26 D-12/D-14):
  // 那张票自己的检查跑在历史工件上,恒红 = 门禁报废,不是严(见 ticket-alive.mjs 的 T-13)。
  const { readSummaries, ticketsCovered } = await import("../references/ticket-alive.mjs");
  const summaries = readSummaries(root);
  let skippedDone = 0;
  for (const rel of targets) {
    const path = resolve(rel);
    if (!existsSync(path)) { e(`${rel}: 文件不存在`, "路径写错,或 PLAN 还没落盘"); continue; }
    const txt = readFileSync(path, "utf8");
    const fm = frontmatter(path) ?? {};
    const parsed = parsePlanFile(txt);
    const name = rel.split(/[\\/]/).pop();
    const relForCtx = dirname(rel);
    // R 票(点修票,phase 21 D-06):修既有真相,不是新研究;串行修复不进并行面。
    // wave 可空不判红 —— --plan 本就不校验 wave(wave 只在 --phases 波次计算与 exec 的 wave-check 里用),
    // R 票是原 phase 收尾后的串行补票,不进波次批闸(wave-check 只收 NN-<数字>-PLAN.md)。
    const isRepair = /^\d{2}-R\d+-PLAN\.md$/.test(name);
    // 预审工件(只有 --plan-check 判):显式校验问的是「现在能不能开工」,不是「合不合规」。
    // 判定住在 references/plan-ready.mjs —— 主脚本只留接线。
    if (PLAN_CHECK) {
      const pr = await import("../references/plan-ready.mjs");
      // phaseNo 在本循环下游才声明(TDZ)——这里就地从文件名取 phase
      const convPhase = (name.match(/^(\d+)/) || [])[1] ?? "";
      const conv = pr.readPhaseConvergence(dirname(path), convPhase);
      // 乘法只在多票时存在:同 phase 未收口票 ≥2 才要求 phase 级收敛(单票夹具/单票 phase 的票级预审即收敛)
      let unclosedSamePhase = 0;
      try {
        for (const n of readdirSync(dirname(path))) {
          if (!n.startsWith(convPhase + "-") || !n.endsWith("-PLAN.md")) continue;
          try { if (!/^status:\s*complete/m.test(readFileSync(join(dirname(path), n.replace(/-PLAN\.md$/, "-SUMMARY.md")), "utf8"))) unclosedSamePhase++; } catch { unclosedSamePhase++; }
        }
      } catch { /* 目录读不到就按 1 计 */ }
      const superseded = conv.present;
      if (superseded) {
        w(`[REVIEW-CONVERGENCE] phase ${convPhase} 预审收敛在位(round ${conv.latest.round},status ${conv.latest.status})—— 票级预审由 phase 收敛取代`);
        if (conv.stalled) e(conv.stalledMsg + " 停滞,转人", "拿收敛清单拍板:Proceed(把判断项归 Deferred 带进施工)或 Manual review");
      } else if (Number(convPhase) >= pr.PHASE_CONVERGENCE_REQUIRED_FROM && unclosedSamePhase >= 2) {
        e(`[REVIEW-CONVERGENCE] phase ${convPhase} 缺 phase 级预审收敛工件(<${convPhase}-REVIEW-CONVERGENCE.md>)—— ${pr.PHASE_CONVERGENCE_REQUIRED_FROM} 起 ${unclosedSamePhase} 张未收口票按 phase 一次预审(一个预算一份清单)`, "预审结论落盘为 phase 级收敛工件(round/new_judgment/open_judgment)再跑本命令");
      }
      const rr = pr.checkPlanReady({ planPath: path }, { superseded, phaseDir: dirname(path), phase: convPhase });
      review.push({ name, state: rr.state });
      for (const c of rr.classified ?? []) w(`(${name.replace(/-PLAN\.md$/, "")}) ${c}`, "机器可判发现已下沉机器层,不计入 blocker 拦工(R-25)");
      for (const p of rr.problems) reviewErrs.push({ message: p.msg, fix: p.fix });
    }

    // ---- 任务票解析(上提到豁免点之前,phase 26 T3 ①)----
    // 为什么上提:「票面 verify 引用的用例名还在不在」这道门只对**已收口**的票判,
    // 而收口豁免的 skip 点在后面 —— 门落在 skip 下游就是死代码(预审 B1)。
    // 上提的只有这段**解析**(零 e()/w() 调用,纯计算);
    // 「没有 T1/T2 任务节」那行判红**留在 skip 点之后** —— 若被一起上提,收口票会新增一条红。
    const tasks = [];
    let cur = null;
    for (const line of txt.split(/\r?\n/)) {
      const h = line.match(/^#{2,4}\s+T(\d+[A-Za-z]*)\s*(.*)$/); // #11:后缀票(T3b)是真票,不隐形
      if (h) { cur = { id: "T" + h[1], title: h[2].trim(), lines: [] }; tasks.push(cur); continue; }
      if (cur) cur.lines.push(line);
    }
    const FIELD_RE = /^\s*[-*]\s+\*{0,2}([A-Za-z_][\w]*)\*{0,2}\s*:\s*(.*)$/;
    const field = (t, key) => {
      for (const l of t.lines) {
        const m = l.match(FIELD_RE);
        if (m && m[1].toLowerCase() === key) return m[2].trim();
      }
      return null;
    };
    /**
     * 只服务 verify 的取值口:verify 的续行也算 verify 的内容(phase 26 D-07 / REQ-36 / D-10)。
     * 为什么不动 field():它被 8 处消费,改成采集续行会让 26-02 的 action 续行里的
     * ```javascript 围栏触发「action 里含代码块」判红 —— 共享取值口的语义一个字都不许动。
     *
     * 续行语义按 CommonMark 懒续行(phase 26 D-10 / REQ-38,G-26-7):
     * 用户渲染看到的「verify 里含那条命令」必须等于门禁看到的 ——
     * - 字段行 → 停(下一个字段是别的字段)
     * - 缩进行 → 采集(列表项的正常续行)
     * - 零缩进非空行 → 只在「自字段行起没出现过空行」时采集(紧跟段落的懒续行);
     *   出现过空行就停(空行终结段落,之后的零缩进行属新块,不属于这个列表项)
     * - 块起始行(标题/列表项/引用/围栏/分隔线)→ 停
     */
    const BLOCK_START = /^(#{1,6}\s|```|~~~|>|[-*+]\s|\d+[.)]\s|---|\*\*\*)/;
    const fieldBlock = (t, key) => {
      let idx = -1;
      for (let i = 0; i < t.lines.length; i++) {
        const m = t.lines[i].match(FIELD_RE);
        if (m && m[1].toLowerCase() === key) { idx = i; break; }
      }
      if (idx < 0) return null;
      const parts = [(t.lines[idx].match(FIELD_RE) || [])[2]?.trim() ?? ""];
      let seenBlank = false;
      for (let i = idx + 1; i < t.lines.length; i++) {
        const l = t.lines[i];
        if (FIELD_RE.test(l)) break;
        if (!l.trim()) { seenBlank = true; parts.push(""); continue; }
        if (BLOCK_START.test(l)) break;
        if (/^\s/.test(l)) { parts.push(l.trim()); continue; }
        if (seenBlank) break;
        parts.push(l.trim());
      }
      return parts.join("\n").trim();
    };


    // ---- 已收口票:先算 covered,再跑「完成后腐坏探测器」,最后才豁免(phase 26 T3 ①)----
    // 执行顺序写死:解析 → covered → 新门 → skip。
    const ticketId = name.match(/^(\d+-\d+)/)?.[1];
    const covered = ticketId ? ticketsCovered(summaries, ticketId, { requireStatus: "complete" }) : false;
    if (covered) {
      // 票面 verify 引用的自测用例名还在不在(phase 26 D-19 / REQ-46,G-26-10):
      // 名字写错 → 这张票的 verify 永远 exit 1,而本仓没有机器门执行票面 verify → 永远没人知道。
      // 只校验名字在源码里找得到,不执行 verify(执行任意命令不是门禁该干的事)。
      const { checkSelftestCaseNames, readSelftestSources } = await import("../references/verification-gates.mjs");
      const probe = tasks.map((t) => ({ id: `${name} ${t.id}`, verify: fieldBlock(t, "verify") ?? "" }));
      for (const p of checkSelftestCaseNames(probe, readSelftestSources())) e(p);
    }
    // 收口票退出该票的全部门禁(票级门 / 决策契约 / 研究门 / 前提与载量 / 需求反核销),
    // 也不进批图(它的 files 不再参与并行冲突判定)。
    // 位置在 --plan-check 之后 —— 「这张计划能不能开工」照样查预审工件,收口不豁免它。
    if (covered) {
      skippedDone++;
      continue;
    }

    // ---- frontmatter 契约 ----
    if (!fm.goal) e(`${name}: 缺 goal`, "写成结果形一句话(做完之后用户能做到什么),不是任务形");
    if (!fm.rollback) w(`${name}: 缺 rollback`, "补一句这个 phase 怎么回退");
    if (!parsed.files.length) e(`${name}: 缺 files_modified`, "列出精确路径(新增/修改/删除全清单);它是并行的安全契约,也是拆票预算的依据");
    for (const f of parsed.files) {
      if (VAGUE_FILE.test(f)) e(`${name}: files_modified 模糊项 "${f}"`, "改成精确路径 —— 机器无法据此判断并行冲突");
    }
    const { depsFromPlanText } = await import("../references/worktree-view.mjs");
    const selfDeps = depsFromPlanText(txt);
    if (selfDeps.length && fm.plan && selfDeps.includes(unquote(fm.plan))) {
      e(`${name}: depends_on 依赖了自己`, "删掉自引用");
    }

    if (!tasks.length) { e(`${name}: 没有 T1/T2 任务节 —— 计划无票可执行`, "至少写一个 '### T1 <任务名>'(票号可带字母后缀,如 T3b)"); continue; }
    if (tasks.length > 3) e(`${name}: ${tasks.length} 个任务(>3) —— 超出单执行上下文预算`, "拆成多张票(每张 ≤3 任务);超预算的正解是拆票,不是缩内容");
    const tickets = [];

    for (const t of tasks) {
      for (const key of ["files", "read_first", "action", "verify", "done"]) {
        // 完整性与内容判据用同一个取值口(fieldBlock,GitHub #25):field() 只取同行,
        // 多行 verify 的票会被同时判「缺 verify」+ 内容红 —— 两张嘴必然自相矛盾。
        if (!fieldBlock(t, key)) e(`${name} ${t.id}: 缺 <${key}> —— 四件套不完整`, "按 skills/mm-gsd-plan/templates/plan.md 补全;执行者照着它动手,缺项就得临场猜");
      }
      const act = field(t, "action") ?? "";
      if (/```/.test(act)) e(`${name} ${t.id}: action 里含代码块`, "action 写做什么与避免什么,代码留给执行者写 —— 照抄会掩盖真实工作量");
      const v = fieldBlock(t, "verify") ?? "";
      if (ALWAYS_TRUE.test(v)) e(`${name} ${t.id}: verify 含"永远为真"的写法`, "去掉 || true / 2>/dev/null || echo,让失败真的能失败");
      const fw = field(t, "fails_when");
      if (v && !fw) e(`${name} ${t.id}: verify 没有 fails_when 失败方向`, "写失败时看到什么(退出码/输出串/缺失行);没有失败方向的验证是假验证");
      else if (fw && NO_DIRECTION.test(fw)) e(`${name} ${t.id}: fails_when 写的是空值`, "写具体失败信号,不要 TBD/N-A/none");
      else if (fw && fw.length < 8) w(`${name} ${t.id}: fails_when 过于简略("${fw}") —— 没说明失败时看到什么`, "补上退出码或缺失输出串");
      const tf = (field(t, "files") ?? "").split(/[,\s]+/).filter(Boolean);
      if (tf.length > 5) e(`${name} ${t.id}: ${tf.length} 个文件(>5) —— 单任务过大`, "拆成两张票;或把一部分移进独立任务");
      for (const f of tf) if (VAGUE_FILE.test(f)) e(`${name} ${t.id}: <files> 模糊项 "${f}"`, "改成精确路径");
      const dn = field(t, "done") ?? "";
      if (/looks correct|works properly|完成该功能|应该没问题/i.test(dn)) e(`${name} ${t.id}: done 是主观语`, "换成可度量判据(测试名/命令输出/CLI 结果)");
      // 票预算(phase 08 D-03/D-04):一票只接一条 verify,且它不许是全量套件
      for (const p of checkTicketBudget([{ id: `${name} ${t.id}`, verify: v }]))
        e(p, "票级只跑本票的便宜检查(具名测试/单文件/单入口);全量套件写进 PLAN 的 batch_verify,一批跑一次");
      // 判别力 lint(phase 13 D-03,issue #10):WARNING 通道,不拦红 —— warn 先行
      for (const p of checkDiscriminatingLints([{ id: name + " " + t.id, verify: v }]))
        w(p, "判别力提示(不拦红):让失败真的能失败 —— issue #10 的四类假绿");
      // 零匹配假绿(phase 26 D-01,issue #22):ERROR 通道,阻断执行 ——
      // go test -run / cargo test -- 过滤器零匹配时 exit 0,一个用例都没跑却判绿。
      // 这不是「提示不够」,是验证根本没发生,所以走 e(...) 而不是 w(...)。
      for (const p of checkZeroMatchErrors([{ id: name + " " + t.id, verify: v }]))
        e(p, "票级 verify 存在假绿漏洞:零匹配时 exit 0 冒充测试通过 —— 补上断言(issue #22)");
      tickets.push({ id: `${name} ${t.id}`, files: tf, readFirst: (field(t, "read_first") ?? "").split(/[,\s]+/).filter(Boolean), verify: v, covers: (field(t, "covers") ?? "").split(/[,\s]+/).filter(Boolean) });
    }

    // ---- cwd 契约(phase 14 D-01,#16):票面命令量的是 cwd 声明的那棵树 ----
    // 归一化后再比(预审 F5):剥引号、去尾斜杠、/ 统一为 \。豁免:$VAR(判不了不猜)、
    // 以 cwd 声明为前缀的子目录(cd <cwd>/sub 合法)、cd 无参(正则本就不认)。
    // 不对 cd 目标做存在性判断 —— 执行树在使用方机器上,判不了不猜。
    {
      const cwdDecl = parsed.cwd ?? "", cwdNorm = cwdDecl.replace(/\//g, "\\").replace(/\\+$/, "");
      let sawCd = false;
      const cmds = [...tickets.map((t) => ({ id: t.id, cmd: t.verify })), { id: `${name} batch_verify`, cmd: parsed.batchVerify }];
      for (const c of cmds)
        for (const m of String(c.cmd ?? "").matchAll(/(?<![A-Za-z0-9_.\\/])cd\s+("[^"]*"|'[^']*'|[^\s;&|]+)/g)) {
          sawCd = true;
          const tok = unquote(m[1]);
          if (tok.startsWith("$")) continue;
          const n = tok.replace(/\//g, "\\").replace(/\\+$/, "");
          if (!cwdNorm || n === cwdNorm || n.startsWith(cwdNorm + "\\")) continue;
          e(`${c.id}: 命令量错树,cd 指向 ${m[1]} 而 cwd 是 ${cwdDecl}`, "改 cwd 字段与命令一致,或删掉 cd —— 主检出不是执行树(issue #16 的 36/36 票判据量错树)");
        }
      if (sawCd && !cwdDecl) w(`${name}: cwd 缺省却有 cd —— 票面命令在量哪棵树说不清(#16)`, "frontmatter 补 cwd: <执行树根>;cd 要么与它一致,要么删掉");
    }

    // ---- 红窗兑现票门禁(phase 14 D-02,#18):红窗必须有兑现票 ----
    // 格式:`- <守卫或测试路径> | wave <N> | ticket <NN-MM> | close <判据>`(竖线切分)。
    // 缺 ticket 的红窗就是永久豁免 —— 跨波红窗没有兑现票,期末只能人工对账。
    // R 票号(NN-Rk)也算兑现票:点修票同样能把红窗修到绿(phase 21 D-06)。
    for (const rw of parsed.redWindows ?? []) {
      if (!/\bticket\s*\d{2}-(?:\d{2}|R\d+)\b/i.test(rw))
        e(`${name}: red_windows 条目缺 ticket <NN-MM> —— 红窗缺兑现票,会变成永久豁免(issue #18): ${rw}`, "每条红窗写明兑现票(ticket NN-MM)与 close 判据;没有兑现票的红窗不许进计划");
    }
    // ---- 批闸形状 lint(phase 14 D-03,#17):WARNING 通道,与票级判别力 lint 并排 ----
    if (String(parsed.batchVerify ?? "").trim())
      for (const p of checkBatchVerifyLints(parsed.batchVerify))
        w(p, "批闸是每批都跑的 —— 存量红会淹没本批信号;改成具名文件或子目录树,全量归 push 阶段");

    // ---- 全文级:缩水与范围承诺 ----
    const body = txt.slice(txt.indexOf("---", 3) + 3);   // 只扫正文,frontmatter 已单独校验
    if (SHRINK_STRONG.test(body)) e(`${name}: 正文含缩水措辞`, "范围缩水是拆票的理由,不是缩内容的理由(清单见 SKILL.md「缩水禁令」)");
    else if (SHRINK_WEAK.test(body)) w(`${name}: 正文含 v1`, "确认这是版本号命名而不是范围缩水");

    // ---- 决策契约:实现在 references/,主脚本只留接线(作用域差异见 runDecisionContracts 注释)----
    const dg = await import("../references/decision-gates.mjs"), { runDecisionContracts } = await import("../references/ticket-alive.mjs"), rg = await import("../references/research-gates.mjs"), vg = await import("../references/verification-gates.mjs");
    const ctxs = dg.locateContexts([relForCtx, P(".")], root);   // root 必须传:否则 cwd ≠ 项目根时会读别人的 CONTEXT
    runDecisionContracts({
      name, planPath: path, ctxs, root,
      readFile: (p) => readFileSync(p, "utf8"), check: dg, e, w,
    });
    const phaseNo = unquote(String(fm.phase ?? name.slice(0, 2)));
    // R 票跳过研究门:点修票修的是本 phase 已查过的事实,再走研究触发/消费门只会逼它重查(D-06)
    if (!isRepair) {
      rg.checkResearch({ name, goal: fm.goal ?? "", files: parsed.files, phase: phaseNo, root, planDir: dirname(path), e, w });
      // 研究消费门(phase 07 D-02):研究落盘了却没有票引用它 = 没人读 = 执行端重查一遍
      rg.checkResearchConsumed({ name, phase: phaseNo, root, planDir: dirname(path), text: txt, e, w });
    }
    // 计划可信度(phase 09 D-07):前提存在性 / 载量 / 需求反核销 —— 坏票在规划期就红,到不了执行端
    for (const p of vg.checkTicketPremises(tickets, root)) e(p, "把路径改成真实存在的;这张票要产出的新文件写进 <files>,别在 read_first 里凭空引一个");
    for (const p of vg.checkTicketLoad(tickets)) e(p, "砍掉真理来源文件或拆票 —— read_first 是执行前要全部读完的清单");
    for (const p of vg.checkReqClaims(tickets, root)) e(p, "covers 只写真有的 REQ;要新需求就回 discuss 补进 REQUIREMENTS.md");
    // 14 族机器门(28-10):人报 BLOCKER 里机器可判的发现在规划期当场判红,预审只看机器判不了的。
    // 判据权威在 references/plan-review-gate.mjs(本段只注入 ctx 与转发);基线按 §2.4 解析,
    // 锚点缺失 ⇒ 空 Map ⇒ 基线族跳过(判不了不猜),绝不回落 HEAD。F6 对 SIZE_EXEMPT 票豁免(决定 #1)。
    {
      const { checkPlanQuality } = await import("../references/plan-review-gate.mjs");
      const { resolveReviewBaseline } = await import("../references/worktree-view.mjs");
      const planId = name.replace(/-PLAN\.md$/, "");
      let contextText = "";
      try { contextText = readFileSync(join(dirname(path), phaseNo + "-CONTEXT.md"), "utf8"); } catch { /* 双布局另一种落点 */ }
      if (!contextText) { try { contextText = readFileSync(join(root, ".planning", phaseNo + "-CONTEXT.md"), "utf8"); } catch { /* 无 CONTEXT:F3 判不了不猜 */ } }
      let reqText = "";
      try { reqText = readFileSync(join(root, ".planning", "REQUIREMENTS.md"), "utf8"); } catch { /* 无 REQ 清单:F3 判不了 */ }
      const baseline = resolveReviewBaseline(planId, root);
      // 兄弟票文本(F15 生产者证据):同 phase 的其他 PLAN 全文,接线时现读
      const siblings = [];
      try {
        for (const n of readdirSync(dirname(path))) {
          if (n !== name && n.startsWith(phaseNo + "-") && n.endsWith("-PLAN.md")) siblings.push(readFileSync(join(dirname(path), n), "utf8"));
        }
      } catch { /* 目录读不到就没有兄弟证据 */ }
      const gr = checkPlanQuality(txt, { contextText, reqText, baseline, planId, siblings });
      for (const p of gr.problems)
        p.severity === "advisory"
          ? w("[" + p.family + "] (" + planId + ") " + p.msg, "advisory 不拦 —— 人判断题留给预审(F3 按设计)")
          : e("[" + p.family + "] (" + planId + ") " + p.msg, "按族修票面;判据权威与口径见 references/plan-review-gate.mjs(28-REMEDIATION §2.4/§2.5)");
    }
    // 批图(phase 08 D-02):同 phase 内可并行的票不许撞文件、依赖不许成环。
    // R 票不进批图(D-06):修复是原 phase 收尾后的串行补票,不是新的并行面 ——
    // 两张 R 票碰同一个被修文件是常态,卷进批图会误判「并行撞文件」。
    if (!isRepair)
      batchPlans.push({ id: name.replace(/-PLAN\.md$/, ""), phase: phaseNo, files: parsed.files, depends: depsFromPlanText(txt), wave: String(fm.wave ?? "").trim() === "" ? null : Number(fm.wave), dir: dirname(path) });
  }
  {
    const wv = await import("../references/worktree-view.mjs");
    const { checkReqCoverage } = await import("../references/verification-gates.mjs");
    for (const ph of [...new Set(batchPlans.map((b) => b.phase))]) {
      for (const p of wv.checkBatchGraph(batchPlans.filter((b) => b.phase === ph)))
        e(p, "同 phase 内互不依赖的票就是可并行的 —— 撞了文件就必须拆批或补依赖");
    }
    // 波次推导门(R-24,28-13):wave 是 DAG 推导的缓存不是真相源 —— 手写值与依赖推导不符,
    // 执行端就按错序开工;要改顺序就改 depends_on,不是改 wave(用户裁定:次序不重要,DAG 对应就行)。
    // 推导宇宙 = 本 phase 全部票面的 frontmatter:显式传入的可能只是子集(单票 --plan),
    // 按批内集合推导会让依赖全按 0 计、链上票的波次塌缩成 1(28-08 单票误红即此因)。
    for (const ph of [...new Set(batchPlans.map((b) => b.phase))]) {
      const universe = new Map();
      for (const b of batchPlans.filter((x) => x.phase === ph)) {
        if (!universe.has(b.id)) universe.set(b.id, { id: b.id, wave: b.wave, depends: b.depends });
        try {
          for (const n of readdirSync(b.dir)) {
            if (n === b.id + "-PLAN.md" || !n.endsWith("-PLAN.md") || !n.startsWith(ph + "-")) continue;
            const oid = n.replace(/-PLAN\.md$/, "");
            if (universe.has(oid)) continue;
            const fm2 = readFileSync(join(b.dir, n), "utf8").split(/^---$/m)[1] ?? "";
            const wm = fm2.match(/^wave:\s*(\d+)\s*$/m);
            universe.set(oid, { id: oid, wave: wm ? Number(wm[1]) : null, depends: wv.depsFromPlanText(fm2) });
          }
        } catch { /* 目录读不到就按批内集合推导 */ }
      }
      const derived = wv.deriveWaves([...universe.values()]);
      for (const b of batchPlans.filter((x) => x.phase === ph)) {
        if (b.wave !== null && derived.get(b.id) !== b.wave)
          e(`${b.id}: wave 手写 ${b.wave} ≠ DAG 推导 ${derived.get(b.id)} —— 次序从 depends_on 推导;要改顺序就改 depends_on,不是改 wave`);
      }
    }
    // 需求覆盖门(phase 17 D-03,issue #21):checkReqClaims 的正方向 —— REQ 落盘了但无人认领。
    // 项目全量对账,整批一次;REQUIREMENTS.md 不存在 → 函数自己返回空,不猜。
    // worktree 局部 PLAN 集(#34):传本 phase 的 CONTEXT 作作用域 —— 只判本 phase 上下文
    // 提及的 REQ;全局账的历史 REQ 的认领 PLAN 在别的检出,判不了,交给全量检出。
    const ctxForCoverage = batchPlans
      .map((b) => existsSync(P(b.phase + "-CONTEXT.md")) ? readFileSync(P(b.phase + "-CONTEXT.md"), "utf8") : "")
      .join("\n");
    for (const p of checkReqCoverage({ root, plansDir: P("."), contextText: ctxForCoverage }))
      e(p, "给这条需求拆票并在 covers 认领 REQ-N;确认不做就回 discuss 从 REQUIREMENTS.md 移除或改写");
  }
  {
    // 深挖门(28-07,D-13/REQ-63):discuss 落 REQ 前必须答四问,答案进 <mining> 节 —— 机器核对本 phase 票覆盖的每条 REQ。
    // 判据权威在 references/requirement-mining.mjs(本段只注入 root/phase 与转发);豁免:无 <mining> 节的老 CONTEXT 不判。
    const rm = await import("../references/requirement-mining.mjs");
    for (const ph of [...new Set(batchPlans.map((b) => b.phase))]) {
      const ctxText = existsSync(P(ph + "-CONTEXT.md")) ? readFileSync(P(ph + "-CONTEXT.md"), "utf8") : "";
      if (!ctxText.includes("<mining>")) continue;
      const reqs = rm.phaseReqs(root, ph);
      for (const p of rm.checkRequirementMining({ ctxText, reqs: reqs.map((id) => ({ id })) }))
        e(p.message, p.fix);
    }
    if (!batchPlans.length) { /* 单票 --plan 时批图为空也照跑票级门;深挖门是 phase 级,按存在与否判 */ }
  }
  {
    // 点修配额(D-08):同 phase R 票 ≥3 → 强制升级(防疤叠疤;#21 历史教训:诊断 3 次未矫正 = RC2 复发)
    const { readAnnotations } = await import("../references/repair-gates.mjs");
    const byPhase = new Map();
    for (const t of targets) {
      const m = t.split(/[\\/]/).pop().match(/^(\d{2})-R\d+-PLAN\.md$/);
      if (m) byPhase.set(m[1], (byPhase.get(m[1]) ?? 0) + 1);
    }
    for (const [ph, n] of byPhase) if (n >= 3)
      w(`phase ${ph} 的 R 票已达 ${n} 张(≥3)—— 强制升级:重新 discuss 该 phase 或拆独立 phase(D-08,防疤叠疤)`);
    // 批注联动(D-05):type=验收不过 的 open 批注指名走点修分流 —— 用户 Web 批注落盘后的机器入口
    for (const a of readAnnotations(root).filter((x) => x?.status === "open" && x?.type === "验收不过"))
      w(`批注指向 ${a.target},走点修分流(D-05):不新增 REQ + 不改 D-NN + ≤5 文件 → R 票,否则升级新 phase`);
  }

  if (PLAN_CHECK) errs.push(...reviewErrs);
  console.log("\n=== mm-gsd 计划门禁(" + targets.length + " 份) ===");
  for (const t of targets) console.log("  " + t.split(/[\\/]/).pop());
  for (const x of errs) console.log(`  ✗ ${x.message}${x.fix ? `\n      → ${x.fix}` : ""}`);
  for (const x of warns) console.log(`  ! ${x.message}${x.fix ? `\n      → ${x.fix}` : ""}`);
  // 收口票免判的交代行(phase 26 D-14):用 console.log 而不是 w() ——
  // 有 warns 时 w() 通道会让「✓ 四件套完整…」那行不打印,收口不是警告。
  console.log(`  · skipped-done: ${skippedDone} 份已收口的计划(SUMMARY status=complete)免判票级门与批图门,只跑完成后腐坏探测器`);
  if (!errs.length && !warns.length) console.log("  ✓ 四件套完整、失败方向明确、文件清单可解析、预算未超");
  // ---- 本 phase 的过程健康三数(D-04):票数 / 受阻票数 / 缺口数 ----
  // 量来自工件历史,不是遥测(遥测不记 phase 维度,那是用户的口径);
  // 它测过程健康,不是质量分 —— 标注必须跟着数字一起出现。
  {
    const { phaseHealth } = await import("../references/telemetry-aggregate.mjs");
    for (const ph of [...new Set(targets.map((t) => t.split(/[\\/]/).pop().slice(0, 2)))]) {
      const h = phaseHealth(root, ph);
      console.log(`  · phase ${ph} 过程健康:票 ${h.tickets} / 受阻 ${h.blocked} / 缺口 ${h.gaps}(过程健康,不是质量分)`);
    }
  }
  if (PLAN_CHECK) {
    const { renderPlanReady } = await import("../references/plan-ready.mjs");
    console.log(renderPlanReady({ review, ok: !errs.length }));
  }
  process.exit(errs.length ? 1 : 0);
}

// ---- --phases:波次计算(depends_on → wave,同波次零重叠)----
if (process.argv.includes("--phases")) {
  const stPath = P("STATE.md");
  if (!existsSync(stPath)) { die("无 .planning/STATE.md —— 没有 phase 清单可算波次。", "先跑 --init 建 STATE,或手工写 .planning/STATE.md"); }
  const allLines = readFileSync(stPath, "utf8").split(/\r?\n/);
  const hIdx = allLines.findIndex((l) => /^##[ \t]*Phases[ \t]*$/.test(l));
  const sec = [];
  if (hIdx >= 0) {
    for (let i = hIdx + 1; i < allLines.length && !/^##[ \t]/.test(allLines[i]); i++) sec.push(allLines[i]);
  }
  const phases = [];
  for (const line of sec) {
    const m = line.match(/^-\s*\[( |x|X)\]\s*(\S+)\s*[—–-]?\s*(.*)$/);
    if (!m) continue;
    const depM = m[3].match(DEP_RE);
    phases.push({
      id: unquote(m[2]), title: m[3].replace(DEP_RE, "").trim(),
      done: m[1].toLowerCase() === "x",
      deps: depM ? splitDeps(depM[1]) : [],
    });
  }
  if (!phases.length) {
    die("STATE.md 的 ## Phases 节里没解析到 phase —— 写成 '- [ ] 01 — 名称(depends_on: 01, 02)'");
  }

  const byId = new Map(phases.map((p) => [p.id, p]));
  for (const p of phases) for (const d of p.deps) if (!byId.has(d)) console.log(`  ! phase ${p.id} 依赖了不存在的 phase ${d}`);

  // 环依赖必须先拦下:否则波次算成 Infinity,输出一个毫无意义的 "wave Infinity"
  const state = new Map(), cycles = [];
  const visit = (id, path) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { cycles.push([...path.slice(path.indexOf(id)), id]); return; }
    state.set(id, 1);
    for (const d of (byId.get(id)?.deps ?? [])) if (byId.has(d)) visit(d, [...path, id]);
    state.set(id, 2);
  };
  phases.forEach((p) => visit(p.id, []));
  if (cycles.length) {
    console.log("\n=== mm-gsd phase 波次 ===");
    for (const c of cycles) console.log(`  ✗ depends_on 成环: ${c.join(" → ")} —— 没有合法的执行顺序`);
    die("depends_on 成环:没有合法的执行顺序", "断环:里面至少一个依赖是错的,或两个 phase 其实该合并成一个。");
  }

  const wave = new Map();
  const calc = (id) => {
    if (wave.has(id)) return wave.get(id);
    const deps = (byId.get(id)?.deps ?? []).filter((d) => byId.has(d));
    const w = deps.length ? Math.max(...deps.map(calc)) + 1 : 1;
    wave.set(id, w);
    return w;
  };
  phases.forEach((p) => calc(p.id));

  console.log(`\n=== mm-gsd phase 波次(来自 STATE ## Phases,共 ${phases.length} 个) ===`);
  const errs = [];
  const byWave = new Map();
  for (const p of phases) {
    const w = wave.get(p.id);
    if (!byWave.has(w)) byWave.set(w, []);
    byWave.get(w).push(p);
  }
  for (const w of [...byWave.keys()].sort((a, b) => a - b)) {
    const group = byWave.get(w);
    console.log(`\n  wave ${w}: ${group.map((p) => p.id + " " + (p.title || "") + (p.done ? " [已完成]" : "")).join("  |  ")}`);
    // 同波次零重叠校验
    const filesOf = new Map();
    for (const p of group) {
      const s = new Set();
      for (const rel of listPlanFiles(P("."))) {
        if (!rel.split(/[\\/]/).pop().startsWith(p.id + "-") && !rel.includes(join("phases", p.id))) continue;
        parsePlanFile(readFileSync(P(rel), "utf8")).files.forEach((f) => s.add(f));
      }
      filesOf.set(p.id, s);
    }
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const ov = [...filesOf.get(group[i].id)].filter((f) => filesOf.get(group[j].id).has(f));
        if (ov.length) {
          const msg = `wave ${w} 冲突: ${ov.join(", ")} 被 ${group[i].id} 与 ${group[j].id} 同时声明 —— 不能并行`;
          console.log(`    ⚠ ${msg}`); err(msg); errs.push(1);
        }
      }
    }
    // 空集 = 核验不了,不是核验通过(phase 26 D-02,REQ-33):files_modified 缺失/为空时
    // parsePlanFile 交回空集,双层交集恒为空 —— 并行冲突静默漏过,冲突到执行期才爆。
    // 全是模糊语同理:路径对不上真实文件,交集同样恒空(--plan 会另判红,但 --phases 自己不能装作查过了)。
    // 静默通过比没有检查更危险,所以必须可见。只查并行波次(group.length > 1):
    // 单 phase 波次不存在冲突可能,历史归档 phase 不该倾泻无意义告警。
    let hasUnverifiable = false;
    if (group.length > 1) {
      for (const p of group) {
        const s = filesOf.get(p.id);
        if (!s || s.size === 0 || [...s].every((f) => VAGUE_FILE.test(f))) {
          hasUnverifiable = true;
          console.log(`    ⚠ ${p.id} 的 files_modified 缺失或全为模糊语，本轮无法核验文件冲突——请补充精确路径`);
          warn(`${p.id} 的 files_modified 缺失或全为模糊语，本轮无法核验文件冲突`);
        }
      }
    }
    if (group.length > 1 && !errs.length) {
      if (hasUnverifiable) console.log(`    ⚠ wave ${w} 存在未声明修改文件的 phase，无法保证可安全并行`);
      else console.log(`    ✓ 同波次 files_modified 零重叠 —— wave ${w} 可并行`);
    }
  }
  const pending = phases.filter((p) => !p.done);
  console.log(`\n  下一步:${pending.length ? pending[0].id + " " + (pending[0].title || "") : "(全部已完成)"}${pending[0]?.deps.length ? "  依赖: " + pending[0].deps.join(", ") : ""}`);
  process.exit(errs.length ? 1 : 0);
}

// ---- --stats:遥测聚合。读用户级日志,跨项目可比(项目级日志已被自动遥测取代)----
// --tools:工具级视图(REQ-18,20-CONTEXT D-04)—— grep 计数 / 派发分布 / 近似时长,只呈现不判红
if (process.argv.includes("--stats")) {
  const { runStats, runToolStats } = await import("../references/telemetry-aggregate.mjs");
  if (process.argv.includes("--tools")) process.exit(runToolStats({ path: TOOL_TELEMETRY_PATH }));
  process.exit(runStats({ path: TELEMETRY_PATH, scope: root, all: process.argv.includes("--all") }));
}

// ---- --selfcheck:门禁自己的正则自测 ----
// 用例与理由在 references/gate-selftest.mjs(GitHub #6/#7/#8 三条都是门禁判错而非崩溃,
// 必须有用例证明它会红)。放独立文件是为主脚本省行数,不是怕麻烦。
if (process.argv.includes("--selfcheck")) {
  const { runSelfTest } = await import("../references/gate-selftest.mjs");
  process.exit(runSelfTest(splitDeps) ? 1 : 0);
}

// ---- --routes:技能路由门禁 —— 每个技能都要说清自己的下一步(D-05)----
if (process.argv.includes("--routes")) {
  const { checkRoutes } = await import("../references/agent-routing.mjs");
  const problems = checkRoutes(join(SKILL_DIR, ".."));
  console.log("\n=== mm-gsd 技能路由门禁 ===");
  for (const p of problems) console.log(`  ✗ ${p.skill}: ${p.problem}\n      → ${p.fix}`);
  if (problems.length) {
    console.log("  " + problems.length + " 处没写清下一步 —— 每条上面都写了怎么改,改完重跑即可。");
    die(new Set(problems.map((p) => p.skill)).size + " 个技能的「完成后」没写清", "每条上面都写了缺什么和怎么改,补完重跑即可。");
  }
  console.log("  ✓ 每个技能都说清了自己的下一步");
  process.exit(0);
}

// ---- --route:宿主 agent 路由提示(只读)—— 该读什么、本项目门禁速查、能不能开子代理 ----
// 排版在这里,判定在 references/agent-routing.mjs:那里出数据,这里出文本。
if (process.argv.includes("--route")) {
  const { buildRouteBrief } = await import("../references/agent-routing.mjs");
  const { skillsRootOr } = await import("../references/packs.mjs");
  const at = process.argv.indexOf("--route"), arg = process.argv[at + 1];
  const b = buildRouteBrief({
    stage: arg && !arg.startsWith("--") ? arg : null,
    skillsRoot: skillsRootOr(join(SKILL_DIR, ".."), process.env), projectRoot: root, home: homedir(),
    activePhase: unquote(frontmatter(P("STATE.md"))?.active_phase) ?? null,
  });
  const L = [];
  if (b.kind === "ring") {
    L.push("=== mm-gsd 路由:各阶段的出口(阶段名 = 技能名去掉 mm-gsd- 前缀)===");
    for (const s of b.skills) L.push(`  ${s.skill.replace("mm-gsd-", "")}  →  ${s.exits.length ? s.exits.join(", ") : "(没写出口)"}`);
    if ((b.tiers ?? []).length) {
      L.push("\n  三级规模路由(按风险与复杂度选择通道):");
      for (const t of b.tiers) L.push(`    ${t.label.padEnd(10)} ${t.scope} → ${t.artifacts}`);
    }
    if ((b.packs ?? []).length) {
      // 可选包分栏(28-01,D-03):声明 entry 且 optional 的包不进环,另起一栏;没有可选包时不印(空态不占屏)
      L.push("\n  可选包(点缀,不参与环):");
      for (const p of b.packs) L.push("    " + p.display + "(" + p.name + ")");
    }
    L.push("\n  要某一步的完整提示(该读什么 + 本项目门禁速查):--route <阶段>");
  } else if (b.kind === "unknown") {
    L.push("=== mm-gsd 路由 ===", "  " + b.message);
  } else {
    L.push(`=== mm-gsd 路由提示(阶段:${b.stage})===`);
    L.push(b.host.canSpawn
      ? `  宿主:${b.host.host}(agent 卡目录 ${b.host.agentsDir})—— 可以开子代理:开一个只读子代理,让它读下面的路径并照着做`
      : `  宿主:${b.host.note}`);
    if ((b.tiers ?? []).length) {
      L.push("  三级规模路由:");
      for (const t of b.tiers) L.push(`    · ${t.label}: ${t.scope}（${t.agents}）`);
    }
    L.push("  该读的路径(只传路径,别把文件内容抄进 prompt —— 主会话上下文 ≤15%):");
    for (const p of b.readPaths) L.push("    " + p);
    if (b.projectPaths.length) {
      L.push("  本项目的上下文路径(存在才列):");
      for (const p of b.projectPaths) L.push("    " + p);
    }
    L.push("  角色定义只有一份:上面那个 SKILL.md。别的文件按它指的路走。");
    L.push("  本项目门禁速查(机器从 ledger/budget 读出,不是手写):");
    for (const n of b.quick.notes) L.push("    · " + n);
    if (b.quick.rules.length) {
      L.push(`    · active 规则 ${b.quick.rules.length} 条:`);
      for (const r of b.quick.rules) L.push(`        ${r.id} ${r.text}`);
    }
    if (b.quick.caps.length) {
      L.push(`    · 单文件上限 ${b.quick.caps.length} 条:`);
      for (const c of b.quick.caps) L.push(`        ${c.pattern} ≤ ${c.max}`);
    }
  }
  console.log("\n" + L.join("\n"));
  process.exit(0);
}

// ---- --templates:模板自检 + 实例结构契约(规则表与扫描都在 references/,这里只留接线)----
if (process.argv.includes("--templates")) {
  const { checkTemplates } = await import("../references/template-gates.mjs");
  // SKILL_DIR = skills/mm-gsd-loop,往上一级才是 skills/。别再用 URL 字符串拼路径,Windows 上会解析不出目录。
  const { bad, checked, fatal } = checkTemplates({ tmplRoot: join(SKILL_DIR, "..") });
  if (fatal) die(fatal, "确认 skills/mm-gsd-loop/templates/ 在位");
  if (bad) die(bad + "/" + checked + " 份模板过不了自己的契约", "每条上面都给了正确写法,照着改完重跑即可。");
  process.exit(0);
}

// ---- --init:冷启动。门禁要求 STATE,但建 STATE 的职责不在当前步骤里 —— 那就是死锁 ----
// 之前 agent 卡在这里:门禁说"转绿才准继续",可转绿要的东西它这一步造不出来,只能停。
// --init 把造 STATE 变成一条命令,任何步骤都能自救。
if (process.argv.includes("--init")) {
  if (existsSync(P("STATE.md"))) { console.log("已有 .planning/STATE.md —— 不覆盖。删掉它重来,或直接跑默认检查。"); process.exit(0); }
  mkdirSync(P("."), { recursive: true });
  const goal = process.argv[process.argv.indexOf("--init") + 1]?.startsWith("--") ? "<一句话项目目标>" : process.argv[process.argv.indexOf("--init") + 1];
  const today = new Date().toISOString().slice(0, 10);
  // 已有 CONTEXT 就把它当成 phase 01 的起点,别让 agent 再重读一遍。
  // 检测扩到合法命名 <NN>-CONTEXT.md(裸名非法;只认裸名时「不必重来」提示永不触发,D-08)
  let hasCtx = existsSync(P("CONTEXT.md"));
  let ctxName = "CONTEXT.md";
  if (!hasCtx) {
    try {
      const found = readdirSync(P(".")).filter((f) => f.endsWith("-CONTEXT.md")).sort();
      if (found.length) { hasCtx = true; ctxName = found[0]; }
    } catch {}
  }
  const body = [
    "---",
    `status: ${hasCtx ? "discussing" : "discussing"}`,
    `active_phase: 01`,
    `updated: ${today}`,
    "---",
    "",
    "## Project Reference",
    "",
    `- Goal: ${goal}`,
    "- Current focus: <当前里程碑/phase>",
    "",
    "## Phases",
    "",
    "- [ ] 01 — <名称>(walking skeleton)",
    "",
    "## Current Position",
    "",
    "- Phase: 01 — <名称>",
    "- Plan: —",
    "- Status: 刚冷启动,尚未讨论",
    "- Last activity: —",
    "",
    "## Decisions(只留 3-5 条近期,全量在 CONTEXT)",
    "",
    "- [D-01] <决策内容>(<日期>)",
    "",
    "## Blockers / Concerns(只留活跃的)",
    "",
    "- 无",
    "",
    "## Quick Tasks Completed",
    "",
    "| # | Description | Date | Commit | Directory |",
    "|---|-------------|------|--------|-----------|",
    "",
    "## Session Continuity",
    "",
    "- Last session: <日期>",
    "- Stopped at: phase 01 / discuss",
    "- Resume file: —",
    "",
  ].join("\n");
  writeFileSync(P("STATE.md"), body);
  console.log("已创建 .planning/STATE.md(status=discussing, active_phase=01)");
  if (hasCtx) console.log(`检测到已有 ${ctxName} —— 讨论已完成的部分直接用,不必重来。`);
  console.log("需求与决策在 discuss 落盘(REQ 进 REQUIREMENTS.md,D-NN 进 CONTEXT):调用 mm-gsd-discuss。");
  console.log("接着做:填 Project Reference 的 Current focus 与 ## Phases 清单,再跑 --phases 看波次。");
  console.log("(占位项是给你改的;检查器不拦 STATE 正文,只拦 frontmatter 契约与工件一致性)");
  process.exit(0);
}

// ---- 批注提醒(D-04 后半):独立于状态机 —— 未初始化(无 STATE)的项目也该看见待消化批注 ----
// 实测教训:提醒原本住在 artifactInfo 块里,无 STATE 的项目在下面的早退分支出去,提醒永远不出现。
{
  const { readAnnotations } = await import("../references/repair-gates.mjs");
  const openAnn = readAnnotations(root).filter((a) => a?.status === "open");
  if (openAnn.length) warn(`${openAnn.length} 条用户批注待消化 —— 用批注工具查看,discuss/plan 开头消化`);
}

// ---- STATE ----
if (!existsSync(P("STATE.md"))) {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ state: null, derived: null, errors: [{ message: ".planning/STATE.md 不存在", fix: "跑 gsd-state-check.mjs --init 一条命令建好,别手搓" }], warnings }));
  } else {
    console.log("mm-gsd 状态机:未初始化(无 .planning/STATE.md)。");
    console.log("  → 跑 `node <本脚本> --init \"<项目目标>\" 即可建好,不必手搓模板。");
    console.log("    (建 STATE 不是门禁的执行方该干的活 —— 门禁要的东西做不到,门禁就是死锁而不是门禁。)");
    // 早退路径也要把已产生的警告带出去(批注提醒在这里产生,不打印等于没提醒)
    for (const w of warnings) console.log(`  ! ${w.message}${w.fix ? `\n      → ${w.fix}` : ""}`);
  }
  err(".planning/STATE.md 不存在", "跑 gsd-state-check.mjs --init 一条命令建好,别手搓");
  process.exit(1);
}

const stateText = readFileSync(P("STATE.md"), "utf8");
const stateFm = frontmatter(P("STATE.md")) ?? {};
const declared = stateFm.status ?? "";
const phaseDir = (stateFm.active_phase ?? "").trim();
const lines = stateText.split(/\r?\n/).length;
if (lines > 100) warn(`STATE.md ${lines} 行(>100): digest 失控,删到只剩近期决策与活跃 blockers`, "编辑 STATE.md");

// ---- phase 目录:找 active_phase 对应的目录 ----
let phasePath = null;
if (existsSync(P("phases"))) {
  const dirs = readdirSync(P("phases"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .sort()
    .map((d) => d.name);
  // active_phase "01" 匹配 "01-xxx",不可误匹配 "10-xxx"(排序 + 边界锚)
  phasePath =
    dirs.find((d) => d === phaseDir || d.startsWith(phaseDir + "-")) ??
    null;
  if (!phasePath && dirs.length > 0) phasePath = dirs[dirs.length - 1];
}

// ---- 推导真实状态(工件存在性,不看任何声明)----
// 工件两种布局都认:根级 .planning/*-CONTEXT.md,或 .planning/phases/<dir>/*-CONTEXT.md
let derived = null;
const artifactInfo = { context: null, plans: [], summaries: [], verification: null, layout: "phases" };
{
  const rootFiles = readdirSync(P(".")).filter((f) => f.endsWith(".md"));
  const inPhases = phasePath ? readdirSync(P("phases", phasePath)) : [];
  // #9:root 布局按 active_phase 前缀圈定 —— 历史工件不许把当前 phase 的推导淹没;
  // 圈不到(冷启动/无 active_phase)才回全量;phases 布局本来就按目录隔离,不动。
  const activePhase = unquote(frontmatter(P("STATE.md"))?.active_phase);
  const rootScoped = activePhase ? rootFiles.filter((f) => f.startsWith(activePhase + "-")) : rootFiles;
  const files = inPhases.length > 0 ? inPhases : (rootScoped.length ? rootScoped : rootFiles);
  const base = inPhases.length > 0 ? P("phases", phasePath) : P(".");
  artifactInfo.layout = inPhases.length > 0 ? "phases" : "root";
  // root 布局下 files 混着所有 phase,find() 取的是排序最靠前那份 ——
  // active_phase=05 却读 01- 的工件,derived 就建立在别的 phase 上(GitHub #8)。
  // 先按 active_phase 前缀找,找不到才退回全量。
  const own = (f) => phaseDir && (f === phaseDir || f.startsWith(phaseDir + "-") || f.startsWith(phaseDir));
  const pick = (suffix) => files.find((f) => own(f) && f.endsWith(suffix))
    ?? files.find((f) => f.endsWith(suffix)) ?? null;
  artifactInfo.context = pick("-CONTEXT.md");
  artifactInfo.plans = files.filter((f) => f.endsWith("-PLAN.md"));
  artifactInfo.summaries = files.filter((f) => f.endsWith("-SUMMARY.md"));
  artifactInfo.verification = pick("-VERIFICATION.md");
  artifactInfo.shipment = pick("-SHIP.md");
  const J = (f) => join(base, f);

  // CONTEXT 之前没有任何实例门禁:缺四个标签也照样把状态机推进到 planning
  const { validateInstance, validateVerification } = await import("../references/template-gates.mjs");
  if (artifactInfo.context)
    for (const i of validateInstance("context", artifactInfo.context, readFileSync(J(artifactInfo.context), "utf8"), null)) err(i.message, i.fix);

  const has = (a) => Boolean(a);
  // 点修挂起推导(D-09,判定件在 references/repair-gates.mjs):R 票存在且未全部
  // 「收口(SUMMARY complete)+ 重验 passed(VERIFICATION 重验节 - Rk: passed)」 → reopened。
  // 必须排在 executing 判定之前 —— R 票会撑大 plans 数,summaries < plans 的老判据
  // 会把一个已交付 phase 错推回 executing(21-RESEARCH 实测约束)。
  const { repairStatus } = await import("../references/repair-gates.mjs");
  const repairs = repairStatus({
    plans: artifactInfo.plans,
    verificationText: artifactInfo.verification ? readFileSync(J(artifactInfo.verification), "utf8") : "",
    summaryOf: (f) => {
      const sf = artifactInfo.summaries.find((x) => x === f.replace("-PLAN.md", "-SUMMARY.md"));
      return sf ? frontmatter(J(sf)) : null;
    },
  });
  if (!has(artifactInfo.context)) derived = "discussing";
  else if (artifactInfo.plans.length === 0) derived = "planning";
  else if (repairs.length && repairs.some((r) => !r.closed || !r.passed)) derived = "reopened";
  else if (artifactInfo.summaries.length < artifactInfo.plans.length) derived = "executing";
  else {
    const vfm = artifactInfo.verification ? frontmatter(J(artifactInfo.verification)) : null;
    // 验证通过 ≠ 交付。SHIP 工件是终态的唯一凭据 —— 但「有它」不等于「它说 shipped」。
    // 只判存在会把 status: held 的 SHIP 推成 shipped:同一份文件,校验段认 held、
    // 推导段不认,两套口径(GitHub #8)。受阻就是受阻,不能因为工件在就宣布交付。
    const shm = artifactInfo.shipment ? frontmatter(J(artifactInfo.shipment)) : null;
    derived = vfm?.status === "passed"
      ? (!artifactInfo.shipment ? "completed" : shm?.status === "shipped" ? "shipped" : "verifying")
      : "verifying";
  }

  // ---- 工件字段契约(fake-completed / 手填 commits / 假 status)----
  const { stateContracts } = await import("../references/state-derive.mjs");
  await stateContracts({
    root, base, artifactInfo, frontmatter, unquote, parsePlanFile,
    derived, declared, err, warn,
    argvJson: process.argv.includes("--json"),
    SUMMARY_STATUSES, VERIF_STATUSES, SHIP_STATUSES, STATUSES, PLACEHOLDER, NO_DIRECTION,
  });
}
// ---- 输出 ----
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({
    state: { declared, phase: phasePath, dir: phasePath },
    derived,
    layout: artifactInfo.layout,
    artifacts: { context: artifactInfo.context, plans: artifactInfo.plans.length, summaries: artifactInfo.summaries.length, verification: artifactInfo.verification, shipment: artifactInfo.shipment },
    errors, warnings,
  }));
} else if (!process.argv.includes("--quiet")) {
  console.log(`mm-gsd 状态机  phase=${phasePath ?? (phaseDir || "(未声明)")}  布局=${artifactInfo.layout}  声明=${declared || "(空)"}  推导=${derived || "(无工件)"}`);
  if (artifactInfo.context) console.log(`  CONTEXT ${artifactInfo.context} · PLAN ${artifactInfo.plans.length} · SUMMARY ${artifactInfo.summaries.length} · VERIFICATION ${artifactInfo.verification ?? "—"} · SHIP ${artifactInfo.shipment ?? "—(未交付)"}`);
  for (const e of errors) console.log(`  ✗ ${e.message}${e.fix ? `\n      → ${e.fix}` : ""}`);
  for (const w of warnings) console.log(`  ! ${w.message}${w.fix ? `\n      → ${w.fix}` : ""}`);
  if (errors.length === 0 && warnings.length === 0) console.log("  ✓ 状态一致,工件契约完整");
}
process.exit(errors.length > 0 ? 1 : 0);
