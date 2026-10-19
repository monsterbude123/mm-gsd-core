// 临时补丁:--templates 模式的两个假绿
//   1. 路径靠字符串拼 URL,在 Windows 上解析不出目录 → 实际检查 0 份模板却报"全部合规"。改用现成的 SKILL_DIR。
//   2. 查了 0 份还报全过 —— 加硬失败:一份都没查到必须报错。
import { readFileSync, writeFileSync } from "node:fs";

const p = new URL("../skills/mm-gsd-loop/scripts/gsd-state-check.mjs", import.meta.url);
let src = readFileSync(p, "utf8");

const oldPath = '  const tmplRoot = join(dirname(new URL(import.meta.url).pathname.replace(/^\\\\\\/([A-Za-z]:)/, "$1")), "..");';
if (!src.includes(oldPath)) { console.log("路径锚点没找到"); process.exit(1); }
src = src.replace(oldPath, '  const tmplRoot = join(SKILL_DIR, "..");');

const oldTail = `  console.log("");
  if (bad) { console.log("  " + bad + " 份模板过不了自己的契约 —— 照抄即报错,agent 会卡在门禁上。"); process.exit(1); }
  console.log("  ✓ 全部模板结构合规");
  process.exit(0);`;

const newTail = `  console.log("");
  if (checked === 0) {
    console.log("  ✗ 一份模板都没找到 —— 目录解析坏了,这等于没检查。查 tmplRoot = " + tmplRoot);
    process.exit(1);
  }
  if (bad) {
    console.log("  " + bad + "/" + checked + " 份模板过不了自己的契约 —— 照抄即报错,agent 会卡在门禁上。");
    console.log("  每条上面都给了正确写法,照着改就行。");
    process.exit(1);
  }
  console.log("  ✓ " + checked + " 份模板结构合规");
  process.exit(0);`;

if (!src.includes(oldTail)) { console.log("尾部锚点没找到"); process.exit(1); }
src = src.replace(oldTail, newTail);

// 加 checked 计数
src = src.replace("  let bad = 0;\n  for (const tdir of", "  let bad = 0, checked = 0;\n  for (const tdir of");
src = src.replace("      const issues = validateTemplate(f, m[1]);", "      checked++;\n      const issues = validateTemplate(f, m[1]);");

writeFileSync(p, src);
console.log("已修正路径与 0 份兜底");
