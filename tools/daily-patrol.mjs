#!/usr/bin/env node
// 日常巡检器(autoresearch/daily-patrol 探索产物):只读、零依赖、确定性输出。
// 巡检是报告不是失败:alert 是状态,exit 0。--benchmark 供指标脚本消费(输出纯 JSON)。
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { buildDebt } from "../skills/mm-gsd-loop/references/debt-panel.mjs";
import { checkReqCoverage } from "../skills/mm-gsd-loop/references/verification-gates.mjs";

const ROOT = process.cwd();
const SELF = "tools/daily-patrol.mjs"; // 巡检器不数自己:自身文案里的 TODO/FIXME 字样不计入漂移
const checks = [];
const add = (id, status, detail) => checks.push({ id, status, detail });

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
const read = p => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return null; } };
const P = (...s) => join(ROOT, ".planning", ...s);

// ---- 每轮在此追加检查 ----

// planning 卫生:未分类 deferred 清零(25-CONTEXT D-02 战役终态,防再积)
try {
  function walk(dir, out = []) {
    let names = [];
    try { names = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of names) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
    }
    return out;
  }
  const planningDir = {};
  for (const abs of walk(join(ROOT, ".planning"))) {
    const rel = relative(P("."), abs) ? relative(join(ROOT, ".planning"), abs).split(/[\\/]/).join("/") : "";
    planningDir[rel] = readFileSync(abs, "utf8");
  }
  const debt = buildDebt({ planningDir });
  const uncls = debt.deferred.filter(x => x.kind === "未分类");
  add("planning-deferred-未分类", uncls.length === 0 ? "ok" : "alert", `未分类 ${uncls.length} 条(战役终态 0;超 0 即新僵尸)`);
} catch (e) {
  add("planning-deferred-未分类", "error", String(e).slice(0, 80));
}

// planning 卫生:open 批注清零
try {
  const annPath = join(ROOT, ".planning", "annotations.json");
  const ann = existsSync(annPath) ? JSON.parse(readFileSync(annPath, "utf8")) : [];
  const open = ann.filter(x => x.status === "open");
  add("planning-批注-open", open.length === 0 ? "ok" : "alert", `open 批注 ${open.length} 条(open 即用户在等 agent 消化)`);
} catch (e) {
  add("planning-批注-open", "error", String(e).slice(0, 80));
}

// 状态机一致性:声明 == 推导(checker 默认模式退出码)
try {
  run("node", ["skills/mm-gsd-loop/scripts/gsd-state-check.mjs"]);
  add("state-machine-一致", "ok", "STATE 声明与工件推导一致");
} catch (e) {
  add("state-machine-一致", "alert", "状态机声明与推导不符(checker 非 0,跑 gsd-state-check 看详情)");
}

// 需求全认领:REQUIREMENTS 每条 REQ 有票认领(覆盖门正方向)
try {
  const problems = checkReqCoverage({ root: ROOT, plansDir: join(ROOT, ".planning") });
  add("reqs-全认领", problems.length === 0 ? "ok" : "alert", problems.length ? problems[0] + (problems.length > 1 ? ` 等 ${problems.length} 条` : "") : "REQUIREMENTS 每条 REQ 都有票认领");
} catch (e) {
  add("reqs-全认领", "error", String(e).slice(0, 80));
}

// 产品文档禁词零命中(窄口径,23-03 同款)
try {
  const docsDir = join(ROOT, "docs", "product");
  const banned = /(REQ-\d|\b\d{2}-\d{2}\b|skills[\\/]mm-gsd|\.planning[\\/])/;
  const hits = [];
  let names = [];
  try { names = readdirSync(docsDir); } catch {}
  for (const n of names.filter(x => x.endsWith(".md"))) {
    const m = readFileSync(join(docsDir, n), "utf8").match(new RegExp(banned.source, "g"));
    if (m) hits.push(n + ": " + [...new Set(m)].slice(0, 3).join(", "));
  }
  add("docs-禁词", hits.length === 0 ? "ok" : "alert", hits.length ? hits.join(" | ") : "docs/product 禁词零命中");
} catch (e) {
  add("docs-禁词", "error", String(e).slice(0, 80));
}

// 发布一致:package.json 版本 == 最新 git 标签
try {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const tag = run("git", ["describe", "--tags", "--abbrev=0"]).trim();
  const ok = tag === "v" + pkg.version;
  add("release-版本标签一致", ok ? "ok" : "alert", "package.json " + pkg.version + " vs 最新标签 " + tag);
} catch (e) {
  add("release-版本标签一致", "error", String(e).slice(0, 80));
}

// 推送纪律:main 相对 origin/main 的未推送提交数
try {
  const n = run("git", ["rev-list", "--count", "origin/main..main"]).trim();
  add("main-未推送", Number(n) === 0 ? "ok" : "alert", "main 领先 origin/main " + n + " 个提交(日常提交后记得 push)");
} catch (e) {
  add("main-未推送", "error", String(e).slice(0, 80));
}

// 漂移 vs 基线:TODO/FIXME 计数(基线文件 tools/patrol-baseline.json,故意更新基线 = keep 提交的一部分)
try {
  const base = JSON.parse(readFileSync(join(ROOT, "tools", "patrol-baseline.json"), "utf8"));
  const tracked = run("git", ["ls-files"]).split("\n").filter(f => f.trim() !== SELF && /\.(mjs|md)$/.test(f.trim()) && f.trim());
  let todo = 0;
  for (const f of tracked) todo += (readFileSync(join(ROOT, f.trim()), "utf8").match(/TODO|FIXME/g) || []).length;
  const drift = todo - base.todoCount;
  add("todo-漂移", drift <= 0 ? "ok" : "alert", "TODO/FIXME " + todo + "(基线 " + base.todoCount + ",漂移 +" + drift + ")");
} catch (e) {
  add("todo-漂移", "error", String(e).slice(0, 80));
}

// 漂移 vs 基线:最大单文件体积(预算代理)
try {
  const base = JSON.parse(readFileSync(join(ROOT, "tools", "patrol-baseline.json"), "utf8"));
  const tracked = run("git", ["ls-files"]).split("\n").filter(f => f.trim() !== SELF && /\.(mjs|md)$/.test(f.trim()) && f.trim());
  let maxB = 0, maxF = "";
  for (const f of tracked) { const b = Buffer.byteLength(readFileSync(join(ROOT, f.trim()), "utf8")); if (b > maxB) { maxB = b; maxF = f.trim(); } }
  const over = maxB - base.maxFileBytes;
  add("file-预算", over <= base.sizeSlack ? "ok" : "alert", "最大单文件 " + maxF + " " + maxB + "B(基线 " + base.maxFileBytes + "B,超 " + over + "B;容忍 " + base.sizeSlack + "B)");
} catch (e) {
  add("file-预算", "error", String(e).slice(0, 80));
}

// ---- 输出 ----
// 确定性契约:--benchmark 输出只含 checks(双跑逐字节一致);时间戳只进人读路径。
if (process.argv.includes("--benchmark")) console.log(JSON.stringify({ checks }, null, 2));
else {
  const ts = new Date().toISOString();
  for (const c of checks) console.log(`[${c.status.toUpperCase()}] ${c.id} — ${c.detail}`);
  const alerts = checks.filter(c => c.status === "alert").length;
  console.log(`\n${checks.length} 项巡检,${alerts} 项 alert(${ts})`);
}
