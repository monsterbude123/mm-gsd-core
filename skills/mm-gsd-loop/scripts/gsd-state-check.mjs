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
//   --worktrees 跨 worktree 冲突  --templates 模板自检            --stats   遥测聚合
//   --selfcheck  门禁对自己的正则自测(见 references/gate-selftest.mjs)
//
// 零依赖、跨平台(Windows/macOS/Linux)。GSD 原版等价物:verify.plan-structure +
// verification.status;这是它的极简版。

import { readFileSync, readdirSync, existsSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const STATUSES = ["discussing", "planning", "executing", "verifying", "completed", "shipped", "paused"];
const SUMMARY_STATUSES = ["complete", "halted"];
const VERIF_STATUSES = ["passed", "gaps_found", "human_needed"];
const SHIP_STATUSES = ["shipped", "held"];
const PLACEHOLDER = /To be filled|待补|PLACEHOLDER|placeholder|\bTBD\b/i;

const PLANNING = process.argv.includes("--planning") || process.env.GSD_PROJECT_DIR;
const root = PLANNING ? String(process.argv[process.argv.indexOf("--planning") + 1] ?? process.env.GSD_PROJECT_DIR) : process.cwd();
const P = (...s) => join(root, ".planning", ...s);

// ---- 遥测:检查器每跑一次自动记一行。放在用户目录,跨项目可比,且不依赖任何人记得写 ----
// 之前的设计是"agent 手工在项目里追加一行",实测零产出——需要自觉的探子等于没有探子。
const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const TELEMETRY = process.env.GSD_TELEMETRY !== "0";
const TELEMETRY_PATH = join(homedir(), ".agents", "mm-gsd-runs.jsonl");
// sandbox 标记:由**跑沙箱的一方**声明,不由被观测方猜路径。
// 为什么不用「路径含 Temp 就当沙箱」:用户自己建在临时目录里的真项目会被误排除,
// 而自测沙箱也可能被挪到别处。声明式标记不会骗人。
// 用途:自测沙箱里的失败是**正常的**(那是在故意造失败),不该混进
// 「最该修的地方」排行 —— 否则 observe 环的诊断入口被自己的自测噪声淹掉。
const SANDBOX = process.env.GSD_SANDBOX === "1";
const MODE = ["init", "worktrees", "plan", "phases", "stats"].find((m) => process.argv.includes("--" + m))
  ?? (process.argv.includes("--json") ? "check-json" : "check");
const runRec = { ts: new Date().toISOString(), mode: MODE, cwd: root, sandbox: SANDBOX, declared: null, derived: null, phase: null, errors: [], warnings: [] };
// exit 钩子保证每个 process.exit 路径都被记到,不靠人工在分支里记得写
process.on("exit", (code) => {
  if (!TELEMETRY) return;
  try {
    mkdirSync(dirname(TELEMETRY_PATH), { recursive: true });
    appendFileSync(TELEMETRY_PATH, JSON.stringify({ ...runRec, exit: code }) + "\n");
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
function frontmatter(path) {
  if (!existsSync(path)) return null;
  const m = readFileSync(path, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    // 行尾注释:值本身不含 # 时才剥(commits: 3  # 说明 → "3")
    let v = kv[2].trim();
    const hash = v.indexOf("#");
    if (hash > 0 && !/^["']/.test(v)) v = v.slice(0, hash).trim();
    out[kv[1]] = v;
  }
  return out;
}

// ---- PLAN 解析(--plan / --phases / --worktrees 共用)----
// 模糊措辞让机器无法判断并行冲突。两条正则的坑与用例见 references/gate-selftest.mjs:
// VAGUE_FILE 的 N\/A 需左右断言(\b 挡不住 admin/auth,#6)
// DEP_RE 的括号要认全角 U+FF08/FF09,否则中文 STATE.md 依赖链解析为空(#7)
const VAGUE_FILE = /相关|若干|全部|所有|等等|若干文件|…|\.\.\.|etc\b|TBD|待定|(?<![A-Za-z0-9])N\/A(?![A-Za-z0-9])/i;
// 解析与剔除共用一个常量 —— 两处各写一遍必然会走偏
const DEP_RE = /[（(]\s*depends_on\s*[:：]\s*([^）)]*)[）)]/i;
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

/** 从 PLAN 全文抽 files_modified(三种写法)/ REQ-* / D-NN */
function parsePlanFile(txt) {
  const files = new Set(), reqs = new Set(), decisions = new Set();
  let inBlock = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) {
      inBlock = kv[1].toLowerCase() === "files_modified";
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
    }
  }
  for (const m of txt.matchAll(/\bREQ-[A-Za-z0-9._-]+/g)) reqs.add(m[0]);
  for (const m of txt.matchAll(/\bD-\d+\b/g)) decisions.add(m[0]);
  return { files: [...files], reqs: [...reqs], decisions: [...decisions] };
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
if (process.argv.includes("--worktrees")) {
  let raw = "";
  try { raw = execSync("git worktree list --porcelain", { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }); }
  catch { die("不在 git 仓库中,无法列 worktree。", "在项目根跑,或先 git init"); }

  const wts = [];
  let cur = null;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) { cur = { path: line.slice(9).trim(), branch: "(detached)", head: "" }; wts.push(cur); }
    else if (cur && line.startsWith("branch ")) cur.branch = line.slice(7).replace("refs/heads/", "");
    else if (cur && line.startsWith("HEAD ")) cur.head = line.slice(5).trim();
  }

  const readPlanInfo = (wtPath) => {
    const plDir = join(wtPath, ".planning");
    if (!existsSync(plDir)) return { state: null, files: [], reqs: [], hasPlanning: false };
    const st = frontmatter(join(plDir, "STATE.md")) ?? {};
    const files = new Set(), reqs = new Set();
    for (const p of listPlanFiles(plDir)) {
      const parsed = parsePlanFile(readFileSync(join(plDir, p), "utf8"));
      parsed.files.forEach((f) => files.add(f));
      parsed.reqs.forEach((r) => reqs.add(r));
    }
    // REQ-NN 是"这一份 REQUIREMENTS.md 里的局部编号",不是全局 ID。
    // 记下它属于哪份需求清单,只有同源的才谈得上冲突。
    const reqFile = join(plDir, "REQUIREMENTS.md");
    const reqSrc = existsSync(reqFile) ? createHash("sha1").update(readFileSync(reqFile)).digest("hex").slice(0, 8) : null;
    return { state: st, files: [...files], reqs: [...reqs], hasPlanning: true, reqSrc };
  };

  const info = wts.map((w) => ({ ...w, ...readPlanInfo(w.path) }));
  // git 报的是正斜杠绝对路径,cwd 可能是反斜杠 —— 归一化后再做相对化
  const norm = (p) => p.replace(/\\/g, "/");
  const base = norm(process.cwd()).replace(/\/+$/, "");
  const short = (p) => { const n = norm(p); return n === base ? "." : n.startsWith(base + "/") ? "." + n.slice(base.length) : n; };
  const phOf = (w) => { const v = w.state?.active_phase; return v ? String(v).replace(/^["']|["']$/g, "") : "—"; };
  const stOf = (w) => { const v = w.state?.status; return v ? String(v).replace(/^["']|["']$/g, "") : "—"; };

  // 真实仓库动辄几十个 worktree,绝大多数没在跑 mm-gsd。全列出来等于没输出。
  const live = info.filter((w) => w.hasPlanning);
  const idle = info.length - live.length;
  console.log("\n=== mm-gsd 多工作树视图(共 " + info.length + " 个," + live.length + " 个有 .planning) ===\n");
  for (const w of live) {
    const f = (w.files.length > 3 ? w.files.slice(0, 3).join(", ") + " …(" + w.files.length + ")" : w.files.join(", ")) || "—";
    console.log("  " + short(w.path).padEnd(38) + w.branch.padEnd(14) + ("phase " + phOf(w)).padEnd(11) + stOf(w).padEnd(12) + f);
  }
  if (idle) console.log("  (另有 " + idle + " 个 worktree 没有 .planning,不参与 mm-gsd 并行判定)");

  const conflicts = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const overlap = live[i].files.filter((f) => live[j].files.includes(f));
      if (overlap.length) conflicts.push({ a: live[i], b: live[j], kind: "文件", items: overlap });
      // 编号撞车不等于重复实现:只有共用同一份 REQUIREMENTS.md 时 REQ-NN 才指同一件事
      const rq = live[i].reqs.filter((r) => live[j].reqs.includes(r));
      if (rq.length) {
        const same = live[i].reqSrc && live[i].reqSrc === live[j].reqSrc;
        conflicts.push({ a: live[i], b: live[j], kind: same ? "REQ" : "REQ(不同源·仅编号撞车)", items: rq, soft: !same });
      }
    }
  }
  const hard = conflicts.filter((c) => !c.soft);
  if (conflicts.length === 0) {
    console.log("\n  ✓ 无 files_modified / REQ 冲突 —— 这几个 worktree 可以安全并行");
  } else {
    for (const c of conflicts) {
      const mark = c.soft ? "i" : "⚠";
      console.log(`\n  ${mark} ${c.kind}冲突:${c.items.join(", ")} 被 ${c.a.branch}(phase ${phOf(c.a)}) 与 ${c.b.branch}(phase ${phOf(c.b)}) 同时声明`);
      if (c.soft) console.log("    → 两边 REQUIREMENTS.md 不是同一份,REQ-NN 是各自局部编号,编号相同不代表做同一件事 —— 不阻塞,确认分工即可");
      else console.log("    → " + (c.kind === "文件" ? "并行必合并冲突:二选一先做,或把其中一个 phase 重新切到不碰这些文件的切片" : "需求重复实现风险:确认分工,或合并到一个 worktree"));
    }
  }
  const busy = live.filter((w) => stOf(w) === "executing");
  if (busy.length > 1) console.log("\n  ! " + busy.length + " 个 worktree 同时 executing —— 确认 dev server 端口 / 同一数据库 / 共享构建产物没打架(端口冲突不体现在 files_modified 里)");
  console.log("");
  process.exit(hard.length ? 1 : 0);
}

// ---- --plan:计划质量门禁(散文约定 → 可执行检查)----
if (process.argv.includes("--plan")) {
  const errs = [], warns = [];
  const e = (m, fix) => errs.push({ message: m, fix: fix ?? "" });
  const w = (m, fix) => warns.push({ message: m, fix: fix ?? "" });

  const at = process.argv.indexOf("--plan");
  const arg = process.argv[at + 1];
  // 三种写法都收:.planning/02-01-PLAN.md、02-01-PLAN.md、绝对路径;已含 .planning 的别再拼一次
  const resolve = (rel) => {
    const n = rel.replace(/\\/g, "/");
    if (n.startsWith(".planning/") || n.includes("/.planning/") || /^[A-Za-z]:\//.test(n) || n.startsWith("/")) return n;
    return P(rel);
  };
  const targets = arg && !arg.startsWith("--")
    ? [arg]
    : (() => {                                        // 默认:当前 active_phase 的 PLAN
      const active = unquote(frontmatter(P("STATE.md"))?.active_phase);
      const all = listPlanFiles(P("."));
      if (!active) return all;
      const scoped = all.filter((f) => f.split(/[\\/]/).pop().startsWith(active + "-") || f.includes(join("phases", active)));
      return scoped.length ? scoped : all;
    })();

  if (!targets.length) {
    die("未找到任何 *-PLAN.md —— 先按 templates/plan.md 落盘,再跑本检查。");
  }

  for (const rel of targets) {
    const path = resolve(rel);
    if (!existsSync(path)) { e(`${rel}: 文件不存在`, "路径写错,或 PLAN 还没落盘"); continue; }
    const txt = readFileSync(path, "utf8");
    const fm = frontmatter(path) ?? {};
    const parsed = parsePlanFile(txt);
    const name = rel.split(/[\\/]/).pop();
    const relForCtx = dirname(rel);

    // ---- frontmatter 契约 ----
    if (!fm.goal) e(`${name}: 缺 goal`, "写成结果形一句话(做完之后用户能做到什么),不是任务形");
    if (!fm.rollback) w(`${name}: 缺 rollback`, "补一句这个 phase 怎么回退");
    if (!parsed.files.length) e(`${name}: 缺 files_modified`, "列出精确路径(新增/修改/删除全清单);它是并行的安全契约,也是拆票预算的依据");
    for (const f of parsed.files) {
      if (VAGUE_FILE.test(f)) e(`${name}: files_modified 模糊项 "${f}"`, "改成精确路径 —— 机器无法据此判断并行冲突");
    }
    const dep = unquote(String(fm.depends_on ?? "").replace(/[[\]"']/g, ""));
    if (dep && fm.plan && dep.split(/[,\s]+/).includes(unquote(fm.plan))) {
      e(`${name}: depends_on 依赖了自己`, "删掉自引用");
    }

    // ---- 任务票 ----
    const tasks = [];
    let cur = null;
    for (const line of txt.split(/\r?\n/)) {
      const h = line.match(/^#{2,4}\s+T(\d+)\b\s*(.*)$/);
      if (h) { cur = { id: "T" + h[1], title: h[2].trim(), lines: [] }; tasks.push(cur); continue; }
      if (cur) cur.lines.push(line);
    }
    const field = (t, key) => {
      for (const l of t.lines) {
        const m = l.match(/^\s*[-*]\s+\*{0,2}([A-Za-z_][\w]*)\*{0,2}\s*:\s*(.*)$/);
        if (m && m[1].toLowerCase() === key) return m[2].trim();
      }
      return null;
    };

    if (!tasks.length) { e(`${name}: 没有 T1/T2 任务节 —— 计划无票可执行`, "至少写一个 '### T1 <任务名>'"); continue; }
    if (tasks.length > 3) e(`${name}: ${tasks.length} 个任务(>3) —— 超出单执行上下文预算`, "拆成多张票(每张 ≤3 任务);超预算的正解是拆票,不是缩内容");

    for (const t of tasks) {
      for (const key of ["files", "read_first", "action", "verify", "done"]) {
        if (!field(t, key)) e(`${name} ${t.id}: 缺 <${key}> —— 四件套不完整`, "按 templates/plan.md 补全;执行者照着它动手,缺项就得临场猜");
      }
      const act = field(t, "action") ?? "";
      if (/```/.test(act)) e(`${name} ${t.id}: action 里含代码块`, "action 写做什么与避免什么,代码留给执行者写 —— 照抄会掩盖真实工作量");
      const v = field(t, "verify") ?? "";
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
    }

    // ---- 全文级:缩水与范围承诺 ----
    const body = txt.slice(txt.indexOf("---", 3) + 3);   // 只扫正文,frontmatter 已单独校验
    if (SHRINK_STRONG.test(body)) e(`${name}: 正文含缩水措辞`, "范围缩水是拆票的理由,不是缩内容的理由(清单见 SKILL.md「缩水禁令」)");
    else if (SHRINK_WEAK.test(body)) w(`${name}: 正文含 v1`, "确认这是版本号命名而不是范围缩水");

    // ---- 决策契约:实现在 references/,主脚本只留接线(作用域差异见 runDecisionContracts 注释)----
    const dg = await import("../references/decision-gates.mjs"), { runDecisionContracts } = await import("../references/ticket-alive.mjs"), rg = await import("../references/research-gates.mjs");
    const ctxs = dg.locateContexts([relForCtx, P(".")], root);   // root 必须传:否则 cwd ≠ 项目根时会读别人的 CONTEXT
    runDecisionContracts({
      name, planPath: path, ctxs, root,
      readFile: (p) => readFileSync(p, "utf8"), check: dg, e, w,
    });
    rg.checkResearch({ name, goal: fm.goal ?? "", files: parsed.files, phase: unquote(String(fm.phase ?? name.slice(0, 2))), root, planDir: dirname(path), e, w });
  }

  console.log("\n=== mm-gsd 计划门禁(" + targets.length + " 份) ===");
  for (const t of targets) console.log("  " + t.split(/[\\/]/).pop());
  for (const x of errs) console.log(`  ✗ ${x.message}${x.fix ? `\n      → ${x.fix}` : ""}`);
  for (const x of warns) console.log(`  ! ${x.message}${x.fix ? `\n      → ${x.fix}` : ""}`);
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
        if (ov.length) { console.log(`    ⚠ wave ${w} 冲突: ${ov.join(", ")} 被 ${group[i].id} 与 ${group[j].id} 同时声明 —— 不能并行`); errs.push(1); }
      }
    }
    if (group.length > 1 && !errs.length) console.log(`    ✓ 同波次 files_modified 零重叠 —— wave ${w} 可并行`);
  }
  const pending = phases.filter((p) => !p.done);
  console.log(`\n  下一步:${pending.length ? pending[0].id + " " + (pending[0].title || "") : "(全部已完成)"}${pending[0]?.deps.length ? "  依赖: " + pending[0].deps.join(", ") : ""}`);
  process.exit(errs.length ? 1 : 0);
}

// ---- --stats:遥测聚合。读用户级日志,跨项目可比(项目级日志已被自动遥测取代)----
if (process.argv.includes("--stats")) {
  const { runStats } = await import("../references/telemetry-aggregate.mjs");
  process.exit(runStats({ path: TELEMETRY_PATH, scope: root, all: process.argv.includes("--all") }));
}

// ---- --selfcheck:门禁自己的正则自测 ----
// 用例与理由在 references/gate-selftest.mjs(GitHub #6/#7/#8 三条都是门禁判错而非崩溃,
// 必须有用例证明它会红)。放独立文件是为主脚本省行数,不是怕麻烦。
if (process.argv.includes("--selfcheck")) {
  const { runSelfTest } = await import("../references/gate-selftest.mjs");
  process.exit(runSelfTest(VAGUE_FILE, DEP_RE, splitDeps) ? 1 : 0);
}

// ---- --routes:技能路由门禁 —— 每个技能都要说清自己的下一步(D-05)----
if (process.argv.includes("--routes")) {
  const { checkRoutes } = await import("../references/skill-routing-gates.mjs");
  const problems = checkRoutes(join(SKILL_DIR, ".."));
  console.log("\n=== mm-gsd 技能路由门禁 ===");
  for (const p of problems) console.log(`  ✗ ${p.skill}: ${p.problem}`);
  if (problems.length) {
    console.log("  " + problems.length + " 处没写清下一步 —— 补一段「## 完成后」,写明做完这一步调哪个 mm-gsd 技能。");
    die(problems.length + " 个技能的「完成后」没写清", "每条上面都写了缺什么,补完重跑即可。");
  }
  console.log("  ✓ 每个技能都说清了自己的下一步");
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
  // 已有 CONTEXT 就把它当成 phase 01 的起点,别让 agent 再重读一遍
  const hasCtx = existsSync(P("CONTEXT.md"));
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
  if (existsSync(P("CONTEXT.md"))) console.log("检测到已有 CONTEXT.md —— 讨论已完成的部分直接用,不必重来。下一步:跑 mm-gsd-plan。");
  console.log("接着做:填 Project Reference 的 Current focus 与 ## Phases 清单,再跑 --phases 看波次。");
  console.log("(占位项是给你改的;检查器不拦 STATE 正文,只拦 frontmatter 契约与工件一致性)");
  process.exit(0);
}

// ---- STATE ----
if (!existsSync(P("STATE.md"))) {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ state: null, derived: null, errors: [{ message: ".planning/STATE.md 不存在", fix: "跑 gsd-state-check.mjs --init 一条命令建好,别手搓" }], warnings: [] }));
  } else {
    console.log("mm-gsd 状态机:未初始化(无 .planning/STATE.md)。");
    console.log("  → 跑 `node <本脚本> --init \"<项目目标>\"` 即可建好,不必手搓模板。");
    console.log("    (建 STATE 不是门禁的执行方该干的活 —— 门禁要的东西做不到,门禁就是死锁而不是门禁。)");
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
  const files = inPhases.length > 0 ? inPhases : rootFiles;
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
  if (!has(artifactInfo.context)) derived = "discussing";
  else if (artifactInfo.plans.length === 0) derived = "planning";
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
  for (const s of artifactInfo.summaries) {
    const sfm = frontmatter(J(s));
    if (!sfm?.status) err(`${s}: 缺 status(须为 ${SUMMARY_STATUSES.join("|")})`, "补 frontmatter;受阻就如实写 halted,别不写");
    else if (!SUMMARY_STATUSES.includes(sfm.status)) err(`${s}: status 非法值 "${sfm.status}"`, `改为 ${SUMMARY_STATUSES.join(" 或 ")}`);
    else if (sfm.status === "halted") warn(`${s}: status=halted —— 有未解决的阻碍目标,不算完成`, "补修复计划或如实留待下个 phase;别拿它当完成");
    if (sfm && !/^\d+$/.test(sfm.commits ?? "")) err(`${s}: commits 非纯数字 "${sfm.commits ?? "(缺)"}" —— 必须 git rev-list 实测`, "git rev-list --count <base>..HEAD");
  }
  // ---- 记账纪律随包分发(D-02):「声称完成却零 commit」当场判红 ----
  // 记账门只判这一条 —— 「这张票认领了哪条决策」由 phase 级 union 门判(D-03),
  // 一个判定只能有一个 owner;两处各判一半,判据还各说各话。
  // 存量项目的老工件会立刻变红,豁免台账(.planning/artifact-ledger.md)是随包件:
  // 记一行指向一个真实存在的 commit,原件不动。
  {
    const { checkArtifactLedger } = await import("../references/artifact-ledger.mjs");
    checkArtifactLedger({ root, report: { pass: () => {}, fail: (m) => err(m), info: (m) => warn(m) } });
  }
  if (artifactInfo.verification) {
    const vfm = frontmatter(J(artifactInfo.verification));
    if (!vfm?.status) err(`${artifactInfo.verification}: 缺 status(须为 ${VERIF_STATUSES.join("|")})`, "补 frontmatter");
    else if (!VERIF_STATUSES.includes(vfm.status)) err(`${artifactInfo.verification}: status 非法值 "${vfm.status}"`, `改为 ${VERIF_STATUSES.join(" 或 ")}`);
    // status 合法 ≠ 报告诚实。这条闸拦的是「正文 4 条 FAILED、frontmatter 却写 passed」
    for (const i of validateVerification(readFileSync(J(artifactInfo.verification), "utf8"), vfm.status)) i.level === "warn" ? warn(`${artifactInfo.verification}: ${i.message}`, i.fix) : err(`${artifactInfo.verification}: ${i.message}`, i.fix);
  }
  // D-04 要求漂移门管四类工件,--plan 那条只管 PLAN;验收/交付两份在这里补上
  if (artifactInfo.context) {
    const { checkConclusionDrift } = await import("../references/decision-gates.mjs");
    const concl = [[artifactInfo.verification, "验收"], [artifactInfo.shipment, "交付"]].filter(([f]) => f);
    for (const i of checkConclusionDrift({ ctxPath: J(artifactInfo.context), items: concl.map(([file, kind]) => ({ kind, file, path: J(file) })) }))
      i.level === "warn" ? warn(i.message, i.fix) : err(i.message, i.fix);
  }
  // ---- 交付契约:交付物"被消费",不是"被做完" ----
  if (artifactInfo.shipment) {
    const shm = frontmatter(J(artifactInfo.shipment));
    if (!shm?.status) err(`${artifactInfo.shipment}: 缺 status(须为 ${SHIP_STATUSES.join("|")})`, "补 frontmatter;受阻就如实写 held");
    else if (!SHIP_STATUSES.includes(shm.status)) err(`${artifactInfo.shipment}: status 非法值 "${shm.status}"`, `改为 ${SHIP_STATUSES.join(" 或 ")}`);
    if (shm?.status === "shipped") {
      const ev = unquote(shm.delivered ?? "");
      if (!ev || NO_DIRECTION.test(ev)) err(`${artifactInfo.shipment}: delivered 缺交付证据`, "填 PR 链接 / 合并 commit / 发布单号 —— 交付是被消费的,不是被完成的");
      else if (/[<>]/.test(ev)) err(`${artifactInfo.shipment}: delivered 还是模板占位符`, "替换成真实位置(PR 链接 / 合并 commit / 发布单号);尖括号包着的是说明,不是证据");
      if (shm.docs_synced !== "yes") warn(`${artifactInfo.shipment}: docs_synced != yes —— 用户可见变更没同步文档`, "改了用法/接口/配置就更新文档;没改写 no 并说明");
    }
  } else if (derived === "completed") {
    warn("验证已通过但没有 SHIP 工件 —— 本 phase 停在验证,没走到交付", "写 <NN>-MM-SHIP.md(status/delivered/docs_synced);交付物被消费才算完成");
  }
  // ---- STATE 声明 vs 推导 ----
  if (declared && !STATUSES.includes(declared)) {
    err(`STATE status "${declared}" 非法`, `改为 ${STATUSES.join("|")}`);
  }
  if (declared && derived && declared !== derived && declared !== "paused") {
    err(`STATE 声明 "${declared}" 但工件推导是 "${derived}" —— 声明与事实不符`, `把 STATE status 改为 ${derived}(或补齐缺失工件)`);
  }
  if (declared === "paused") {
    const hasHandoff = existsSync(P("HANDOFF.md")) || existsSync(P("HANDOFF.json"));
    if (!hasHandoff) warn("paused 但无 HANDOFF.md —— 中断后无法快速恢复", "写 HANDOFF(位置/已完成/未提交文件实测)");
  }

  // ---- 占位文本(假完成信号)----
  for (const f of [...artifactInfo.summaries, ...(artifactInfo.verification ? [artifactInfo.verification] : []), ...(artifactInfo.shipment ? [artifactInfo.shipment] : [])]) {
    const text = readFileSync(J(f), "utf8");
    if (PLACEHOLDER.test(text)) warn(`${f}: 含占位文本 —— 判假完成风险(Known Stubs 节里的合法描述可忽略)`, "填真实内容或移到 Known Stubs 并说明原因");
  }
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
