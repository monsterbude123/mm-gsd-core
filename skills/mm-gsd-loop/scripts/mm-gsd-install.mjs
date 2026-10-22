#!/usr/bin/env node
// mm-gsd-install —— 多宿主引导安装/体检
//
// 宿主无关是 mm-gsd 的原则:技能本体是纯文本 SKILL.md,检查器是纯 node 脚本。
// 本脚本只做两件宿主相关的事:
//   1) 技能分发 —— 主仓 ~/.agents/skills/,向各宿主 skills 目录建符号链接(junction)
//   2) 危险 git 拦截 —— 按各宿主的 hooks 格式分别安装
// 不做冷启动(那是 mm-gsd-discuss 的职责,不重复造第二条路径)。
//
// 用法:
//   node mm-gsd-install.mjs              # 交互模式
//   node mm-gsd-install.mjs --yes        # 全默认(宿主已探测到的自动处理)
//   node mm-gsd-install.mjs --check      # 只体检,不改任何东西
//   node mm-gsd-install.mjs --hosts claude,zcode   # 只处理指定宿主
//   node mm-gsd-install.mjs --skills-only / --hooks-only
//   node mm-gsd-install.mjs --home <dir> # 覆盖 home(测试用,不碰真目录)
//
// 零依赖、跨平台。所有修改前自动备份(只备份最初原件)。

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, symlinkSync, lstatSync, readlinkSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { HOSTS, pointerCard } from "../references/agent-routing.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const CHECK_ONLY = has("--check");
const AUTO_YES = has("--yes");
const SKILLS_ONLY = has("--skills-only");
const HOOKS_ONLY = has("--hooks-only");
const AGENTS_ONLY = has("--agents-only");
const HOME = val("--home", homedir());
const H = (...p) => join(HOME, ...p);

// ---- 技能清单(主仓位置即 ~/.agents/skills/)----
// 从**本脚本的同级目录**派生,不写死:写死过一次,结果新增的 mm-gsd-diagnose
// 永远不会被链接到宿主的 skills 目录 —— 没人发现,因为少一个技能不报错。
const MASTER = H(".agents", "skills");
const SKILLSDIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SKILLS = (() => {
  // `.bak-mmgsd` 是本安装器自己留的旧版备份,名字同样以 mm-gsd- 开头 ——
  // 只按前缀挑,备份目录会被当成技能:真机实测发过 12 张卡(6 个真技能 + 6 个备份)。
  try { return readdirSync(SKILLSDIR).filter((d) => d.startsWith("mm-gsd-") && !d.endsWith(".bak-mmgsd")).sort(); }
  catch { return []; }
})();
const GUARD_SRC = join(MASTER, "mm-gsd-loop", "hooks", "guard-dangerous-git.mjs");
const PRECOMMIT_SRC = join(MASTER, "mm-gsd-loop", "hooks", "pre-commit");

// ---- 宿主适配表 ----
// 住在 references/agent-routing.mjs:安装与路由提示都要它,一个 owner 才不会分叉。
// link: 是否需要建 skills 软链;hook: hooks 格式;agents: 该宿主的 agent 卡目录(null = 没探到约定)
// 发现方式:目录探测。dist 说明为什么这样处理。

const wantHosts = (val("--hosts", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const present = Object.entries(HOSTS).filter(([k, v]) => existsSync(H(v.dir)));
const targets = present.filter(([k]) => !wantHosts.length || wantHosts.includes(k));
if (present.length === 0) console.log("(未探测到任何已知宿主 —— 技能仍可由任何支持 SKILL.md 的宿主直接引用主仓)");

const changes = [], warns = [], oks = [], skips = [];
function sh(cmd) { try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim(); } catch { return ""; } }
async function confirm(q, dflt) {
  if (AUTO_YES) return dflt;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => rl.question(`${q} ${dflt ? "[Y/n]" : "[y/N]"} `, (x) => { rl.close(); r(x.trim().toLowerCase()); }));
  return a === "" ? dflt : a === "y" || a === "yes";
}
function readJson(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
function writeJsonSafe(p, obj) {
  const bak = p + ".bak-mmgsd";
  if (existsSync(p) && !existsSync(bak)) copyFileSync(p, bak); // 只备份最初原件
  writeFileSync(p, JSON.stringify(obj, null, 2));
}

// ---------- 体检 ----------
const projDir = resolve(val("--dir", process.cwd()));
const isGit = existsSync(join(projDir, ".git"));
let hooksPath = ""; try { hooksPath = sh("git -C \"" + projDir + "\" config --get core.hooksPath"); } catch {}
const hasHusky = existsSync(join(projDir, ".husky"));
const hasState = existsSync(join(projDir, ".planning", "STATE.md"));
let stateCheck = null;
if (hasState) {
  try { stateCheck = JSON.parse(sh("cd \"" + projDir + "\" && node \"" + join(MASTER, "mm-gsd-loop", "scripts", "gsd-state-check.mjs") + "\" --json")); } catch {}
}

console.log("\n=== mm-gsd 体检 ===");
console.log("项目:      " + projDir);
console.log("git:       " + (isGit ? "仓库" : "非仓库") + (hooksPath ? "  hooksPath=" + hooksPath : "") + (hasHusky ? "  (husky)" : ""));
console.log(".planning/ " + (hasState ? "有 STATE.md" : "无(首次跑 mm-gsd-loop 时由 discuss 冷启动)"));
if (stateCheck) console.log("状态机:    声明=" + (stateCheck.state?.declared || "(空)") + " 推导=" + (stateCheck.derived || "-") + " 错误=" + (stateCheck.errors?.length || 0) + " 告警=" + (stateCheck.warnings?.length || 0));
console.log("主仓技能:  " + MASTER + "(" + SKILLS.filter((s) => existsSync(join(MASTER, s))).length + "/" + SKILLS.length + " 就位)");
console.log("宿主:      " + (present.map(([k]) => k).join(", ") || "无"));

for (const [name, v] of targets) {
  if (!v.skills || v.skills === ".agents/skills") { oks.push(name + ":技能主仓原生(" + v.dist + ")"); continue; }
  const dstRoot = H(v.skills);
  const inMaster = SKILLS.filter((s) => existsSync(join(MASTER, s)));
  const linked = [], notLinked = [];
  for (const s of inMaster) {
    const link = join(dstRoot, s);
    try { const st = lstatSync(link); (st.isSymbolicLink() || st.isDirectory() ? linked : notLinked).push(s); } catch { notLinked.push(s); }
  }
  console.log("  " + name.padEnd(8) + "已链接 " + linked.length + "/" + inMaster.length + (SKILLS.length < inMaster.length ? " (主仓共 " + SKILLS.length + " 个技能)" : ""));
}

if (CHECK_ONLY) {
  console.log("\n(--check:仅体检,未做任何修改)");
  if (stateCheck?.errors?.length) { console.log("\n待修:"); for (const e of stateCheck.errors) console.log("  ✗ " + e.message + (e.fix ? "  → " + e.fix : "")); }
  process.exit(stateCheck?.errors?.length ? 1 : 0);
}

// ---------- 动作 1:技能软链分发 ----------
if (!HOOKS_ONLY && !AGENTS_ONLY) {
  for (const [name, v] of targets) {
    if (!v.skills || v.skills === ".agents/skills") continue;
    const dstRoot = H(v.skills);
    let made = 0, already = 0;
    for (const s of SKILLS) {
      const src = join(MASTER, s), link = join(dstRoot, s);
      if (!existsSync(src)) continue;
      let isLink = false;
      try { const st = lstatSync(link); isLink = st.isSymbolicLink() || st.isDirectory(); } catch {}
      if (isLink) { already++; continue; }
      try {
        mkdirSync(dstRoot, { recursive: true });
        try { symlinkSync(src, link, "junction"); } catch { copyFileSync(join(src, "SKILL.md"), join(dstRoot, s, "SKILL.md")); }
        made++;
      } catch (e) { warns.push(name + " 链接 " + s + " 失败:" + e.message); }
    }
    if (made > 0) changes.push(name + ":链接 " + made + " 个技能 → " + v.skills + (already ? "(" + already + " 个已存在)" : ""));
    else if (already > 0) oks.push(name + ":技能链接已齐全(" + already + ")");
  }
}

// ---------- 动作 2:危险 git 拦截(按宿主格式) ----------
if (!SKILLS_ONLY && !AGENTS_ONLY) {
  const guardDest = H(".agents", "hooks", "guard-dangerous-git.mjs"); // 脚本放公共区,各宿主配置指向它
  if (!existsSync(GUARD_SRC)) {
    warns.push("未找到 guard-dangerous-git.mjs(技能主仓不完整)——为避免装出指向不存在脚本的死配置,跳过所有 hooks 安装");
  } else {
    if (existsSync(guardDest)) oks.push("危险 git 守卫脚本已就位(" + guardDest + ")");
    else { mkdirSync(H(".agents", "hooks"), { recursive: true }); copyFileSync(GUARD_SRC, guardDest); changes.push("守卫脚本已放置 " + guardDest); }

    for (const [name, v] of targets) {
      if (!v.hook) { skips.push(name + " hooks:" + v.dist); continue; }
      const cfgPath = H(v.config);
      const cfg = cfgPath ? readJson(cfgPath) : null;
      const eventsMap = v.hook === "claude"
        ? (cfg?.hooks && typeof cfg.hooks === "object" && !Array.isArray(cfg.hooks) ? cfg.hooks : null)          // settings.json: hooks.PreToolUse
        : (cfg?.hooks?.events ?? null);                                                                            // zcode: hooks.events.PreToolUse
      const list = eventsMap?.PreToolUse;
      const installed = Array.isArray(list) && JSON.stringify(list).includes("guard-dangerous-git");
      if (installed) { oks.push(name + " hooks:危险 git 拦截已启用"); continue; }

      const want = await confirm(`给 ${name} 安装危险 git 拦截?(reset --hard / clean -f / stash drop / force push / 删分支 / 全量 checkout 会先被拦下并给出更安全的替代)`, true);
      if (!want) { skips.push(name + " hooks:未安装(破坏性 git 仍靠文本纪律)"); continue; }

      const nodeCmd = "node \"" + guardDest + "\"";
      if (v.hook === "claude") {
        if (!cfgPath || !cfg) { warns.push(name + ":读不到/解析不了 " + v.config + ",跳过(手动加 hooks 段)"); continue; }
        cfg.hooks = cfg.hooks ?? {};
        cfg.hooks.PreToolUse = Array.isArray(cfg.hooks.PreToolUse) ? cfg.hooks.PreToolUse : [];
        cfg.hooks.PreToolUse.push({ matcher: "Bash", hooks: [{ type: "command", command: nodeCmd }] });
        writeJsonSafe(cfgPath, cfg);
        changes.push(name + " hooks:已写入 " + v.config + " 的 PreToolUse(Bash)");
      } else if (v.hook === "zcode") {
        if (!cfgPath || !cfg) { warns.push(name + ":读不到/解析不了 " + v.config + ",跳过"); continue; }
        cfg.hooks = cfg.hooks ?? {};
        cfg.hooks.enabled = true;
        cfg.hooks.events = cfg.hooks.events ?? {};
        cfg.hooks.events.PreToolUse = Array.isArray(cfg.hooks.events.PreToolUse) ? cfg.hooks.events.PreToolUse : [];
        cfg.hooks.events.PreToolUse.push({ matcher: "Bash", hooks: [{ type: "command", command: nodeCmd, timeout: 10 }] });
        writeJsonSafe(cfgPath, cfg);
        changes.push(name + " hooks:已写入 " + v.config + " 的 hooks.events.PreToolUse(需 hooks.enabled=true)");
      }
    }
  }
}

// ---------- 动作 3:git pre-commit(可选保险,无现有 hooks 体系时) ----------
if (!HOOKS_ONLY && !AGENTS_ONLY && isGit) {
  if (hooksPath || hasHusky) skips.push("git pre-commit:检测到现有 hooks 体系(" + (hooksPath || ".husky") + "),不装(会顶掉现有门禁)");
  else if (await confirm("安装 git pre-commit 门禁?(仅多一层'坏工件不进 git 历史'的保险;检查项已被状态检查器覆盖;会占用 core.hooksPath)", false)) {
    try {
      const dstDir = join(projDir, ".githooks"); mkdirSync(dstDir, { recursive: true });
      const dst = join(dstDir, "pre-commit"); copyFileSync(PRECOMMIT_SRC, dst);
      try { execSync("chmod +x \"" + dst + "\""); } catch {}
      sh("git -C \"" + projDir + "\" config core.hooksPath .githooks");
      changes.push("git pre-commit 已装(项目 .githooks/pre-commit)");
    } catch (e) { warns.push("git pre-commit 安装失败:" + e.message); }
  } else skips.push("git pre-commit:未装(只靠状态检查器体检)");
}

// ---------- 动作 4:指针卡(只指路,不接管用户已有的卡) ----------
// 04-CONTEXT D-01/D-02:卡里只有「读哪个 SKILL.md」「边界是什么」「速查怎么拿」,
// 一条规则原文都不许有 —— 卡里出现规则就是第二真相源,而那正是本 phase 要消灭的东西。
if (!SKILLS_ONLY && !HOOKS_ONLY) {
  const routeCmd = `node "${join(MASTER, "mm-gsd-loop", "scripts", "gsd-state-check.mjs")}"`;
  const cards = SKILLS.filter((s) => existsSync(join(MASTER, s, "SKILL.md")));
  for (const [name, v] of targets) {
    if (!v.agents) { skips.push(name + " 指针卡:没探到该宿主的 agent 卡目录约定,不装(不硬造目录结构)"); continue; }
    const dir = H(v.agents);
    if (!existsSync(dir)) { skips.push(name + " 指针卡:" + dir + " 不存在 —— 这个宿主的子代理机制没验证过,不装"); continue; }
    if (!cards.length) { skips.push(name + " 指针卡:主仓里没有技能,发不了卡(先跑 mm-gsd install)"); continue; }
    if (!await confirm(`给 ${name} 装 ${cards.length} 张 mm-gsd 指针卡?(卡里只有指路与边界,不改你已有的卡)`, true)) {
      skips.push(name + " 指针卡:没装");
      continue;
    }
    let made = 0, kept = 0;
    for (const s of cards) {
      const f = join(dir, s + ".md");
      if (existsSync(f)) { kept++; continue; }        // 不接管、不覆盖既有的卡
      writeFileSync(f, pointerCard({ skill: s, skillPath: join(MASTER, s, "SKILL.md"), routeCmd }));
      made++;
    }
    if (made) changes.push(name + ":指针卡 " + made + " 张 → " + dir + (kept ? "(" + kept + " 张已存在,没动)" : ""));
    else oks.push(name + ":指针卡已齐全(" + kept + " 张,没动已有的)");
  }
}

// ---------- 汇总 ----------
console.log("\n=== 结果 ===");
for (const c of changes) console.log("  ✓ " + c);
for (const o of oks) console.log("  = " + o);
for (const s of skips) console.log("  – " + s);
for (const w of warns) console.log("  ! " + w);
if (stateCheck?.errors?.length) { console.log("\n状态机待修:"); for (const e of stateCheck.errors) console.log("  ✗ " + e.message + (e.fix ? "  → " + e.fix : "")); }
console.log("\n下一步:在项目里说「用 mm-gsd-loop 跑:<目标>」,或跑 mm-gsd-phase 工作流(goal=目标)。");
console.log("体检:node \"" + join(MASTER, "mm-gsd-loop", "scripts", "mm-gsd-install.mjs") + " --check\"");
console.log("");
