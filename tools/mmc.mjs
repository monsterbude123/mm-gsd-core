#!/usr/bin/env node
// mmc — mm-gsd-core 的自我维护 CLI
//
// 核心循环(每次改动都走一遍,别跳):
//   observe  读遥测找重复失败       → 发现问题
//   issue    带证据转 issue          → 问题可追溯
//   fix      最小改动 + 复现用例     → 问题解决
//   distill  复盘 → 规则/理论条目     → 经验落地
//   health   每次提交都跑            → 门禁生效(预算/台账/自检/零依赖/模式顺序)
//
// 零依赖,跨平台(Windows)。用法:mmc.mjs <命令> [参数]

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync, appendFileSync, rmSync, cpSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { missingRules, BASELINE_RULES } from "./rule-baseline.mjs";
import { registryGaps, unregisteredModules, baselineDrift } from "./module-registry.mjs";
import { fatAdvice } from "./fat-advice.mjs";
import { collectFiles, countLines, collectScripts } from "./budget-collect.mjs";
import { fileURLToPath } from "node:url";
import { makeInboxClose } from "./gh-issues.mjs";
import { makeReleaseFlow, checkTags } from "./release-flow.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const R = (...s) => join(ROOT, ...s);
const HOME_SKILLS = join(homedir(), ".agents", "skills");
const MANIFEST_NAME = ".mm-gsd-install.json";
const CHECKER = R("skills", "mm-gsd-loop", "scripts", "gsd-state-check.mjs");
const TELEMETRY = join(homedir(), ".agents", "mm-gsd-runs.jsonl");
const ISSUES = R(".planning", "issues");
const GH_BIN = process.platform === "win32" ? "gh.exe" : "gh";

const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[90m", b: "\x1b[1m", x: "\x1b[0m" };
const log = (s = "") => console.log(s);
const ok = (s) => log(`${C.g}✓${C.x} ${s}`);
const warn = (s) => log(`${C.y}!${C.x} ${s}`);
const bad = (s) => log(`${C.r}✗${C.x} ${s}`);
const head = (s) => log(`\n${C.b}${s}${C.x}`);

const rel = (p) => relative(ROOT, p).split(sep).join("/");
const readJSON = (p, fallback) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; } };

// 匹配器自测:门禁自己必须先证明自己是好的。
// 教训:glob 匹配器坏掉时不会报错,只会「永远不匹配」,于是上限检查静默空过 ——
//       比没有门禁更坏,因为它还显示着绿色对勾。
const MATCHER_SELFTEST = [
  ["skills/**/SKILL.md", "skills/mm-gsd-loop/SKILL.md", true],
  ["skills/**/SKILL.md", "skills/mm-gsd-loop/scripts/x.mjs", false],
  ["skills/**/*.mjs", "skills/mm-gsd-loop/scripts/gsd-state-check.mjs", true],
  ["skills/**/templates/*.md", "skills/mm-gsd-plan/templates/plan.md", true],
  ["skills/**/hooks/*", "skills/mm-gsd-loop/hooks/pre-commit", true],
  ["tools/*.mjs", "tools/mmc.mjs", true],
  ["tools/*.mjs", "tools/sub/x.mjs", false],
];

// budget.json 的 pattern 用 ** 通配,转成匹配器
const ESCAPE_RE = /[.+^${}()|[\]\\]/g;
const STAR = "\u0001**\u0001";
const globToMatcher = (pattern) => {
  const raw = pattern.split("/")
    .map((seg) => (seg === "**" ? STAR : seg.replace(ESCAPE_RE, "\\$&").replace(/\*/g, "[^/]*")))
    .join("/");
  // **/ 连着后面的斜杠一起换,否则会拼出双斜杠 —— 永不匹配,门禁静默空过
  const body = raw.split(STAR + "/").join("(?:.*/)?").split(STAR).join(".*");
  const re = new RegExp("^" + body + "$");
  return (p) => re.test(p);
};

// ---- 检查器组:ledger 里每条 active 规则挂的那一个 ----
const CHECKS = {
  // R-01:issue 必须带证据
  "check-issue-evidence"(report) {
    const dir = R(".planning", "issues");
    if (!existsSync(dir)) { report.info("还没有 issue 目录(正常:说明还没发现要转的问题)"); return true; }
    let pass = true;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
      const t = readFileSync(join(dir, f), "utf8");
      // 判据:「## 证据」节存在且里面确有实质内容(至少一行非空正文)。
      // 不要退回关键词黑名单 —— 那是上一版的做法,结果使用方 agent 提交的
      // 真实复现步骤被判"没有证据",而门禁只会在维护方这边红,
      // 使用方永远不知道自己踩的坑没被接住(误报的门禁等于没有门禁)。
      const sec = t.match(/##\s*证据\s*\n([\s\S]*?)(?=\n##\s|$)/);
      const body = sec ? sec[1].replace(/```[a-z]*\n?|\n?```/g, "").trim() : "";
      if (!body) { report.fail(`${f}: 缺「## 证据」节或证据为空 —— issue 没有证据就不可复现、不可追溯`); pass = false; }
    }
    if (pass) report.pass("issue 证据完整");
    return pass;
  },

  // R-02:台账完整性
  "check-ledger-integrity"(report) {
    const led = readJSON(R(".agents", "rules", "ledger.json"), null);
    if (!led) { report.fail("读不到 .agents/rules/ledger.json"); return false; }
    const known = new Set(Object.keys(CHECKS));
    let pass = true, active = 0;
    for (const r of led.rules ?? []) {
      if (r.status !== "active") continue;
      active++;
      if (!r.check) { report.fail(`${r.id}: active 但没挂 check —— 挂不上门禁的规则只能进 candidates,不能 active`); pass = false; }
      else if (!known.has(r.check)) { report.fail(`${r.id}: check "${r.check}" 在 mmc.mjs 里不存在 —— 台账指向了不存在的门禁`); pass = false; }
      if (!r.since) { report.fail(`${r.id}: 缺 since(生效日期)`); pass = false; }
    }
    const cand = (led.candidates ?? []).filter((c) => c.status !== "candidate");
    if (cand.length) { report.fail(`candidates 区有 ${cand.length} 条不是 candidate 状态 —— 候选区只放未生效的`); pass = false; }
    report.pass(`${active} 条 active 规则全部挂了可跑的门禁;${(led.candidates ?? []).length} 条候选待门禁化`);
    return pass;
  },

  // R-03:体积预算
  async "check-budget"(report) {
    for (const [pat, path, want] of MATCHER_SELFTEST) {
      let got;
      try { got = globToMatcher(pat)(path); }
      catch (e) { report.fail(`匹配器自测崩了(${pat}): ${e.message} —— 上限检查等于没跑`); return false; }
      if (got !== want) { report.fail(`匹配器自测失败: ${pat} 对 ${path} 应为 ${want} 实为 ${got} —— 上限检查等于没跑`); return false; }
    }
    const b = readJSON(R("budget.json"), null);
    if (!b) { report.fail("读不到 budget.json"); return false; }
    const { collectFiles, countLines } = await import("./budget-collect.mjs");
    const files = collectFiles(ROOT, "skills", "tools");
    const { counts, total } = countLines(ROOT, files);
    let pass = true;
    // 全局总量只是参考线,不拦人。2026-10-19 起从硬顶改为参考 —— 理由见 docs/theory.md T-12:
    // 硬顶会逼出「为了凑行数而合并/删减」的等价交换,那是收过路费。真正防住膨胀的是下面两条硬门禁。
    const over = total - b.totalLines;
    if (over > 0) report.info(`总行数 ${total},高于参考线 ${b.totalLines}(超 ${over})—— 参考线不拦人;膨胀由单文件/文件数上限拦`);
    else report.pass(`总行数 ${total} / 参考线 ${b.totalLines}(余 ${b.totalLines - total})`);
    if (files.length > b.maxTotalFiles) { report.fail(`文件数 ${files.length} 超上限 ${b.maxTotalFiles} —— 该合并,不是新增`); pass = false; }
    for (const cap of b.fileCaps ?? []) {
      const match = globToMatcher(cap.pattern);
      for (const [p, n] of Object.entries(counts)) {
        if (match(p) && n > cap.max) { report.fail(`${p}: ${n} 行,单文件上限 ${cap.max}(超 ${n - cap.max})\n${fatAdvice(p, n, cap, counts)}`); pass = false; }
      }
    }
    if (pass) report.pass(`全部 ${files.length} 个文件在单文件上限内`);
    const top = Object.entries(counts).sort((a, b2) => b2[1] - a[1]).slice(0, 3);
    report.info("最大的三个文件: " + top.map(([p, n]) => `${pathBase(p)} ${n}`).join(", "));
    return pass;
  },

  // R-04:语法 + 六种模式真跑
  async "check-syntax-and-modes"(report) {
    let pass = true;
    for (const f of (await collectScripts(ROOT, "skills", "tools"))) {
      try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
      catch (e) { report.fail(`${rel(f)}: 语法错误\n${String(e.stderr || e.message).split("\n").slice(0, 3).join("\n")}`); pass = false; }
    }
    if (!pass) return false;
    report.pass("所有 .mjs 语法正确");
    // node --check 查不出缺失 import —— 必须真跑
    const sandbox = join(tmpdir(), "mmc-smoke");
    mkdirSync(join(sandbox, ".planning"), { recursive: true });
    writeFileSync(join(sandbox, ".planning", "STATE.md"), "---\nstatus: discussing\nactive_phase: 01\n---\n");
    const modes = ["", "--plan", "--phases", "--worktrees", "--stats", "--json", "--routes"];
    for (const m of modes) {
      try {
        execFileSync(process.execPath, [CHECKER, m].filter(Boolean), { cwd: sandbox, env: { ...process.env, GSD_SANDBOX: "1" }, stdio: "pipe", timeout: 20000 });
      } catch (e) {
        const stderr = String(e.stderr || "").trim();
        if (/is not a function|is not defined|Cannot find/.test(stderr)) {
          report.fail(`模式 ${m || "(默认)"} 运行时炸了(node --check 查不出这类错): ${stderr.split("\n")[0]}`);
          pass = false;
        }
      }
    }
    if (pass) report.pass("七种模式全部能在未初始化项目里跑起来(冷启动沙盒)");
    return pass;
  },

  // R-05:模板必须通过自己的门禁 —— 委托给检查器的 --templates,不在这里重复实现一遍
  "check-templates-self-validate"(report) {
    let out = "", code = 0;
    try {
      out = execFileSync(process.execPath, [CHECKER, "--templates"], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    } catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
    const lines = out.split(/\r?\n/).filter((l) => /[✓✗]|→/.test(l));
    if (code !== 0) {
      for (const l of lines) report.fail(l.replace(/^\s+/, "  "));
      return false;
    }
    report.pass(lines.filter((l) => l.includes("✓")).pop()?.trim() ?? "全部模板结构合规");
    return true;
  },

  // R-11:打包完整性 —— 发布前必跑
  "check-package-verifiable"(report) {
    const script = R("scripts", "verify-package.mjs");
    if (!existsSync(script)) { report.fail("缺少 scripts/verify-package.mjs —— 打包检查无从谈起"); return false; }
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [script], { cwd: ROOT, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
    for (const l of out.split(String.fromCharCode(10)).filter((x) => x.includes(String.fromCharCode(10003)) || x.includes(String.fromCharCode(10007)))) report.info(l.trim());
    if (code !== 0) { report.fail("打包完整性检查未通过"); return false; }
    report.pass("打包完整性检查通过(模拟了一次真实安装)");
    return true;
  },

  // R-12:安装必须可追溯 —— 装一次写一份清单,doctor 能查漂移
  "check-install-traceable"(report) {
    const inst = R("bin", "mm-gsd.mjs");
    if (!existsSync(inst)) { report.fail("缺少 bin/mm-gsd.mjs"); return false; }
    const sb = join(tmpdir(), "mmc-trace");
    rmSync(sb, { recursive: true, force: true });
    try {
      execFileSync(process.execPath, [inst, "install", "--home", sb], { stdio: "pipe", timeout: 30000 });
      const mf = join(sb, ".agents", "skills", ".mm-gsd-install.json");
      if (!existsSync(mf)) { report.fail("安装后没有版本清单 —— 装出来的东西版本不可追溯"); return false; }
      const m = JSON.parse(readFileSync(mf, "utf8"));
      if (!m.version || !m.source || !m.installedAt) { report.fail("版本清单缺 version/source/installedAt"); return false; }
      if (Object.keys(m.skills ?? {}).length === 0) { report.fail("版本清单没记技能指纹 —— 查不出漂移"); return false; }
      report.pass(`安装写版本清单(version ${m.version} · ${m.source},${Object.keys(m.skills).length} 个技能指纹)`);
    } catch (e) {
      report.fail("安装流程失败:" + String(e.stderr || e.message).split(String.fromCharCode(10))[0]);
      return false;
    } finally {
      rmSync(sb, { recursive: true, force: true });
    }
    return true;
  },

  // R-06:零依赖
  // "零依赖"指零第三方依赖,不是零 import。相对路径引同仓库的兄弟模块是
  // 本仓库自己的代码,换台机器照样在 —— 但它必须真的存在,否则才是安装摩擦。
  // 判据:node: 内置 或 . 开头(相对同仓库,且单独校验可达)。
  // 静态 import 写错路径 Node 加载时就崩(红得很响);动态 import() 藏在函数里
  // 加载期不崩、运行到才炸,所以两种都得扫 —— 只扫静态的等于漏一半。
  async "check-zero-dep"(report) {
    let pass = true;
    for (const f of (await collectScripts(ROOT, "skills", "tools"))) {
      const src = readFileSync(f, "utf8");
      const specs = [
        ...[...src.matchAll(/^\s*import\s+.*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]),
        ...[...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
      ];
      for (const spec of specs) {
        if (spec.startsWith("node:")) continue;
        if (spec.startsWith(".")) {
          if (!existsSync(resolve(dirname(f), spec))) { report.fail(`${rel(f)}: 引了不存在的同仓库模块 "${spec}"`); pass = false; }
          continue;
        }
        report.fail(`${rel(f)}: 引入了非内置模块 "${spec}" —— 跨宿主安装,任何依赖都是安装摩擦`);
        pass = false;
      }
    }
    if (existsSync(R("package.json")) && readJSON(R("package.json"), {}).dependencies) {
      report.fail("存在 package.json dependencies —— 违反零依赖"); pass = false;
    }
    if (pass) report.pass("零运行时依赖(只允许 node: 内置)");
    return pass;
  },

  // R-13:报修入口必须随包分发。放 tools/ 就等于不存在 ——
  // 使用方手上只有 npx 装出来的 skills/,拿不到仓库里的任何东西。
  "check-report-reachable"(report) {
    const files = readJSON(R("package.json"), {}).files ?? [];
    let pass = true;
    // 1) bin 必须认识 report
    const binSrc = readFileSync(R("bin", "mm-gsd.mjs"), "utf8");
    if (!/cmd === "report"/.test(binSrc)) { report.fail("bin/mm-gsd.mjs 不认识 report —— npx mm-gsd-core report 跑不起来"); pass = false; }
    // 2) 它转发到的脚本必须在会分发的目录里
    //    路径用 join(PKG_ROOT, 段...) 拼,段数不固定 —— 从源码里把段全抓出来,
    //    不假设层数(上一版假设恰好两段,对三段路径误报)。
    const m = binSrc.match(/const rp = join\(PKG_ROOT,\s*((?:"[^"]+",?\s*)+)\)/);
    const segs = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
    if (!segs) { report.fail("bin 里找不到 report 的脚本路径 —— 转发目标不可核对"); pass = false; }
    else {
      const rel = segs.join("/");
      if (!existsSync(R(...segs))) { report.fail(`report 转发目标不存在:${rel}`); pass = false; }
      else if (!files.some((f) => segs[0] === f || segs[0].startsWith(String(f).replace(/\/$/, "")))) {
        report.fail(`report 脚本在 ${rel},但 package.json files 没包含它 —— 使用方装不到`); pass = false;
      }
    }
    // 3) 报修入口不能反过来依赖只在仓库里有的东西。
    //    只看 import/require —— 帮助文案里提到 mmc.mjs 不算依赖,
    //    把文案当依赖会让这条门禁天天误报,误报的门禁等于没有门禁。
    const rpFile = R("skills", "mm-gsd-loop", "scripts", "mm-gsd-report.mjs");
    if (existsSync(rpFile)) {
      const src = readFileSync(rpFile, "utf8");
      const badDep = [...src.matchAll(/^\s*(?:import\s[^;]*?from\s*|require\(\s*)["']([^"']+)["']/gm)]
        .map((x) => x[1])
        .filter((s) => !s.startsWith("node:") && !s.startsWith("."));
      if (badDep.length) { report.fail(`报修脚本引入了不可用的模块:${badDep.join(", ")} —— 使用方装不到`); pass = false; }
      if (/join\([^)]*"\.\."[^)]*"tools"|join\([^)]*"tools"/.test(src)) { report.fail("报修脚本读仓库专属目录 tools/ —— 换台机器就断"); pass = false; }
    }
    if (pass) report.pass("报修入口随包可达(bin → skills/,且 files 包含)");
    return pass;
  },

  // R-14:报修失败不许假绿。没 gh / 没证据 / gh 报错,都必须非零退出。
  // 退出 0 会让 agent 以为"已经报上去了",而维护方永远看不到这条。
  "check-report-fails-loud"(report) {
    const rp = R("skills", "mm-gsd-loop", "scripts", "mm-gsd-report.mjs");
    if (!existsSync(rp)) { report.fail("报修脚本不存在,没法验它会不会假绿"); return false; }
    let pass = true;
    for (const [what, argv] of [
      ["无参数(无标题)", []],
      ["有标题无证据", ["某标题"]],
      ["证据文件不存在", ["某标题", "--evidence-file", join(tmpdir(), "definitely-missing.md")]],
    ]) {
      let code = 0;
      try { execFileSync(process.execPath, [rp, ...argv], { stdio: "pipe", timeout: 30000 }); }
      catch (e) { code = e.status ?? 1; }
      if (code === 0) { report.fail(`${what} 时报修退出 0 —— 会让 agent 以为报上去了,实际没有`); pass = false; }
      else report.pass(`${what} → 退出 ${code}`);
    }
    if (pass) report.pass("报修的三种失败都非零退出(不假绿)");
    return pass;
  },

  // R-15:门禁必须对自己的正则有自测。GitHub #6/#7/#8 三条都是
  // 「门禁看起来在跑、实际判错」—— 不崩,只是安静地给错答案。
  "check-gate-selftest"(report) {
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [CHECKER, "--selfcheck"], { cwd: ROOT, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
    const n = (out.match(/✓/g) ?? []).length;
    if (code === 0) { report.pass(`门禁自测全过(${n} 条)`); return true; }
    report.fail("门禁自测不过 —— 门禁本身是坏的,先修门禁再谈别的");
    for (const l of out.split(/\r?\n/).filter((x) => x.includes("✗"))) report.info(l.trim());
    return false;
  },

  // R-16:每个门禁必须登记一条会红用例。GitHub #6/#7/#8 的根因都是
  // 「门禁看起来在跑、实际永远绿或判错」,而 R-15 只覆盖检查器的正则 ——
  // mmc 自己的门禁坏了,当时没有任何东西能发现。核对实现见 module-registry.mjs。
  async "check-gate-cases"(report) {
    const reg = readJSON(R("tools", "gate-cases.json"), null);
    if (!reg) { report.fail("读不到 tools/gate-cases.json"); return false; }
    const led = readJSON(R(".agents", "rules", "ledger.json"), { rules: [] });
    const driven = new Set((led.rules ?? []).filter((r) => r.status === "active").map((r) => r.check));
    let pass = true;
    for (const m of registryGaps(Object.keys(CHECKS), reg, driven)) { report.fail(m); pass = false; }
    // references/ 下的门禁模块不在 CHECKS 里(那是 mmc 自己的门禁),由 R-15 自测覆盖。
    // 这条核对让「新模块忘了登记」变成可判的,而不是靠人记得。实现见 module-registry.mjs。
    const unreg = await unregisteredModules(R("skills", "mm-gsd-loop", "references"), Object.keys(reg._modules ?? {}));
    for (const f of unreg) { report.fail(`${f} 是门禁模块但没在 gate-cases.json 的 _modules 登记 —— 改坏了没人知道`); pass = false; }
    if (pass) report.pass(`${Object.keys(CHECKS).length} 个门禁全部登记了会红用例、被 active 规则驱动,模块区与实现一致`);
    return pass;
  },

  // R-07:模式块必须排在 STATE 早退之前
  "check-mode-ordering"(report) {
    const src = readFileSync(CHECKER, "utf8");
    const stateEarly = src.indexOf('// ---- STATE ----');
    if (stateEarly < 0) { report.fail("找不到 // ---- STATE ---- 标记"); return false; }
    // 模式列表从源码反推,不用硬编码数组。原版写死五个,新增 --templates/--selfcheck 后
    // 它们既不受「排在 STATE 早退前」约束、也不受「必须有输出」约束 —— 漏检的那个
    // --selfcheck 恰恰是本轮新增的门禁自测,检查器漏检自己的自测模式(GitHub #4)。
    // 排除修饰符:--json/--quiet/--planning 只改已有模式的输出方式,没有自己的分块。
    const MODIFIERS = new Set(["--json", "--quiet", "--planning", "--check", "--from-repo", "--local"]);
    const modes = [...new Set([...src.matchAll(/process\.argv\.includes\("(--[a-z-]+)"\)/g)].map((m) => m[1]))]
      .filter((m) => !MODIFIERS.has(m));
    if (!modes.length) { report.fail("检查器里找不到任何模式入口 —— 模式列表反推失败"); return false; }
    let pass = true;
    for (const m of modes) {
      const i = src.indexOf(`process.argv.includes("${m}")`);
      if (i < 0) { report.fail(`检查器里找不到 ${m} 的入口`); pass = false; continue; }
      if (i > stateEarly) { report.fail(`${m} 的分块排在 STATE 早退之后 —— 未初始化项目里永远跑不到这个模式`); pass = false; }
      // 每个模式的入口块里必须真的输出些什么(自测模式由 runSelfTest 负责输出;die() 也算 —— 它内部 console.log 后退出)
      const chunk = src.slice(i, i + 3000);
      if (!/console\.log|runSelfTest|\bdie\(/.test(chunk)) { report.fail(`${m} 的分块里没有任何输出 —— 静默的空输出等于没跑`); pass = false; }
    }
    if (pass) report.pass(`${modes.length} 个模式都在 STATE 早退之前,且各自有输出`);
    return pass;
  },

  // R-08:不得静默 no-op
  "check-no-silent-noop"(report) {
    const src = readFileSync(CHECKER, "utf8") + readFileSync(R("tools", "mmc.mjs"), "utf8");
    // JS 正则里出现 Python/PCRE 的转义是最常见的"静默失效"来源
    const pyEscapes = [...src.matchAll(/\\([ZAGzKQRh])/g)];
    let pass = true;
    for (const m of pyEscapes) { report.fail(`发现 PCRE 独有转义 \\${m[1]} —— 在 JS 里它匹配字面量字符,不是锚点,是静默失效`); pass = false; }
    // catch 里吞掉一切
    const bareCatches = [...src.matchAll(/catch\s*\{\s*\}/g)];
    if (bareCatches.length > 6) { report.fail(`有 ${bareCatches.length} 处空 catch —— 吞掉错误等于让失败看起来像成功`); pass = false; }
    if (pass) report.pass("无静默失效(无 PCRE 转义 / 空 catch 受控)");
    return pass;
  },

  // R-17:参考系对照表里的路径必须真的存在 —— 引用失效的对照表比没有表更坏
  async "check-reference-map"(report) {
    const { runReferenceMapCheck, resolveGsdRoot } = await import("./reference-map.mjs");
    return runReferenceMapCheck({ mapPath: R("skills","mm-gsd-loop","references","reference-map.md"), gsdRoot: resolveGsdRoot(), report });
  },

  // R-18:工件记账完整性 —— 「做完了却没记账」不许静默通过
  async "check-artifact-ledger"(report) {
    const { checkArtifactLedger } = await import("../skills/mm-gsd-loop/references/artifact-ledger.mjs");
    return checkArtifactLedger({ root: ROOT, report });
  },

  // R-19:预发布通道时效 —— next 不得比 latest 旧(通道腐烂的唯一方式)
  "check-release-tags"(report) {
    return checkTags(report);
  },
};
const pathBase = (p) => p.split("/").pop();

// ---- 命令 ----
const CMD = {
  // GitHub 往返在 tools/gh-issues.mjs(拆分理由见那个文件头),挂进来当普通命令
  ...makeInboxClose({ ISSUES, GH_BIN, log, ok, bad, warn, head, C }),

  // 1. 观察:读遥测找重复失败
  observe() {
    head("① observe —— 读遥测找重复失败");
    if (!existsSync(TELEMETRY)) { warn(`还没有遥测:${TELEMETRY}`); log("  检查器每跑一次会自动记一行;跑一次任意模式即产生。\n"); return 0; }
    const rows = readFileSync(TELEMETRY, "utf8").split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const bad = rows.filter((r) => r.exit === 1);
    const groups = {};
    for (const r of bad) for (const m of r.errors ?? []) {
      const k = m.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, "#").slice(0, 60);
      (groups[k] ??= { count: 0, projects: new Set(), sample: m, modes: new Set() });
      groups[k].count++; groups[k].projects.add(r.cwd); groups[k].modes.add(r.mode);
    }
    const list = Object.entries(groups).sort((a, b) => b[1].count - a[1].count);
    log(`  遥测 ${rows.length} 次运行,其中门禁失败 ${bad.length} 次,聚合出 ${list.length} 类问题\n`);
    if (!list.length) { ok("没有失败记录"); return 0; }
    let i = 0;
    for (const [k, g] of list.slice(0, 8)) {
      const cross = g.projects.size > 1 ? `(跨 ${g.projects.size} 个项目 → 系统性问题)` : `(仅 ${[...g.projects][0]})`;
      const hot = g.projects.size >= 1 && g.count >= 3 ? " ← 重复失败,值得转 issue" : "";
      log(`  ${String(++i).padStart(2)}. ${g.count}× ${k}\n      ${cross};模式:${[...g.modes].join(",")}${hot}`);
      log(`      ${C.d}原文:${g.sample.slice(0, 90)}${C.x}`);
    }
    log(`\n  转 issue:node tools/mmc.mjs issue "<标题>" --evidence "<复现命令或报错>"\n`);
    return 0;
  },

  // 2. 问题转 issue
  issue(args) {
    head("② issue —— 带证据转 issue");
    const title = args.find((a) => !a.startsWith("--"));
    const evIdx = args.indexOf("--evidence");
    const evidence = evIdx >= 0 ? args[evIdx + 1] : "";
    const push = args.includes("--push");
    if (!title) { bad('用法:mmc issue "<标题>" --evidence "<复现命令/报错>" [--push]'); return 1; }
    if (!evidence.trim()) { bad("没有证据。issue 必须能追溯到具体运行或具体报错 —— 这条是 R-01。"); return 1; }
    mkdirSync(ISSUES, { recursive: true });
    const id = "I-" + String(readdirSync(ISSUES).filter((f) => f.startsWith("I-")).length + 1).padStart(3, "0");
    const body = [
      `# ${id} ${title}`, "",
      "## 状态", "", "open", "",
      "## 证据", "", "```", evidence.trim(), "```", "",
      "## 复现", "", "```bash", "node tools/mmc.mjs <复现命令>", "```", "",
      "## 根因", "", "_(填完再定修复方案)_", "",
      "## 修复后要沉淀什么", "",
      "- [ ] 能门禁化吗?能就写 check 并挂进台账;不能就说明为什么。",
      "- [ ] 会不会让系统变大?会的话要等量删掉什么?", "",
    ].join("\n");
    const f = join(ISSUES, id + ".md");
    writeFileSync(f, body);
    ok(`已写本地 issue:${rel(f)}`);
    if (push) {
      try {
        execFileSync("gh", ["issue", "create", "--title", `${id} ${title}`, "--body-file", f, "--label", "mm-gsd"], { stdio: "pipe" });
        ok("已提交到 GitHub Issues");
      } catch (e) { bad("gh 提交失败(不影响本地 issue):" + String(e.stderr || e.message).split("\n")[0]); }
    } else log(`  ${C.d}加 --push 可同时提到 GitHub Issues${C.x}`);
    log(`\n  下一步:node tools/mmc.mjs fix ${id}\n`);
    return 0;
  },

  // 3. 解决
  async fix(args) {
    head("③ fix —— 标记并验证");
    const id = args.find((a) => !a.startsWith("--"));
    if (!id) { bad("用法:mmc fix <issue-id>"); return 1; }
    const f = join(ISSUES, id + ".md");
    if (!existsSync(f)) { bad(`找不到 ${id}(在 ${rel(ISSUES)})`); return 1; }
    let t = readFileSync(f, "utf8");
    t = t.replace("## 状态\n\nopen", "## 状态\n\nfixed (待 distill)");
    writeFileSync(f, t);
    ok(`${id} 标记为 fixed`);
    log("\n  修复要过的门禁:node tools/mmc.mjs health");
    const h = await CMD.health();
    log(`\n  下一步:node tools/mmc.mjs distill  (把这次修复沉淀成规则/理论)${C.d} —— 不沉淀的修复下次还会犯${C.x}\n`);
    return h;
  },

  // 4. 沉淀:复盘 → 规则/理论候选
  distill() {
    head("④ distill —— 经验 → 规则 → 理论");
    const led = readJSON(R(".agents", "rules", "ledger.json"), { rules: [], candidates: [] });
    const pend = (led.candidates ?? []).filter((c) => c.status === "candidate");
    log(`  台账现状:${led.rules?.length ?? 0} 条规则,${pend.length} 条候选待门禁化\n`);
    if (pend.length) {
      log("  候选逐条问三个问题:");
      for (const c of pend) {
        log(`\n    · ${c.claim}`);
        log(`      为什么还没生效:${c["why-not-active"]}`);
        log(`      ${C.d}答:能写成 check 吗?→ 是就补 check 并转 active;不能就正式退役,别让它一直挂在候选区装样子。${C.x}`);
      }
    }
    log(`\n  每次修复后问自己三件事:`);
    log(`    1. 这次踩的坑,是「纪律没写」还是「纪律写了但没门禁」?`);
    log(`       ${C.d}——绝大多数是后者。写了没门禁的纪律等于没写。${C.x}`);
    log(`    2. 修完之后系统变大了吗?变大了要等量删掉什么?${C.d}(见 budget.json)${C.x}`);
    log(`    3. 这条经验是通用的,还是只对当前实现成立?通用的进 rules,只对实现成立的留在 git history 里就够了。`);
    log(`\n  理论文档:docs/theory.md   复盘模板:docs/lessons/TEMPLATE.md\n`);
    return 0;
  },

  // 5. 体检:每次提交都跑
  async health() {
    head("⑤ health —— 门禁体检(每次提交都要跑)");
    const ledgerPath = R(".agents", "rules", "ledger.json");
    const raw = readFileSync(ledgerPath, "utf8");
    let led;
    try { led = JSON.parse(raw); }
    catch (e) {
      bad("台账 JSON 解析失败:" + e.message);
      bad("→ 这不是可以忽略的错误:台账坏了却显示「全通过」,是本仓库最坏的一种假绿。修好再提交。");
      return 1;
    }
    const activeCount = (led.rules ?? []).filter((r) => r.status === "active").length;
    // 基线在台账驱动循环**之外**,且来自 ledger 之外的第二份记录(见 rule-baseline.mjs):
    // 删掉台账里的一行,那个唯一能发现它被删掉的 check 就住在它自己身上。
    const miss = missingRules(led);
    if (miss.length) {
      bad(`基线要求 ${BASELINE_RULES.length} 条 active 规则,台账里只有 ${activeCount} 条 —— 缺的门禁不会跑,却仍会显示「全通过」。`);
      bad(`→ 缺:${miss.join("、")}。退役某条规则要改 tools/rule-baseline.mjs 并在 docs/theory.md 写清理由,不要只删台账。`);
      return 1;
    }
    // 反向也要查(G-02)。只有上面那条时,洞只是从「删台账」挪到「删基线」:
    // 只改 rule-baseline.mjs、台账不动 → exit 0,原始失败形状原样复现。
    // 更硬的一条是新增规则:基线是冻结快照,反向不查就意味着**基线之后新增的
    // 规则永久不受保护** —— 实测台账加 R-17 再删掉,exit 0,且无人会发现。
    const drift = baselineDrift(BASELINE_RULES, led);
    if (drift.extraInLedger.length) {
      bad(`台账里有基线没有的 active 规则:${drift.extraInLedger.join("、")} —— 新增规则不登记基线,它就永久不受保护。把它们加进 tools/rule-baseline.mjs。`);
      return 1;
    }
    if (drift.missingInLedger.length) {
      bad(`基线里有台账没有的规则:${drift.missingInLedger.join("、")} —— 退役了却没从基线删。`);
      bad(`→ 从 BASELINE_RULES 删掉,并在 docs/theory.md 写清退役理由。`);
      return 1;
    }
    const report = { pass: (s) => ok(s), fail: (s) => bad(s), info: (s) => log(`  ${C.d}· ${s}${C.x}`) };
    let failed = 0, ran = 0;
    for (const r of led.rules ?? []) {
      if (r.status !== "active" || !r.check) continue;
      const fn = CHECKS[r.check];
      if (!fn) { bad(`${r.id}: check "${r.check}" 不存在`); failed++; continue; }
      ran++;
      const before = process.exitCode;
      let pass = false;
      try { pass = !!(await fn(report)); } catch (e) { report.fail(`${r.id} 的检查自身抛错:${e.message}`); }
      if (!pass) { failed++; log(`  ${C.d}${r.id} ${r.statement.slice(0, 40)}…${C.x}`); }
      else log(`  ${C.d}${r.id}${C.x}`);
      process.exitCode = before;
    }
    log("");
    if (failed) { bad(`${failed}/${ran} 条规则门禁未通过 —— 不许合进 main`); return 1; }
    ok(`${ran} 条规则门禁全通过`);
    return 0;
  },

  async budget() { const rep = { pass: ok, fail: bad, info: (s) => log(`  ${C.d}· ${s}${C.x}`) }; return (await CHECKS["check-budget"](rep)) ? 0 : 1; },
  // sync:把仓库里的技能装到 ~/.agents/skills/ —— 走和 npm 包完全相同的那条安装路径,
  // 不再手工 cp。手工 cp 是「装了但不知道是哪一版」的根源。
  sync(args) {
    head("sync —— 仓库 → ~/.agents/skills/");
    const inst = R("bin", "mm-gsd.mjs");
    if (!existsSync(inst)) { bad("缺少 bin/mm-gsd.mjs"); return 1; }
    const argv2 = [inst, "install", "--from-repo"];
    const hi = args.indexOf("--home");
    if (hi >= 0 && args[hi + 1]) argv2.push("--home", args[hi + 1]);
    try {
      log(execFileSync(process.execPath, argv2, { encoding: "utf8", stdio: "pipe" }));
    } catch (e) {
      bad("sync 失败:\n" + String(e.stdout || "") + String(e.stderr || e.message));
      return 1;
    }
    return 0;
  },

  // release / promote:发布通道。实现住在 tools/release-flow.mjs ——
  // 主文件已 700/700 顶着上限,再加就破(本仓先例:gh-issues.mjs、rule-baseline.mjs)。
  ...makeReleaseFlow({ log, ok, bad, warn, head, C, health: () => CMD.health() }),

};

const args = process.argv.slice(2);
const cmd = args[0];
if (!cmd || cmd === "-h" || cmd === "--help") {
  log(`
${C.b}mmc${C.x} — mm-gsd-core 自我维护 CLI

  ${C.b}observe${C.x}   读遥测找重复失败 → 输出候选问题
  ${C.b}issue${C.x}     带证据转 issue      mmc issue "<标题>" --evidence "<证据>" [--push]
  ${C.b}inbox${C.x}     拉使用方报修到本地   mmc inbox
  ${C.b}fix${C.x}       标记解决并跑全部门禁  mmc fix <id>
  ${C.b}close${C.x}     关掉已修的 GitHub issue  mmc close <id> | --all
  ${C.b}distill${C.x}   复盘 → 规则/理论沉淀(挂不上门禁的规则不许 active)
  ${C.b}health${C.x}    体检:台账/预算/模板自检/零依赖/模式顺序   ${C.d}每次提交都要跑${C.x}
  ${C.b}budget${C.x}    只看体积预算

${C.d}核心循环:observe → issue → fix → distill →(下次 observe)
每轮必须让系统净复杂度不增:变胖要有等量删除。${C.x}
`);
  process.exit(0);
}
if (!CMD[cmd]) { bad(`未知命令 ${cmd}`); process.exit(1); }
process.exit(await CMD[cmd](args.slice(1)));
