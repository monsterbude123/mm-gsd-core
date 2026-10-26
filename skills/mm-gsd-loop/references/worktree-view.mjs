// 多工作树并发视图 —— 判断几个 worktree 能不能安全并行。
//
// 为什么独立成文件:这段逻辑原本长在 gsd-state-check.mjs 里(78 行),
// 而那个文件在 phase 04 开始前只剩 1 行头寸(699/700,budget.json 的 skills/**/*.mjs 上限)。
// 新机制(路由提示)要加在同一个脚本上 —— 不先腾地方,就只能二选一:顶破上限,
// 或者把新逻辑塞进一个没地方放的模块。搬出来是「references 化」的正当用法:
// 这段判定只在 `--worktrees` 这一个分支里用到,主流程每行都读它并不划算。
//
// 判定逻辑逐字保留(phase 04 的 T1):搬家不改行为。搬家改行为是另一件事,
// 混在一起就分不清「输出变了」是因为搬了家还是因为改了逻辑。
//
// phase 08 起这里还管**批内并行与票预算**(checkBatchGraph / checkTicketBudget):
// 「能不能并行」和「worktree 能不能并行」是同一个判断,两个地方各判一次就会分叉。
//
// 依赖注入:PLAN 的解析(frontmatter / parsePlanFile / listPlanFiles)在主脚本里,
// 搬过来抄一份就是第二真相源 —— 抄的那份迟早与原件分叉,而没人会比对它们。

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/**
 * 跑一遍多工作树视图,打印结果,返回退出码(有硬冲突 → 1)。
 *
 * @param cwd  基准目录(用于把绝对路径显示成相对路径)
 * @param plan { frontmatter, parsePlanFile, listPlanFiles } —— 主脚本的 PLAN 解析三件套
 * @param die  (message, fix) => never —— 主脚本的早退出口(打印 + 记遥测 + 退出 1)
 */
export function runWorktrees({ cwd, plan, die }) {
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

  const { frontmatter, parsePlanFile, listPlanFiles } = plan;
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
  const base = norm(cwd).replace(/\/+$/, "");
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
  return hard.length ? 1 : 0;
}

/**
 * 批图门禁(phase 08 D-02):可并行的两张票**不许撞同一个文件**,票间依赖不许成环。
 *
 * 为什么要它:原版 GSD 把这条做进了分派器(`gsd-planner.md:761`「Same-wave plans must have
 * zero files_modified overlap」,`execute-phase.md:525-530` 派活前再查一遍)。mm-gsd 没有分派器,
 * 也就没人查 —— 于是「并行」只存在于散文里。判据只取**工件事实**:票的 files 清单与依赖声明。
 *
 * 只在**同一个 phase 内**判:不同 phase 碰同一个文件是正常的(前一个 phase 改完,后一个再改),
 * 跨 phase 判重叠会把正常的先后关系判成冲突。
 *
 * @param tickets [{id, files:[], depends:[]}] 同一 phase 的票
 * @returns 问题串数组;空数组 = 批图健康 */
export function checkBatchGraph(tickets) {
  const problems = [];
  const byId = new Map(tickets.map((t) => [t.id, t]));
  // 依赖成环:顺着 depends 走一圈回到自己
  const state = new Map();
  const walk = (id, path) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "open") { problems.push(`依赖成环:${[...path, id].join(" → ")} —— 批图没有入口,派不了活`); return; }
    state.set(id, "open");
    for (const d of byId.get(id)?.depends ?? []) if (byId.has(d)) walk(d, [...path, id]);
    state.set(id, "done");
  };
  for (const t of tickets) walk(t.id, []);
  // 可并行的两张票撞同一个文件:谁都不依赖谁 → 可能同时开工 → 必须零文件重叠
  for (let i = 0; i < tickets.length; i++) {
    for (let j = i + 1; j < tickets.length; j++) {
      const a = tickets[i], b = tickets[j];
      const linked = (a.depends ?? []).includes(b.id) || (b.depends ?? []).includes(a.id);
      if (linked) continue;
      const hit = (a.files ?? []).filter((f) => (b.files ?? []).includes(f));
      if (hit.length) problems.push(`${a.id} 与 ${b.id} 互不依赖(可并行)却撞了文件:${hit.join("、")} —— 并行必冲突,拆批或补依赖`);
    }
  }
  return problems;
}

/**
 * 票预算门禁(phase 08 D-03/D-04):一票只接**一条** verify,且它不许是全量套件。
 *
 * 为什么要它:「逐次循环」在机器上留下的痕迹就是**每票都跑一遍全量**。全量套件每跑一次都是几十秒到几分钟,
 * 票一多就把整批的时间吃光;而逐票跑全量并不会多给一条证据 —— 票级要的是「这一票的断言过没过」,
 * 那是具名测试/单文件的事(原版 `gsd-code-fixer.md:715`、`gsd-verifier.md:477`)。全量属于批级 batch_verify。
 *
 * @param tasks [{id, verify}] 票
 * @returns 问题串数组;空数组 = 票预算健康
 */
export function checkTicketBudget(tasks) {
  const problems = [];
  for (const t of tasks) {
    const cmds = splitCommands(String(t.verify ?? ""));
    // 只数「测试类」命令:`cd x && npm test` 是一条检查,不是两条
    const tests = cmds.filter((c) => TEST_CMD.test(c));
    if (tests.length > 1) problems.push(`${t.id}: ${tests.length} 条测试命令 —— 一票只接一个子代理,一次只验一件事(其余挪到批级 batch_verify)`);
    for (const c of cmds) if (isFullSuite(c)) problems.push(`${t.id}: verify 是全量套件(${c})—— 票级只跑本票的便宜检查,全量写进 PLAN 的 batch_verify`);
  }
  return problems;
}

/** 看起来是「跑测试」的命令 */
const TEST_CMD = /\b(npm\s+(?:run\s+)?test|node\s+--test|pytest|jest|vitest|go\s+test|cargo\s+test|mvn\s+test|gradle\s+test|make\s+test)\b/;

/** 按 shell 语义切命令:引号里的 ; 与 && 不算分隔符 */
export function splitCommands(cmd) {
  const out = [];
  let cur = "", q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q && cmd[i - 1] !== "\\") q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; cur += c; continue; }
    if (c === ";" || c === "\n") { out.push(cur); cur = ""; continue; }
    if ((c === "&" || c === "|") && cmd[i + 1] === c) { out.push(cur); cur = ""; i++; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** 这条命令是不是「跑全套」?有收窄参数(具名测试/单文件/单包)就不算。 */
export function isFullSuite(cmd) {
  const c = String(cmd ?? "").replace(/[`'"]/g, "");
  if (/\bgo\s+test\b/.test(c)) return /\.\.\./.test(c) || !/\s\.\//.test(c);
  if (/\bnode\s+--test\b/.test(c)) return !/\s\S+\.(?:mjs|cjs|js|ts|mts|cts|jsx|tsx)\b/.test(c);
  if (/\bpytest\b/.test(c)) return !/\s\S+\.py\b|\s-t\s|\s-k\s/.test(c);
  if (/\bnpm\s+(?:run\s+)?test\b/.test(c)) return !/\s--\s|\s\S+\.(?:mjs|cjs|js|ts|tsx|mts|py|cts)\b|\s-t\s/.test(c);
  if (/\b(?:yarn|pnpm)\s+test\b/.test(c)) return !/\s--\s|\s\S+\.(?:mjs|cjs|js|ts|tsx)\b/.test(c);
  if (/\bjest\b|\bvitest\b/.test(c)) return !/\s\S+\.(?:mjs|cjs|js|ts|tsx)\b|\s-t\s/.test(c);
  if (/\bcargo\s+test\b/.test(c)) return !/\s--\s*\S+\s+\S/.test(c);
  if (/\bmvn\s+test\b|\bgradle\s+test\b|\bmake\s+test\b/.test(c)) return true;
  return false;
}
