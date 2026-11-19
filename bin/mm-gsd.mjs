#!/usr/bin/env node
// mm-gsd — 安装器 / 入口
//
//   npx mm-gsd-core                 安装(等价于 npx mm-gsd-core install)
//   npx mm-gsd-core install         同上
//   npx mm-gsd-core install --local 装到当前项目 ./.agents/skills/
//   npx mm-gsd-core install --hooks 顺带装宿主 hook(危险 git 拦截 + 工具遥测)
//   npx mm-gsd-core doctor          体检宿主环境与已装状态(只读)
//   npx mm-gsd-core check [--plan]  跑状态检查器(转发)
//   npx mm-gsd-core update          先对齐 registry 上的最新版,再机械覆盖:整删重拷技能 + 无条件刷新自己的卡
//   npx mm-gsd-core --help
//
// 零依赖,跨平台。

import { readFileSync, readdirSync, existsSync, cpSync, mkdirSync, rmSync, lstatSync, writeFileSync, readFileSync as rf, symlinkSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir, tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { discoverPacks, resolvePack, resolveEntry, skillsRootOr } from "../skills/mm-gsd-loop/references/packs.mjs";
import { cmpVersion, pickCoverAction, pickUpdateAction } from "../skills/mm-gsd-loop/references/update-resolve.mjs";

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

const SKILL_NAMES = (src = SKILLS_SRC) => readdirSync(src).filter((d) => d.startsWith("mm-gsd-"));

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
      --hooks                 顺带装宿主 hook(危险 git 拦截 + 工具遥测,环境级)
      --yes                   不问,全默认
      --uninstall             移除已装的技能
      --home <dir>            覆盖家目录(测试用;Windows 上 HOME 环境变量不生效,必须用这个)
  ${C.b}doctor${C.x}             体检:宿主环境、已装状态、hooks(只读,不改任何东西)
  ${C.b}check${C.x} [args]       跑状态检查器(转发 --plan / --plan-check / --phases / --worktrees / --stats / --stats --tools / --templates)
  ${C.b}check --plan-check${C.x} <PLAN>  显式校验一份计划:现在能不能开工(退出码 0 = 能)
  ${C.b}update${C.x}             先对齐 registry 上的最新版,再机械覆盖:技能整删重拷、宿主卡无条件刷新、守卫/工具遥测脚本刷新
      --next                 跟预发布通道(next)而不是正式通道(latest)
      --local                 更新当前项目的 ./.agents/skills/(跳过宿主卡)
      --dir <path>            更新指定目录(跳过宿主卡)
      --home <dir>            覆盖家目录(测试用)
  ${C.b}web${C.x}              过程看板:起本地服务(localhost)实时渲染各 phase/REQ/批注(只读+批注)
      --port <n>             端口(默认 4620)
      --add <dir>            把目录追加进看板项目名单(多项目聚合;启动时 cwd 自动注册,端口被占则注册后让位退出)
  ${C.b}--version${C.x}           打印版本号
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
  // 备份根:<home>/.agents/backups/ —— 备份不再落在 skills 目录里:它以 mm-gsd- 开头,
  // 会被宿主注册成第二个技能(走查摩擦 9)。移位不是取消备份:原件语义保持。
  const bakRoot = join(HOME, ".agents", "backups");
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const backupTo = (srcDir, label) => {
    try { mkdirSync(bakRoot, { recursive: true }); cpSync(srcDir, join(bakRoot, `${label}-${ts}`), { recursive: true }); return true; }
    catch { return false; }
  };
  if (!uninstall) {
    // 旧版 install 落在 skills 目录里的就地备份:迁移到 backups 后删除
    let legacy = [];
    try { legacy = readdirSync(target).filter((e) => e.endsWith(".bak-mmgsd")); } catch {}
    for (const e of legacy) {
      if (backupTo(join(target, e), e.replace(/\.bak-mmgsd$/, ""))) {
        rmSync(join(target, e), { recursive: true, force: true });
        log(`  ${C.d}迁移旧备份 ${e} → ${bakRoot}${C.x}`);
      }
    }
  }
  for (const n of names) {
    const dst = join(target, n);
    if (uninstall) {
      if (existsSync(dst)) { rmSync(dst, { recursive: true, force: true }); log(`  ${C.r}-${C.x} ${n}`); done++; }
      else skipped++;
      continue;
    }
    // 已有同名目录:内容相同 → 跳过;内容不同 → 原内容备份到 backups 后覆盖
    if (existsSync(dst) && !lstatSync(dst).isSymbolicLink()) {
      const same = sameContent(dst, join(SKILLS_SRC, n));
      if (same) {
        log(`  ${C.d}=${C.x} ${n}(已存在且完整,跳过)`);
        manifest.skills[n] = digest(join(SKILLS_SRC, n));
        skipped++;
        continue;
      }
      if (backupTo(dst, n)) warn(`${n}: 目标已存在且内容不同 —— 原内容已备份到 ${join(bakRoot, `${n}-${ts}`)}`);
      else warn(`${n}: 目标已存在且内容不同 —— 备份失败,直接覆盖`);
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
    log(`\n  ${C.d}要装宿主 hook(危险 git 拦截 + 工具遥测,环境级),加 --hooks${C.x}`);
  }

  head("接下来");
  log(`  1. 检查:node ${join(target, "mm-gsd-loop", "scripts", "gsd-state-check.mjs")} --check`);
  log('  2. 在项目里冷启动:同上命令加 --init "<项目目标>"');
  log(`  3. 宿主体检:node ${join(target, "mm-gsd-loop", "scripts", "mm-gsd-install.mjs")} --check`);
  log("");
  return 0;
}

// ---- npm 通道:update 要问 registry「最新发布的是哪一版」 ----
// Windows 上必须 npm.cmd + shell:true(cmd.exe 才能跑 .cmd);这是本仓既有先例
// (tools/release-flow.mjs 从 npm 取包就是这么干的)。
function npmBin() { return process.platform === "win32" ? "npm.cmd" : "npm"; }

function npmRun(args, timeout = 120000) {
  return execFileSync(npmBin(), args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** registry 上该通道发布的是哪一版;问不到(离线/没装 npm/包名错)就 null */
function publishedVersion(channel) {
  try {
    const out = String(npmRun(["view", NAME, "dist-tags." + channel], 60000) ?? "").trim().replace(/^["']|["']$/g, "");
    return /^\d+\.\d+\.\d+/.test(out) ? out : null;
  } catch { return null; }
}

/** 从 npm 把指定版本取到临时目录 —— 返回 {dir, sb},sb 由调用方用完清掉 */
function fetchPublished(version) {
  const sb = join(tmpdir(), "mm-gsd-update-" + version.replace(/[^\w.-]/g, "_"));
  rmSync(sb, { recursive: true, force: true });
  npmRun(["install", "--prefix", sb, "--no-audit", "--no-fund", `${NAME}@${version}`], 300000);
  const dir = join(sb, "node_modules", NAME);
  if (!existsSync(join(dir, "skills"))) throw new Error(`取到的 ${NAME}@${version} 里没有 skills/ —— 包不完整`);
  return { dir, sb };
}

// ---- update:先对齐 registry 上的最新版,再机械覆盖 ----
//
// 语义分两步:①问 registry「最新发布的是哪一版」(默认 latest 通道,加 --next 跟预发布通道);
// ②把技能整删重拷 —— 旧文件不残留,这就是「覆盖」的定义。
//
// 为什么不能只做②:update 跑的是**当前这一份包**。全局装着旧版的机器敲 update,
// 盖回去的还是旧版 —— 用户用得最多的指令,版本却永远不动(实测:别的机器上指向 0.7.3)。
// 问不到 registry(离线/没装 npm)→ 照旧覆盖当前这份,并把「问不到」说出来;
// registry 上比当前旧 → 不降级,照旧覆盖当前这份。
//
// 与 install 的分工:install 是首次安装(尊重已有内容、会备份、可交互);update 是更新,
// 语义就是「用最新那份盖掉装出去的那份」—— 不问、不比对、不保留用户改动。
// 卡与守卫脚本是生成物,不是用户数据;真有自定义需求的用户应该改 SKILL.md 而不是卡。
async function update() {
  const local = has("--local");
  const target = has("--dir") ? resolve(val("--dir")) : local ? join(process.cwd(), ".agents", "skills") : join(HOME, ".agents", "skills");
  const channel = has("--next") ? "next" : "latest";
  head("update —— 机械覆盖更新");

  // 0) 先问 registry:最新发布的是哪一版
  const published = publishedVersion(channel);
  const action = pickUpdateAction(VERSION, published);
  let skillsSrc = SKILLS_SRC, version = VERSION, source = SOURCE, tmp = null;
  if (action === "upgrade") {
    ok(`registry 上的 ${channel} 是 ${published},比当前包新(${VERSION})—— 先取新版再覆盖`);
    try {
      const got = fetchPublished(published);
      tmp = got.sb;
      skillsSrc = join(got.dir, "skills");
      version = published;
      source = `npm:${NAME}@${published}`;
    } catch (e) {
      bad("取新版失败:" + String(e?.message || e));
      warn(`退回当前包这份(${VERSION})—— 覆盖照做,版本没升`);
    }
  } else if (action === "current") {
    ok(`当前包已是 registry 上的最新(${channel} ${published})`);
  } else if (action === "older") {
    warn(`registry 上的 ${channel} 是 ${published},比当前包旧(${VERSION})—— 不降级,按当前这份覆盖`);
  } else {
    warn(`问不到 registry 上的 ${channel}(离线?)—— 按当前包这份覆盖(${VERSION})`);
  }
  log(`  目标:${target}(来源 ${source} v${version})`);

  // 覆盖前先看已装的是哪一版 —— 已装的比要盖的还新就不降级。
  // 实测过的现场:全局命令是 0.7.0、主仓却是 0.7.9,旧 update 会把主仓盖回 0.7.0
  // (看板包直接没了)。用户说的「版本不动/倒退」就是这一类。
  const installed = (() => {
    try { return JSON.parse(readFileSync(join(target, MANIFEST), "utf8")).version || null; } catch { return null; }
  })();
  if (pickCoverAction(installed, version) === "skip") {
    warn(`已装的是 ${installed},比要盖的 ${version} 新 —— 不降级,原样保留`);
    ok(`当前这份 mm-gsd(${VERSION})比已装的旧 —— 先刷新 mm-gsd 本身(npm i -g mm-gsd-core),再跑一次 update`);
    return 0;
  }

  try {
    const names = SKILL_NAMES(skillsSrc);
    if (!names.length) { bad("包里没有 skills/mm-gsd-* —— 打包不完整"); return 1; }

    // 1) 技能:整目录删除重拷 —— 旧文件不残留,这就是「覆盖」的定义
    mkdirSync(target, { recursive: true });
    const manifest = { version, source, installedAt: new Date().toISOString(), skills: {} };
    for (const n of names) {
      const dst = join(target, n);
      rmSync(dst, { recursive: true, force: true });
      cpSync(join(skillsSrc, n), dst, { recursive: true });
      manifest.skills[n] = digest(join(skillsSrc, n));
      log(`  ${C.g}+${C.x} ${n}`);
    }
    writeFileSync(join(target, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
    ok(`${names.length} 个技能已覆盖`);

    // 2) 宿主指针卡:无条件覆盖 mm-gsd 自己的卡。卡是生成物(读 SKILL.md 现拼),不比对指纹。
    //    宿主清单用包内 HOSTS(单一真相源);目录存在才写,不硬造目录结构。--local/--dir 只更新技能。
    let cards = 0;
    if (!local && !has("--dir")) {
      const routing = await import(pathToFileURL(join(skillsSrc, "mm-gsd-loop", "references", "agent-routing.mjs")).href);
      const routeCmd = `node "${join(target, "mm-gsd-loop", "scripts", "gsd-state-check.mjs")}"`;
      const cardFiles = names.map((n) => n + ".md").concat(["mm-gsd-plan-reviewer.md"]);
      const bodies = new Map(names.map((n) => [n + ".md", routing.pointerCard({ skill: n, skillPath: join(target, n, "SKILL.md"), routeCmd })]));
      bodies.set("mm-gsd-plan-reviewer.md", routing.reviewerCard({ routeCmd }));
      for (const [, v] of Object.entries(routing.HOSTS)) {
        if (!v.agents) continue;
        const dir = join(HOME, v.agents);
        if (!existsSync(dir)) continue;
        for (const f of cardFiles) { writeFileSync(join(dir, f), bodies.get(f)); cards++; }
        log(`  ${C.g}+${C.x} 宿主卡 ${cardFiles.length} 张 → ${dir}`);
      }
      if (!cards) warn("没有探测到任何宿主 agent 卡目录 —— 卡未更新(装卡用 install)");
    }

    // 2b) 宿主技能链接:只补缺失的。
    //     链接是指向主仓的 junction,内容会跟着主仓变;但**新增的技能名**不会自己长出来 ——
    //     0.7.6 才有的看板包,老机器上装过一遍就再也不会被链进宿主目录,用户更新完还是看不到它。
    if (!local && !has("--dir")) {
      const routing = await import(pathToFileURL(join(skillsSrc, "mm-gsd-loop", "references", "agent-routing.mjs")).href);
      for (const [hname, v] of Object.entries(routing.HOSTS)) {
        if (!v.skills || v.skills === ".agents/skills") continue;
        if (!existsSync(join(HOME, v.dir))) continue;   // 只动真的装了本宿主的机器,别给没用的宿主凭空造目录
        const dstRoot = join(HOME, v.skills);
        let made = 0;
        for (const n of names) {
          const link = join(dstRoot, n);
          let there = false;
          try { const st = lstatSync(link); there = st.isSymbolicLink() || st.isDirectory(); } catch {}
          if (there) continue;
          try {
            mkdirSync(dstRoot, { recursive: true });
            try { symlinkSync(join(target, n), link, "junction"); }
            catch { mkdirSync(link, { recursive: true }); copyFileSync(join(target, n, "SKILL.md"), join(link, "SKILL.md")); }
            made++;
          } catch (e) { warn(`宿主 ${hname} 链接 ${n} 失败:${e.message}`); }
        }
        if (made) log(`  ${C.g}+${C.x} 宿主 ${hname} 补链 ${made} 个技能 → ${dstRoot}`);
      }
    }

    // 3) 守卫/遥测脚本:公共区文件刷新(各宿主 hook 配置指向它,配置本身不动 —— 那是 install --hooks 的活)
    if (!local && !has("--dir")) {
      const hooksDir = join(HOME, ".agents", "hooks");
      mkdirSync(hooksDir, { recursive: true });
      for (const f of ["guard-dangerous-git.mjs", "mm-gsd-tool-telemetry.mjs"]) {
        const src = join(skillsSrc, "mm-gsd-loop", "hooks", f);
        if (existsSync(src)) cpSync(src, join(hooksDir, f));
      }
      log(`  ${C.g}+${C.x} 守卫/工具遥测脚本已刷新 → ${hooksDir}(hook 配置不动;要接线用 install --hooks)`);
    }

    head("完成");
    log(`  版本 ${version}(${source});宿主卡 ${cards} 张;下次 doctor 会显示与包一致。`);
    return 0;
  } finally {
    if (tmp) { try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
  }
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
      // 装的不一定比当前包旧:update 现在会从 registry 取新版,装的可能更新。
      // 说反了就是假话 —— 「装的是旧版」只在真的旧的时候才说。
      if (cmpVersion(mf.version ?? "0.0.0", VERSION) > 0)
        warn(`${drift.join(", ")} 与当前包内容不同 —— 装的是更新的 ${mf.version}(当前包 ${VERSION}),正常`);
      else
        warn(`${drift.join(", ")} 与当前包内容不同 —— 装的是旧版,跑一次 update 机械覆盖`);
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
  let code = 0;
  if (existsSync(inst)) {
    head("宿主环境");
    try { log(execFileSync(process.execPath, [inst, "--check"], { encoding: "utf8", stdio: "pipe" })); }
    catch (e) {
      log(String(e.stdout || "") + String(e.stderr || ""));
      // 预审 F6:子进程判非 0(如指针卡过期)必须传出来 —— 吞掉它,外部 `doctor && …` 的语义就是假的
      code = e.status ?? 1;
    }
  } else {
    warn("全局技能目录里没有 mm-gsd —— 跑一次 `npx mm-gsd-core install`");
  }
  log("");
  return code;
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
if (cmd === "update") process.exit(await update());
// 可选包分派(28-01):包自己声明自己 —— 目录 mm-gsd-* + SKILL.md frontmatter entry:。
// 命中包则入口被 spawn 且退出码原样传出;入口缺失一句人话(不抛栈);没命中落回旧逻辑(旧 web 分支/内置命令表)。
{
  const packs = discoverPacks(skillsRootOr(join(PKG_ROOT, "skills"), process.env));
  const pack = resolvePack(packs, cmd);
  if (pack) {
    const en = resolveEntry(pack);
    if (en.missing) { bad(en.message); process.exit(1); }
    process.exit(spawnSync(process.execPath, [en.entryPath, ...argv.slice(1)], { stdio: "inherit" }).status ?? 0);
  }
}
if (cmd === "check") process.exit(check());
if (["stage", "summary", "commit", "wave-check"].includes(cmd)) {
  // 执行期工具转发(skills/mm-gsd-exec/scripts/,R-13:使用方手上只有 skills/)。
  // spawnSync 不用 execFileSync:后者把子进程非零退出变调用栈(report 转发先例)。
  // existsSync 守卫:14-02 落地后 14-03 前,commit/wave-check 目标还不存在 —— 缺脚本给人话,不抛栈。
  const tp = join(PKG_ROOT, "skills", "mm-gsd-exec", "scripts", `mm-gsd-${cmd}.mjs`);
  if (!existsSync(tp)) { bad(`包里缺少 mm-gsd-${cmd}.mjs`); process.exit(1); }
  const r = spawnSync(process.execPath, [tp, ...argv.slice(1)], { stdio: "inherit" });
  if (r.error) { bad(`mm-gsd-${cmd} 跑不起来:` + r.error.message); process.exit(1); }
  process.exit(r.status ?? 1);
}
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
if (cmd === "--version" || cmd === "-v" || cmd === "version") {
  log(`mm-gsd ${JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")).version}`);
  process.exit(0);
}
bad(`未知命令 ${cmd}`);
usage();
process.exit(1);
