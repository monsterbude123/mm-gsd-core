#!/usr/bin/env node
// 日常巡检器(autoresearch/daily-patrol 探索产物):只读、零依赖、确定性输出。
// 巡检是报告不是失败:alert 是状态,exit 0。--benchmark 供指标脚本消费(输出纯 JSON)。
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const checks = [];
const add = (id, status, detail) => checks.push({ id, status, detail });

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const read = p => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return null; } };

// ---- 每轮在此追加检查 ----

// ---- 输出 ----
// 确定性契约:--benchmark 输出只含 checks(双跑逐字节一致);时间戳只进人读路径。
if (process.argv.includes("--benchmark")) console.log(JSON.stringify({ checks }, null, 2));
else {
  const ts = new Date().toISOString();
  for (const c of checks) console.log(`[${c.status.toUpperCase()}] ${c.id} — ${c.detail}`);
  const alerts = checks.filter(c => c.status === "alert").length;
  console.log(`\n${checks.length} 项巡检,${alerts} 项 alert(${ts})`);
}
