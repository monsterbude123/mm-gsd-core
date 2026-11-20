#!/usr/bin/env node
// ssot-migrate —— 结构化真相源的机械迁移脚本(phase 33,REQ-68;用户拍板:
// 单独脚本位置、兼附加检查、不消耗 agents)。
//
// 三个模式:
//   --check    体检(默认):比对 ssot.json 与 Markdown 派生的差异 + 指纹新鲜度;
//              有差异/陈旧逐条列出并非零退出 —— 这就是「附加的检查」。
//   --apply    写 ssot.json(原子:临时文件 + rename,不留半截状态)
//   --dry-run  只报告将写什么,不写
//
// 幂等:对已迁移的树再跑 --apply,内容零变化(除 generatedAt 时间戳外)。
// 不消耗 agents:纯脚本,不 spawn 子代理。

import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildMirror, deriveContracts, loadMirror, staleContracts, SSOT_SCHEMA, SSOT_FILE, contentSha } from "../references/ssot.mjs";

const argv = process.argv.slice(2);
const pi = argv.indexOf("--planning");
const dir = pi >= 0 ? resolve(argv[pi + 1]) : resolve(process.cwd(), ".planning");
const apply = argv.includes("--apply");
const dryRun = argv.includes("--dry-run");
const check = !apply && !dryRun; // 默认 --check

if (!existsSync(dir)) {
  console.error(`.planning 目录不存在: ${dir}`);
  process.exit(2);
}

const target = join(dir, SSOT_FILE);
const derived = deriveContracts(dir);
const derivedMirror = { schema: SSOT_SCHEMA, contracts: derived.contracts };
const existing = loadMirror(dir);

if (apply || dryRun) {
  // 原子写:先写临时文件,再 rename(同目录 ⇒ 同卷 ⇒ rename 是原子的)
  const payload = { schema: SSOT_SCHEMA, generatedAt: new Date().toISOString(), contracts: derived.contracts };
  const text = JSON.stringify(payload, null, 2) + "\n";
  if (dryRun) {
    console.log(`ssot-migrate --dry-run(${dir})`);
    for (const [k, c] of Object.entries(derived.contracts)) console.log(`  将写入 ${k}  ← ${c.source}(sha ${c.sha})`);
    console.log(`\n共 ${Object.keys(derived.contracts).length} 份契约;未写盘。`);
    process.exit(0);
  }
  const tmp = target + ".tmp";
  try {
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, target);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* 临时文件清理失败不掩盖主错误 */ }
    console.error(`写入失败(已清理临时文件,ssot.json 未被破坏): ${e.message}`);
    process.exit(1);
  }
  console.log(`✓ 已迁移 ${Object.keys(derived.contracts).length} 份契约 → ${target}`);
  process.exit(0);
}

// --check:差异 + 陈旧
const problems = [];
if (!existing) {
  problems.push({ kind: "未迁移", detail: `没有 ${SSOT_FILE}(跑 --apply 迁移)` });
} else {
  if (existing.schema !== SSOT_SCHEMA) problems.push({ kind: "schema 不符", detail: `镜像 schema=${existing.schema},当前=${SSOT_SCHEMA}` });
  const ex = existing.contracts ?? {};
  const dv = derived.contracts ?? {};
  for (const k of Object.keys(dv)) {
    if (!ex[k]) { problems.push({ kind: "缺契约", detail: k }); continue; }
    if (ex[k].sha !== dv[k].sha) problems.push({ kind: "陈旧", detail: `${k}(源文件已改动 → 镜像过期)` });
    if (JSON.stringify(ex[k].value) !== JSON.stringify(dv[k].value)) problems.push({ kind: "值不一致", detail: k });
  }
  for (const k of Object.keys(ex)) {
    if (!dv[k]) problems.push({ kind: "多出契约", detail: `${k}(源文件已删除?)` });
  }
  for (const s of staleContracts(existing, dir)) problems.push({ kind: "陈旧", detail: `${s.contract}(${s.reason})` });
}

if (problems.length === 0) {
  console.log(`✓ ssot-migrate --check:${dir} 零漂移(${Object.keys(existing?.contracts ?? {}).length} 份契约与 Markdown 派生一致)`);
  process.exit(0);
}
console.log(`ssot-migrate --check:${dir} —— ${problems.length} 条差异:`);
for (const p of problems) console.log(`  ✗ [${p.kind}] ${p.detail}`);
console.log(`\n修法:node ${"skills/mm-gsd-loop/scripts/ssot-migrate.mjs"} --apply --planning ${dir}`);
process.exit(1);
