// 可选包机制(28-01,D-03):包自己声明自己 —— 目录名 mm-gsd-* + SKILL.md frontmatter 声明 entry:。
// 核心不硬编码任何包名/目录名/命令名;判定只认声明。零依赖,只用 node 内置模块。
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const stripQuotes = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "").trim();

/** 解析 aliases 的两种写法:`[fk, version]`(无引号)与 `["fk", "version"]`(带引号)——
 *  先去方括号、再去引号,按逗号与空白切分,两种写法读出来一样。 */
function parseAliases(v) {
  const s = String(v ?? "").trim().replace(/^\[|\]$/g, "");
  if (!s) return [];
  return s.split(/[,\s]+/).map((x) => stripQuotes(x)).filter(Boolean);
}

/** 读 SKILL.md 文件**开头**的 frontmatter 围栏(只认文件开头,中段的 --- 不算) */
function readFrontmatter(file) {
  const text = readFileSync(file, "utf8");
  if (!text.startsWith("---")) return {};
  const end = text.slice(3).search(/^---\s*$/m);
  if (end < 0) return {};
  const block = text.slice(3, end + 3);
  const out = {};
  for (const line of block.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

/**
 * 发现可选包:目录名以 mm-gsd- 开头,且它自己的 SKILL.md frontmatter 声明了 entry:。
 * 解析不到 entry: 的目录不算包(不是包就不是包,不报错)。
 * 返回数组,每项 { name, dir(绝对路径), entry, optional, display, aliases }。
 */
export function discoverPacks(skillsRoot) {
  let dirs = [];
  try { dirs = readdirSync(skillsRoot, { withFileTypes: true }); } catch { return []; }
  const packs = [];
  for (const d of dirs) {
    if (!d.isDirectory() || !d.name.startsWith("mm-gsd-") || d.name.endsWith(".bak-mmgsd")) continue;
    const dir = resolve(skillsRoot, d.name);
    const sf = join(dir, "SKILL.md");
    if (!existsSync(sf)) continue;
    const fm = readFrontmatter(sf);
    if (!fm.entry) continue;
    packs.push({
      name: d.name,
      dir,
      entry: stripQuotes(fm.entry),
      optional: fm.optional === "true",
      display: stripQuotes(fm.display) || d.name.replace(/^mm-gsd-/, ""),
      aliases: parseAliases(fm.aliases),
    });
  }
  return packs.sort((a, b) => a.name.localeCompare(b.name));
}

/** 命中规则:命令名等于包名去掉 mm-gsd- 前缀,或落在 aliases: 里;未命中返回 null(不误命中) */
export function resolvePack(packs, cmd) {
  const c = String(cmd ?? "");
  for (const p of packs) {
    const stem = p.name.replace(/^mm-gsd-/, "");
    if (c === stem) return p;
    if ((p.aliases ?? []).includes(c)) return p;
  }
  return null;
}

/** 入口解析:命中包的入口 = 包目录(绝对)拼 entry;入口不在时 missing 为 true,
 *  message 是一句人话,带包名与入口相对路径 —— 使用者照着它知道差了哪个文件。 */
export function resolveEntry(pack) {
  const entryPath = join(pack.dir, pack.entry);
  const missing = !existsSync(entryPath);
  return {
    entryPath,
    missing,
    message: missing ? `找不到 ${pack.name} 的入口 ${pack.entry}(该包可能没装全)` : "",
  };
}

/** 技能根注入点(bin 与检查器共用同一形状;核心不硬编码任何包目录) */
export function skillsRootOr(baseDir, env) {
  return (env && env.GSD_SKILLS_ROOT) || baseDir;
}

/**
 * 唯一夹具构造处:自测与票面 verify 都 import 它,谁也不许自己再造一份(抄一份夹具就是抄一份会走偏的判据)。
 * root 下四目录:mm-gsd-fake(entry+optional,aliases 无引号写法,入口打印 marker 后 exit 7)/
 * mm-gsd-plain(没 entry → 不是包)/ mm-gsd-noopt(entry 无 optional → 仍是核心技能,aliases 带引号)/
 * mm-gsd-broken(声明 entry 但入口文件不存在);plainRoot 只有 mm-gsd-plain(零包场景)。
 */
export function makePackFixture() {
  const root = mkdtempSync(join(tmpdir(), "mm-gsd-pack-"));
  const plainRoot = mkdtempSync(join(tmpdir(), "mm-gsd-plain-"));
  const skill = (body) => ["---", ...Object.entries(body).map(([k, v]) => k + ": " + v), "---", "", "## 完成后", "", "下一步:回到 mm-gsd-loop。"].join("\n");
  const fakeEntry = "scripts/entry.mjs";
  const brokenEntry = "scripts/missing.mjs";
  const fake = "mm-gsd-fake", plain = "mm-gsd-plain", noopt = "mm-gsd-noopt", broken = "mm-gsd-broken";
  const marker = "FAKE-ENTRY-RAN";
  const display = "Fake Pack";
  mkdirSync(join(root, fake, "scripts"), { recursive: true });
  writeFileSync(join(root, fake, "SKILL.md"), skill({ name: fake, description: '"演示包(双引号描述)"', entry: fakeEntry, optional: "true", display, aliases: "[fk, version]" }));
  writeFileSync(join(root, fake, fakeEntry), 'console.log("' + marker + '");\nprocess.exit(7);\n');
  mkdirSync(join(root, plain, "scripts"), { recursive: true });
  writeFileSync(join(root, plain, "SKILL.md"), skill({ name: plain, description: "没有 entry 的目录" }));
  mkdirSync(join(root, noopt, "scripts"), { recursive: true });
  writeFileSync(join(root, noopt, "SKILL.md"), skill({ name: noopt, description: "有 entry 没 optional", entry: "scripts/nk.mjs", aliases: '["nk"]' }));
  writeFileSync(join(root, noopt, "scripts", "nk.mjs"), "");
  mkdirSync(join(root, broken, "scripts"), { recursive: true });
  writeFileSync(join(root, broken, "SKILL.md"), skill({ name: broken, description: "入口缺失", entry: brokenEntry }));
  mkdirSync(join(plainRoot, plain, "scripts"), { recursive: true });
  writeFileSync(join(plainRoot, plain, "SKILL.md"), skill({ name: plain, description: "没有 entry 的目录" }));
  return { root, plainRoot, fake, plain, noopt, broken, marker, fakeEntry, brokenEntry, display };
}
