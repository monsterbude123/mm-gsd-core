#!/usr/bin/env node
// mm-gsd — 安装器 / 入口
//
//   npx mm-gsd-core                 安装(等价于 npx mm-gsd-core install)
//   npx mm-gsd-core install         同上
//   npx mm-gsd-core install --local 装到当前项目 ./.agents/skills/
//   npx mm-gsd-core install --hooks 顺带装宿主 hook(危险 git 拦截)
//   npx mm-gsd-core doctor          体检宿主环境与已装状态(只读)
//   npx mm-gsd-core check [--plan]  跑状态检查器(转发)
//   npx mm-gsd-core --help
//
// 零依赖,跨平台。

import { readFileSync, readdirSync, existsSync, cpSync, mkdirSync, rmSync, lstatSync, writeFileSync, readFileSync as rf } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_SRC = join(PKG_ROOT, "skills");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

// --home:测试用。Windows 上 os.homedir() 读 USERPROFILE 而不读 HOME,
// 设 HOME=... 拦不住它,会把东西装进真家目录。
const HOME = has("--home") ? resolve(val("--home")) : homedir();

// 版本清单:装出来的技能要能追溯到具体版本与来源
const MANIFEST = ".mm-gsd-install.json";
const PKG = readFileSync(join(PKG_ROOT, "package.json"), "utf8");
const VERSION = JSON.parse(PKG).version ?? "0.0.0";
const NAME = JSON.parse(PKG).name ?? "mm-gsd-core";
// 仓库里跑 ≠ 来自 npm。只有 npx 装出来的副本才算 npm 来源 —— 判据是
// 旁边没有 node_modules(仓库自带的副本靠 --from-repo 显式声明)。
// 分错会让"装回本机"验不出自己装的是哪一份,版本追溯就成了摆设(T-07)。
const FROM_NPM = !has("--from-repo") && !existsSync(join(PKG_ROOT, "node_modules")) && !existsSync(join(PKG_ROOT, "tools", "mmc.mjs"));
const SOURCE = FROM_NPM ? `npm:${NAME}@${VERSION}` : `repo:${PKG_ROOT}`;

/** 目录内容的指纹 —— 用来判断"装的和现在仓库里的是不是同一份" */
function digest(dir) {
  const walk = (d, base = "") => {
    const out = [];
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const rel = base ? base + "/" + e.name : e.name;
      if (e.isDirectory()) out.push(...walk(p, rel));
      else out.push(rel);
    }
    return out.sort();
  };
  try {
    const h = createHash("sha1");
    for (const rel of walk(dir)) h.update(rel).update(rf(join(dir, rel)));
    return h.digest("hex").slice(0, 12);
  } catch { return "?"; }
}

const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[90m", b: "\x1b[1m", x: "\x1b[0m" };
const log = (s = "") => console.log(s);
const ok = (s) => log(`${C.g}✓${C.x} ${s}`);
const warn = (s) => log(`${C.y}!${C.x} ${s}`);
const bad = (s) => log(`${C.r}✗${C.x} ${s}`);
const head = (s) => log(`\n${C.b}${s}${C.x}`);

const SKILL_NAMES = () => readdirSync(SKILLS_SRC).filter((d) => d.startsWith("mm-gsd-"));

// 目录内容是否完全一致 —— 比顶层条目数靠谱得多。
// 顶层条目数相同的两个目录内容可能完全不同(改了一个文件,数量不变)。
function sameContent(a, b) {
  const walk = (dir, base = "") => {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const rel = base ? base + "/" + e.name : e.name;
      if (e.isDirectory()) out.push(...walk(p, rel));
      else out.push(rel + ":" + createHash("sha1").update(rf(p)).digest("hex").slice(0, 12));
    }
    return out.sort();
  };
  try {
    const x = walk(a), y = walk(b);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  } catch { return false; }
}

function usage() {
  log(`
${C.b}mm-gsd${C.x} — 极简 GSD 核心安装器

  ${C.b}install${C.x}            把技能装到 ~/.agents/skills/(默认)
      --local                 装到当前项目的 ./.agents/skills/
      --dir <path>            装到指定目录
      --hooks                 顺带装宿主 hook(危险 git 拦截,环境级)
      --yes                   不问,全默认
      --uninstall             移除已装的技能
      --home <dir>            覆盖家目录(测试用;Windows 上 HOME 环境变量不生效,必须用这个)
  ${C.b}doctor${C.x}             体检:宿主环境、已装状态、hooks(只读,不改任何东西)
  ${C.b}check${C.x} [args]       跑状态检查器(转发 --plan / --phases / --worktrees / --stats / --templates)
  ${C.b}--help${C.x}

${C.d}装完就能用:在项目里让 agent 调用 mm-gsd-discuss / plan / exec / verify / loop。${C.x}
`);
}

// ---- install ----
function install() {
  const local = has("--local");
  const target = has("--dir") ? resolve(val("--dir")) : local ? join(process.cwd(), ".agents", "skills") : join(HOME, ".agents", "skills");
  const uninstall = has("--uninstall");

  head(uninstall ? "卸载 mm-gsd 技能" : "安装 mm-gsd 技能");
  log(`  目标:${target}`);

  const names = SKILL_NAMES();
  if (!names.length) { bad("包里没有 skills/mm-gsd-* —— 打包不完整"); return 1; }

  mkdirSync(target, { recursive: true });
  let done = 0, skipped = 0;
  const manifest = { version: VERSION, source: SOURCE, installedAt: new Date().toISOString(), skills: {} };
  for (const n of names) {
    const dst = join(target, n);
    if (uninstall) {
      if (existsSync(dst)) { rmSync(dst, { recursive: true, force: true }); log(`  ${C.r}-${C.x} ${n}`); done++; }
      else skipped++;
      continue;
    }
    // 已有同名目录且不是符号链接 → 不覆盖,那是用户自己改过的
    if (existsSync(dst) && !lstatSync(dst).isSymbolicLink()) {
      const same = sameContent(dst, join(SKILLS_SRC, n));
      if (same) {
        log(`  ${C.d}=${C.x} ${n}(已存在且完整,跳过)`);
        manifest.skills[n] = digest(join(SKILLS_SRC, n));
        skipped++;
        continue;
      }
      warn(`${n}: 目标已存在且内容不同 —— 不覆盖。备份到 ${n}.bak-mmgsd`);
      try { rmSync(dst + ".bak-mmgsd", { recursive: true, force: true }); cpSync(dst, dst + ".bak-mmgsd", { recursive: true }); } catch {}
    }
    rmSync(dst, { recursive: true, force: true });
    cpSync(join(SKILLS_SRC, n), dst, { recursive: true });
    manifest.skills[n] = digest(join(SKILLS_SRC, n));
    log(`  ${C.g}+${C.x} ${n}`);
    done++;
  }
  ok(uninstall ? `已移除 ${done} 个技能` : `已安装 ${done} 个技能` + (skipped ? `(${skipped} 个跳过)` : ""));

  if (uninstall) {
    try { rmSync(join(target, MANIFEST)); } catch {}
    return 0;
  }

  // 版本清单 —— 装出来的东西必须能被追溯到某个版本,否则"我装的是哪一版"永远说不清
  writeFileSync(join(target, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
  log(`  ${C.d}版本清单:${target}/${MANIFEST}(version ${VERSION} · ${SOURCE})${C.x}`);

  if (has("--hooks")) {
    const inst = join(target, "mm-gsd-loop", "scripts", "mm-gsd-install.mjs");
    if (!existsSync(inst)) { bad("找不到 mm-gsd-install.mjs,跳过 hooks"); return 1; }
    head("安装宿主 hook");
    try {
      const out = execFileSync(process.execPath, [inst, "--yes"], { encoding: "utf8", stdio: "pipe" });
      log(out);
    } catch (e) { bad("hook 安装失败:\n" + String(e.stdout || "") + String(e.stderr || e.message)); }
  } else {
    log(`\n  ${C.d}要装危险 git 拦截(host hook,环境级),加 --hooks${C.x}`);
  }

  head("接下来");
  log(`  1. 检查:node ${join(target, "mm-gsd-loop", "scripts", "gsd-state-check.mjs")} --check`);
  log('  2. 在项目里冷启动:同上命令加 --init "<项目目标>"');
  log(`  3. 宿主体检:node ${join(target, "mm-gsd-loop", "scripts", "mm-gsd-install.mjs")} --check`);
  log("");
  return 0;
}

// ---- doctor ----
function doctor() {
  head("mm-gsd 体检(只读)");
  const names = SKILL_NAMES();
  log(`  包内技能:${names.length} 个(${names.join(", ")})`);

  const global = join(HOME, ".agents", "skills");

  // 版本清单:装的是哪一版、来自哪、跟现在这份包差多少
  const mfPath = join(global, MANIFEST);
  if (existsSync(mfPath)) {
    let mf = {};
    try { mf = JSON.parse(readFileSync(mfPath, "utf8")); } catch {}
    head("已装版本");
    log(`  版本:   ${C.b}${mf.version ?? "?"}${C.x}`);
    log(`  来源:   ${mf.source ?? "?"}`);
    log(`  装于:   ${mf.installedAt ?? "?"}`);
    const drift = names.filter((n) => mf.skills?.[n] && mf.skills[n] !== digest(join(SKILLS_SRC, n)));
    if (drift.length) {
      warn(`${drift.join(", ")} 与当前包内容不同 —— 装的是旧版,跑一次 install 更新`);
    } else {
      ok("已装内容与当前包一致");
    }
  } else {
    warn(`没有版本清单(${MANIFEST})—— 这份是手工拷进去的,版本不可追溯`);
  }

  head("技能安装状态");
  for (const n of names) {
    const p = join(global, n);
    log(`  ${existsSync(p) ? C.g + "已装" + C.x : C.y + "未装" + C.x}  ${global}/${n}`);
  }

  const inst = join(global, "mm-gsd-loop", "scripts", "mm-gsd-install.mjs");
  if (existsSync(inst)) {
    head("宿主环境");
    try { log(execFileSync(process.execPath, [inst, "--check"], { encoding: "utf8", stdio: "pipe" })); }
    catch (e) { log(String(e.stdout || "") + String(e.stderr || "")); }
  } else {
    warn("全局技能目录里没有 mm-gsd —— 跑一次 `npx mm-gsd-core install`");
  }
  log("");
  return 0;
}

// ---- check(转发)----
function check() {
  const inst = join(PKG_ROOT, "skills", "mm-gsd-loop", "scripts", "gsd-state-check.mjs");
  if (!existsSync(inst)) { bad("包里缺少 gsd-state-check.mjs"); return 1; }
  const rest = argv.slice(argv.indexOf("check") + 1);
  try {
    execFileSync(process.execPath, [inst, ...rest], { stdio: "inherit" });
    return 0;
  } catch (e) { return e.status ?? 1; }
}

const cmd = argv[0];
if (!cmd || cmd === "install") process.exit(install());
if (cmd === "doctor" || cmd === "--check" && argv.length === 1) process.exit(doctor());
if (cmd === "check") process.exit(check());
if (cmd === "report") {
  // 转发给随包分发的报修脚本。使用方手上只有 skills/,没有 tools/,
  // 所以逻辑必须住在 skills/mm-gsd-loop/scripts/ 里(规则 R-13)。
  const rp = join(PKG_ROOT, "skills", "mm-gsd-loop", "scripts", "mm-gsd-report.mjs");
  if (!existsSync(rp)) { bad("包里缺少 mm-gsd-report.mjs —— 打包不完整"); process.exit(1); }
  // 用 spawnSync 不用 execFileSync:后者在子进程非零退出时抛异常,
  // 会把「报修入口正确地拒绝了」变成一段调用栈(cwd: 253 踩过同类的坑)。
  const r = spawnSync(process.execPath, [rp, ...argv.slice(1)], { stdio: "inherit" });
  if (r.error) { bad("报修入口跑不起来:" + r.error.message); process.exit(1); }
  process.exit(r.status ?? 1);
}
if (cmd === "--help" || cmd === "-h" || cmd === "help") { usage(); process.exit(0); }
bad(`未知命令 ${cmd}`);
usage();
process.exit(1);
