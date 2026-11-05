#!/usr/bin/env node
// mm-gsd-wave-check.mjs —— 波级批闸脚手架(phase 14 D-03/D-04,#17)
//
//   node mm-gsd-wave-check.mjs --phase <NN> --wave <N> [--baseline <路径>] [--dry]
//   node mm-gsd-wave-check.mjs --help
//
// 收集 .planning/<NN>-*-PLAN.md 里 frontmatter wave == N 的票,生成一份脚本:
// 头部 `cd '<该批 cwd 声明>'`(cwd 缺省则 `cd '.'` 并注释「票面未声明 cwd」),
// 正文逐票拼其 batch_verify(每票一段,标题写票号,echo WAVECHECK <票号> exit=$? 收集退出码)。
// 默认把脚本写进临时目录交 bash 执行并汇总各票退出码;--dry 只打印不执行;
// --baseline <树> 把同一脚本体在基线树再跑一遍(cd 头换成基线树),输出差分摘要
// (两边各几票红、本批独有红/基线独有红是哪些票)—— 只做差分呈现,不替用户判定
// 「基线红 = 无关」,归因归人。退出码:本批全绿 0,有红 1(--dry 恒 0)。
// 零依赖,只认 node: 内置;解析一律 /\r?\n/。执行依赖 bash(git-bash 自带)。

import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined; };

if (has("--help") || has("-h")) {
  console.log(`mm-gsd-wave-check —— 波级批闸脚手架(生成/执行 + --baseline 差分)

用法:
  node mm-gsd-wave-check.mjs --phase <NN> --wave <N> [--baseline <路径>] [--dry]

  --phase <NN>        phase 号,如 14(必需)
  --wave <N>          波号,只收 frontmatter wave == N 的 PLAN(必需)
  --baseline <路径>   基线树根:同一脚本体在基线树复跑,输出差分摘要(只呈现,不归因)
  --dry               只打印生成的脚本,不执行
  --help              本说明

行为:
  1. 扫 .planning/<NN>-*-PLAN.md,收 frontmatter wave == N 的票及其 batch_verify
  2. 生成脚本:头部 cd '<该批 cwd 声明>'(缺省 cd '.' 并注释「票面未声明 cwd」),
     正文逐票一段,标题写票号,echo WAVECHECK <票号> exit=$? 收集退出码
  3. 默认交 bash 执行,汇总各票退出码;退出码:本批全绿 0,有红 1
  4. --baseline:同脚本体在基线树再跑一遍,打印差分摘要
     (本批红 X/N 票、基线红 Y/N 票、本批独有红、基线独有红)—— 归因归人

执行需要 bash(Git for Windows 自带);batch_verify 每票一行命令。`);
  process.exit(0);
}

const phase = val("--phase");
const wave = val("--wave");
if (!phase || !/^\d+$/.test(phase) || !wave || !/^\d+$/.test(wave)) {
  console.error("✗ 用法:node mm-gsd-wave-check.mjs --phase <NN> --wave <N> [--baseline <路径>] [--dry](--help 看详情)");
  process.exit(1);
}
const baseline = val("--baseline");
if (baseline && !existsSync(baseline)) {
  console.error(`✗ --baseline 指向的树不存在:${baseline}`);
  process.exit(1);
}
if (!existsSync(".planning")) {
  console.error("✗ 这里没有 .planning/ —— 不是 mm-gsd 项目根,先 cd 到项目根再跑");
  process.exit(1);
}

// ---- 收票:wave == N 的 PLAN 及其 batch_verify / cwd ----
function frontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") { end = i; break; }
  if (end < 0) return null;
  return lines.slice(1, end);
}
const pick = (lines, re) => { for (const l of lines) { const m = l.match(re); if (m) return m[1].trim(); } return null; };

const plans = [];
let scanned = 0;
for (const f of readdirSync(".planning").sort()) {
  const m = f.match(new RegExp(`^${phase}-(\\d+)-PLAN\\.md$`));
  if (!m) continue;
  scanned++;
  const fm = frontmatter(readFileSync(join(".planning", f), "utf8"));
  if (!fm) continue;
  if (pick(fm, /^wave:\s*(\d+)\s*$/) !== wave) continue;
  plans.push({
    id: `${phase}-${m[1]}`,
    cwd: pick(fm, /^cwd:\s*(.+?)\s*$/),
    batchVerify: pick(fm, /^batch_verify:\s*(.+?)\s*$/),
  });
}
if (!plans.length) {
  console.error(`✗ .planning 里没有 wave ${wave} 的 phase ${phase} PLAN(扫了 ${scanned} 份 ${phase}-*-PLAN.md)`);
  process.exit(1);
}

const noBv = plans.filter((p) => !p.batchVerify);
const runnable = plans.filter((p) => p.batchVerify);

// ---- 生成脚本:头部 cd,cwd 缺省用当前目录并注释 ----
const cwdDecls = [...new Set(runnable.map((p) => p.cwd).filter((c) => c !== null))];
if (cwdDecls.length > 1) console.error(`⚠ 该批各票 cwd 声明不一致(${cwdDecls.join(", ")}),取第一份`);
const batchCwd = cwdDecls[0];
const header = batchCwd ? `cd '${batchCwd}'` : `cd '.' # 票面未声明 cwd,用当前目录`;
const script = header + "\n"
  + runnable.map((p) => `# ==== ${p.id} ====\n${p.batchVerify}\necho "WAVECHECK ${p.id} exit=$?"`).join("\n") + "\n";

if (has("--dry")) {
  process.stdout.write(script);
  process.exit(0);
}

// ---- 执行:临时目录落脚本,交 bash;bash 缺失给人话不抛栈 ----
function runScript(text) {
  const dir = mkdtempSync(join(tmpdir(), "mm-gsd-wave-"));
  const sp = join(dir, "wave.sh");
  writeFileSync(sp, text);
  const r = spawnSync("bash", [sp.split(sep).join("/")], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  if (r.error) return { err: "bash 跑不起来:" + r.error.message + "(执行依赖 bash,git-bash 自带)" };
  const codes = {};
  const out = String(r.stdout || "") + String(r.stderr || "");
  for (const m of out.matchAll(/^WAVECHECK (\S+) exit=(\d+)/gm)) codes[m[1]] = Number(m[2]);
  return { codes };
}

function report(label, codes) {
  const reds = [];
  for (const p of runnable) {
    const c = codes[p.id];
    if (c === undefined) { console.log(`✗ ${p.id} 红(没有退出码标记 —— cd 失败或命令没跑完)`); reds.push(p.id); }
    else if (c === 0) console.log(`✓ ${p.id} 绿(exit=0)`);
    else { console.log(`✗ ${p.id} 红(exit=${c})`); reds.push(p.id); }
  }
  console.log(`${label}红 ${reds.length}/${runnable.length} 票`);
  return reds;
}

for (const p of noBv) console.log(`⚠ ${p.id} 无 batch_verify,跳过(不计数)`);

const cur = runScript(script);
if (cur.err) { console.error("✗ " + cur.err); process.exit(1); }
const curReds = report("本批", cur.codes);

if (!baseline) {
  process.exit(curReds.length ? 1 : 0);
}

// ---- --baseline 差分:同脚本体,cd 头换成基线树;只呈现,不归因 ----
const baseScript = `cd '${baseline.split(sep).join("/")}' # 基线树\n` + script.split(/\r?\n/).slice(1).join("\n");
const base = runScript(baseScript);
if (base.err) { console.error("✗ " + base.err); process.exit(1); }
const baseReds = report("基线", base.codes);

const onlyCur = curReds.filter((id) => !baseReds.includes(id));
const onlyBase = baseReds.filter((id) => !curReds.includes(id));
console.log("差分摘要:本批红 " + curReds.length + "/" + runnable.length + " 票,基线红 " + baseReds.length + "/" + runnable.length + " 票");
console.log("本批独有红:" + (onlyCur.join(", ") || "无") + (onlyCur.length ? "(基线绿 —— 归因看这里)" : ""));
console.log("基线独有红:" + (onlyBase.join(", ") || "无") + (onlyBase.length ? "(本批绿 —— 只做呈现,归因归人)" : ""));
process.exit(curReds.length ? 1 : 0);
