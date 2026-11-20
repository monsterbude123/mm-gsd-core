#!/usr/bin/env node
// ssot-check —— 结构化单一事实源的附加校验(phase 32,REQ-67;用户拍板:附加的检查、
// 单独脚本位置)。对任意 .planning 树跑 references/ssot.mjs 的全部契约解析,输出
// 结构化报告(JSON 与人读两式);解析抛错/字段缺失/非法值 → 非零退出。
//
// 它是 JSON 真相源转换(phase 33)的前置检查面:迁移前先跑它,迁移后重跑比对。
//
// 用法:
//   node ssot-check.mjs --planning <dir>          # 人读报告
//   node ssot-check.mjs --planning <dir> --json   # 机读报告
//   node ssot-check.mjs --planning <dir> --strict # 零 problem 才退出 0(缺文件也算)

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ssotReport } from "../references/ssot.mjs";

const argv = process.argv.slice(2);
const pi = argv.indexOf("--planning");
const dir = pi >= 0 ? resolve(argv[pi + 1]) : resolve(process.cwd(), ".planning");
const asJson = argv.includes("--json");
const strict = argv.includes("--strict");

if (!existsSync(dir)) {
  console.error(`.planning 目录不存在: ${dir}`);
  process.exit(2);
}

const report = ssotReport(dir);
const hard = report.problems.filter((p) => p.contract === "STATE" || p.message.includes("解析失败"));
const soft = report.problems.filter((p) => !hard.includes(p));

if (asJson) {
  console.log(JSON.stringify({ dir, ok: hard.length === 0 && !(strict && soft.length), contracts: report.contracts, problems: report.problems }, null, 2));
} else {
  console.log(`ssot-check —— 结构化单一事实源校验(${dir})`);
  for (const c of report.contracts) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.contract}  ${c.file ?? ""}${c.missing ? "(缺失)" : ""}`);
  }
  for (const p of report.problems) console.log(`  ✗ [${p.contract}] ${p.message}`);
  const hardCount = hard.length;
  console.log(hardCount === 0 ? `\n✓ 全部契约解析通过(${report.contracts.length} 份)` : `\n✗ ${hardCount} 条结构问题`);
}
process.exit(hard.length === 0 && !(strict && soft.length) ? 0 : 1);
