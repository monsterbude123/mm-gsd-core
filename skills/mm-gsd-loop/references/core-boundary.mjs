// 核心边界门(28-04,D-09/REQ-60):「核心不许知道可选包」的机器化。
// 核心 = skills/ 下除声明 optional:true 的可选包目录以外的文件 + bin/;README 与 docs/ 是产品文档,不在扫描范围。
// 三条规则:①核心 .md 不出现包的显示名(只扫 .md —— readme-lf 自测的禁则词表是合法 .mjs 内容);
// ②核心任何文件不出现包的目录名或命令调用形(带 mm-gsd 前缀的完整调用形,裸词别名不查);
// ③没有任何可选包时返回 0 条(核心不要求可选包存在)。
// 冻结基准快照与孪生(plan-review-fixtures/)是数据不是活文案,排除(与 .mjs.baseline 同理)。
// 判定只认 28-01 的 discoverPacks(包自声明),核心不硬编码任何包名。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { discoverPacks } from "./packs.mjs";

const FROZEN = /plan-review-fixtures[\\/]/;

function walkFiles(dir, out = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

/** 核心 = skills 下减去 optional 包目录与冻结快照目录的全部文件 + bin 文件;返回绝对路径数组 */
export function coreFiles({ skillsRoot, binPath }) {
  const packs = discoverPacks(skillsRoot).filter((p) => p.optional);
  const packDirs = packs.map((p) => p.dir);
  const all = walkFiles(skillsRoot).filter((f) => {
    if (FROZEN.test(f)) return false;
    return !packDirs.some((d) => f === d || f.startsWith(d + "\\") || f.startsWith(d + "/"));
  });
  let binFiles = [];
  try { binFiles = walkFiles(binPath); } catch { binFiles = []; }
  return { core: all.concat(binFiles), packs };
}

/** 三条规则判定;返回问题数组 [{rule, file, message, fix}] */
export function checkCoreBoundary({ skillsRoot, binPath }) {
  const { core, packs } = coreFiles({ skillsRoot, binPath });
  const problems = [];
  if (!packs.length) return problems; // 规则三:没有可选包 → 0 条
  for (const pack of packs) {
    const commands = ["mm-gsd " + pack.name.replace(/^mm-gsd-/, ""), ...(pack.aliases ?? []).map((a) => "mm-gsd " + a)];
    for (const f of core) {
      let text = "";
      try { text = readFileSync(f, "utf8"); } catch { continue; }
      const rel = relative(process.cwd(), f).replace(/\\/g, "/");
      if (f.endsWith(".md") && pack.display && text.includes(pack.display)) {
        problems.push({
          rule: 1,
          file: rel,
          message: `核心 .md 出现可选包的显示名「${pack.display}」—— 核心不认识可选包`,
          fix: "改写成不含显示名的说法(可选包自己随便写)",
        });
      }
      const hits = [];
      if (text.includes(pack.name)) hits.push("目录名 " + pack.name);
      for (const c of commands) if (text.includes(c)) hits.push("命令调用形 " + c);
      if (hits.length) {
        problems.push({
          rule: 2,
          file: rel,
          message: `核心文件出现可选包的${hits.join("、")}—— 核心不引用可选包`,
          fix: "删掉引用或改成包无关说法;确需交互走 annotations.json 数据契约",
        });
      }
    }
  }
  return problems;
}

/** mmc health 的接线入口:逐条 report.fail,有问题返回 false(死门禁判据认这个调用形) */
export function checkCoreBoundaryAll({ root, report }) {
  const problems = checkCoreBoundary({
    skillsRoot: join(root, "skills"),
    binPath: join(root, "bin"),
  });
  for (const p of problems) report.fail("[" + p.rule + "] " + p.file + ": " + p.message + " —— " + p.fix);
  if (!problems.length) report.pass("核心不认识可选包(显示名/目录名/命令调用形零命中)");
  return problems.length === 0;
}

// statSync 保留导入占位:未来按 mtime 做增量判定时用;当前未引用不影响零依赖
void statSync;
