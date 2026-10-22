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
