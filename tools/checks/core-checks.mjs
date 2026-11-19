// mmc 门禁实现本体(phase 30 下沉):30 条检查按族分节住这里,mmc.mjs 只留一行式转发壳。
// 契约:导出名 = 台账 check 键的 camelCase,且必须匹配 ^(check|run|validate)[A-Z](deadGates alive 判据);
// 报错文案与判据逐字保留 —— 使用方在看的契约,下沉不是改写。

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { C, CHECKER, R, ROOT, bad, head, log, ok, pathBase, readJSON, rel, warn } from "./shared.mjs";
import { deriveWaves } from "../../skills/mm-gsd-loop/references/worktree-view.mjs";
import { collectFiles, collectScripts, countLines } from "../budget.mjs";
import { checkTags } from "../release-flow.mjs";
import { deadGates, registryGaps, unregisteredModules } from "../module-registry.mjs";
import { MAIN_FILE_BASELINE } from "../main-file-baseline.mjs";

// R-01:issue 必须带证据
export function checkIssueEvidence(report) {
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
}

// R-02:台账完整性
export function checkLedgerIntegrity(report,knownKeys) {
    const led = readJSON(R(".agents", "rules", "ledger.json"), null);
    if (!led) { report.fail("读不到 .agents/rules/ledger.json"); return false; }
    const known = new Set(knownKeys);
    let pass = true, active = 0;
    for (const r of led.rules ?? []) {
      if (r.status !== "active") continue;
      active++;
      if (!r.check) { report.fail(`${r.id}: active 但没挂 check —— 挂不上门禁的规则只能进 candidates,不能 active`); pass = false; }
      else if (!known.has(r.check)) { report.fail(`${r.id}: check "${r.check}" 在 mmc.mjs 里不存在 —— 台账指向了不存在的门禁`); pass = false; }
      if (!r.since) { report.fail(`${r.id}: 缺 since(生效日期)`); pass = false; }
      // 摩擦档(phase 30 T1):每条 active 规则必须声明摩擦档位与依据 —— 体积只报不拦(T-16),
      // 但「哪个门在收过路费、收了多少」要有账可查,审计(降级/退役)才有依据。
      if (!["high", "mid", "low"].includes(r.friction)) { report.fail(`${r.id}: 缺 friction 摩擦档(high|mid|low)—— 摩擦审计要求每条 active 规则声明档位(phase 30 T1)`); pass = false; }
      else if (!r.friction_note) { report.fail(`${r.id}: 有 friction 但缺 friction_note —— 档位没有依据等于没审`); pass = false; }
    }
    const cand = (led.candidates ?? []).filter((c) => c.status !== "candidate");
    if (cand.length) { report.fail(`candidates 区有 ${cand.length} 条不是 candidate 状态 —— 候选区只放未生效的`); pass = false; }
    report.pass(`${active} 条 active 规则全部挂了可跑的门禁;${(led.candidates ?? []).length} 条候选待门禁化`);
    return pass;
}

// R-32(归属式门,phase 30 T2):新判定实现不许再往主文件里长 ——
// 两份主文件的顶层函数名冻结在 tools/main-file-baseline.mjs;新增的顶层函数必须
// 在 references/ 或 tools/checks/ 有同名导出。基线内的存量豁免(存量不判死)。
// CHECKS 简写方法不在此门射程 —— 那条增长路径由 check-ledger-integrity 覆盖(新键必须登记台账)。
// 限度(shortcut):主文件是脚本,不能真导入枚举(import 即执行),文本枚举认不全
// 对象简写方法/类方法/let 箭头 —— 升级时机:出现绕过形态再换真解析器。
export function checkMainFileOwnership(report) {
    const MAIN_FILES = Object.keys(MAIN_FILE_BASELINE);
    let pass = true;
    for (const f of MAIN_FILES) {
      const src = readFileSync(R(f), "utf8");
      const names = new Set();
      for (const m of src.matchAll(/^(?:async )?function (\w+)/gm)) names.add(m[1]);
      for (const m of src.matchAll(/^const (\w+) =/gm)) names.add(m[1]);
      const frozen = new Set(MAIN_FILE_BASELINE[f]);
      if (!frozen.size) { report.fail(`${f}: 冻结基线为空 —— 基线被清空时门必须红(fail-closed)`); pass = false; continue; }
      // references/ 与 tools/checks/ 的导出名索引(新增名的合法去向)
      const exported = new Set();
      for (const dir of ["skills/mm-gsd-loop/references", "tools/checks"]) {
        let es = []; try { es = readdirSync(R(dir)).filter((x) => x.endsWith(".mjs")); } catch {}
        for (const e of es) {
          const s = readFileSync(R(dir, e), "utf8");
          for (const m of s.matchAll(/export (?:async )?(?:function|const) (\w+)/g)) exported.add(m[1]);
        }
      }
      for (const n of names) {
        if (frozen.has(n)) continue;
        if (exported.has(n)) continue;
        report.fail(`${f}: 新增顶层函数 "${n}" 没有同名导出 —— 新判定实现不许往主文件里长(R-32);落 references/ 或 tools/checks/ 并同名导出`);
        pass = false;
      }
    }
    if (pass) report.pass("主文件顶层函数全部在冻结基线内或已有同名导出(归属式门 ✓)");
    return pass;
}

// 体积统计:只报不拦。2026-10-26 起没有体积硬顶(fileCaps / maxTotalFiles 已退役,见 docs/theory.md T-16)
// —— 硬顶逼出的不是瘦身,是为凑行数做的等价交换,那是收过路费。
// 匹配器仍然自测:它现在用于按族分组统计,坏掉的匹配器会让统计静默空过(假绿)。
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

export async function checkBudget(report) {
    for (const [pat, path, want] of MATCHER_SELFTEST) {
      let got;
      try { got = globToMatcher(pat)(path); }
      catch (e) { report.fail(`匹配器自测崩了(${pat}): ${e.message} —— 体积统计等于没跑`); return false; }
      if (got !== want) { report.fail(`匹配器自测失败: ${pat} 对 ${path} 应为 ${want} 实为 ${got} —— 体积统计等于没跑`); return false; }
    }
    const b = readJSON(R("budget.json"), null);
    if (!b) { report.fail("读不到 budget.json"); return false; }
    const { collectFiles, countLines } = await import("../budget.mjs");
    const files = collectFiles(ROOT, "skills", "tools", "bin", "docs");
    const { counts, total } = countLines(ROOT, files);
    const over = total - b.totalLines;
    if (over > 0) report.info(`总行数 ${total},高于参考线 ${b.totalLines}(超 ${over})—— 参考线,只报不拦`);
    else report.pass(`总行数 ${total} / 参考线 ${b.totalLines}(余 ${b.totalLines - total})`);
    // 按族报一遍:哪一族在长,自己看得见。统计用同一个匹配器,所以它的自测是有意义的。
    for (const g of [...(b.systemGlobs ?? []), ...(b.docGlobs ?? [])]) {
      const m = globToMatcher(g);
      const n = Object.entries(counts).filter(([p]) => m(p)).reduce((a, [, v]) => a + v, 0);
      report.info(`${g}: ${n} 行`);
    }
    report.pass(`${files.length} 个文件 —— 体积只报不拦(硬顶已退役)`);
    const top = Object.entries(counts).sort((a, b2) => b2[1] - a[1]).slice(0, 3);
    report.info("最大的三个文件: " + top.map(([p, n]) => `${pathBase(p)} ${n}`).join(", "));
    return true;
}

// R-04:语法 + 六种模式真跑
export async function checkSyntaxAndModes(report) {
    let pass = true;
    for (const f of (await collectScripts(ROOT, "skills", "tools", "bin"))) {
      try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
      catch (e) { report.fail(`${rel(f)}: 语法错误\n${String(e.stderr || e.message).split("\n").slice(0, 3).join("\n")}`); pass = false; }
    }
    if (!pass) return false;
    report.pass("所有 .mjs 语法正确");
    // node --check 查不出缺失 import —— 必须真跑
    const sandbox = join(tmpdir(), "mmc-smoke");
    mkdirSync(join(sandbox, ".planning"), { recursive: true });
    writeFileSync(join(sandbox, ".planning", "STATE.md"), "---\nstatus: discussing\nactive_phase: 01\n---\n");
    const modes = ["", "--plan", "--plan-check", "--phases", "--worktrees", "--stats", "--json", "--routes"];
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
    if (pass) report.pass("八种模式全部能在未初始化项目里跑起来(冷启动沙盒)");
    return pass;
}

// R-05:模板必须通过自己的门禁 —— 委托给检查器的 --templates,不在这里重复实现一遍
export function checkTemplatesSelfValidate(report) {
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
}

// R-11:打包完整性 —— 发布前必跑
export function checkPackageVerifiable(report) {
    const script = R("scripts", "verify-package.mjs");
    if (!existsSync(script)) { report.fail("缺少 scripts/verify-package.mjs —— 打包检查无从谈起"); return false; }
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [script], { cwd: ROOT, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
    for (const l of out.split(String.fromCharCode(10)).filter((x) => x.includes(String.fromCharCode(10003)) || x.includes(String.fromCharCode(10007)))) report.info(l.trim());
    if (code !== 0) { report.fail("打包完整性检查未通过"); return false; }
    report.pass("打包完整性检查通过(模拟了一次真实安装)");
    return true;
}

// R-12:安装必须可追溯 —— 装一次写一份清单,doctor 能查漂移
export function checkInstallTraceable(report) {
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
}

// R-06:零依赖。"零依赖"指零第三方依赖,不是零 import:相对路径引同仓库的兄弟模块是
// 本仓库自己的代码,但必须真的存在(否则才是安装摩擦)。静态 import 写错路径加载时就崩,
// 动态 import() 藏在函数里加载期不崩、运行到才炸 —— 两种都得扫,只扫静态的等于漏一半。
export async function checkZeroDep(report) {
    let pass = true;
    for (const f of (await collectScripts(ROOT, "skills", "tools", "bin"))) {
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
}

// R-13:报修入口必须随包分发。放 tools/ 就等于不存在 ——
// 使用方手上只有 npx 装出来的 skills/,拿不到仓库里的任何东西。
export function checkReportReachable(report) {
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
}

// R-14:报修失败不许假绿。没 gh / 没证据 / gh 报错,都必须非零退出。
// 退出 0 会让 agent 以为"已经报上去了",而维护方永远看不到这条。
export function checkReportFailsLoud(report) {
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
}

// R-15:门禁必须对自己的正则有自测。GitHub #6/#7/#8 三条都是「门禁看起来在跑、实际判错」—— 不崩,只是安静地给错答案。
export function checkGateSelftest(report) {
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [CHECKER, "--selfcheck"], { cwd: ROOT, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
    const n = (out.match(/✓/g) ?? []).length;
    if (code === 0) { report.pass(`门禁自测全过(${n} 条)`); return true; }
    report.fail("门禁自测不过 —— 门禁本身是坏的,先修门禁再谈别的");
    for (const l of out.split(/\r?\n/).filter((x) => x.includes("✗"))) report.info(l.trim());
    return false;
}

// R-16:每个门禁必须登记一条会红用例。GitHub #6/#7/#8 的根因都是「门禁看起来在跑、实际永远绿或判错」,
// 而 R-15 只覆盖检查器的正则 —— mmc 自己的门禁坏了没人能发现。核对实现见 module-registry.mjs。
export async function checkGateCases(report,regKeys) {
    const reg = readJSON(R("tools", "gate-cases.json"), null);
    if (!reg) { report.fail("读不到 tools/gate-cases.json"); return false; }
    const led = readJSON(R(".agents", "rules", "ledger.json"), { rules: [] });
    const driven = new Set((led.rules ?? []).filter((r) => r.status === "active").map((r) => r.check));
    let pass = true;
    for (const m of registryGaps(regKeys, reg, driven)) { report.fail(m); pass = false; }
    // references/ 下的门禁模块不在 CHECKS 里(那是 mmc 自己的门禁),由 R-15 自测覆盖。
    // 这条核对让「新模块忘了登记」变成可判的,而不是靠人记得。实现见 module-registry.mjs。
    const unreg = await unregisteredModules(R("skills", "mm-gsd-loop", "references"), Object.keys(reg._modules ?? {}));
    for (const f of unreg) { report.fail(`${f} 是门禁模块但没在 gate-cases.json 的 _modules 登记 —— 改坏了没人知道`); pass = false; }
    // 门禁**活着吗**:登记了不代表还能判红。把体掏空成 `return true` 的门禁,登记照样在、health 照样绿
    // (phase 07 挖出来的洞:记账门与研究消费门都试过)。判据是结构事实 —— 体里得有失败路径。
    for (const d of deadGates(readFileSync(R("tools", "mmc.mjs"), "utf8"), regKeys)) {
      report.fail(d === "__selfcheck__" ? "门禁存活判据自证失败:掏空的单行门禁没被判死 —— 这条判据自己不灵,判红" : `门禁 ${d} 的实现里没有失败路径(既不 report.fail 也不 return false 也不委托)—— 整个体被掏空了,这条门禁现在永远绿`); pass = false;
    }
    if (pass) report.pass(`${regKeys.length} 个门禁全部登记了会红用例、被 active 规则驱动,且都还活着(有失败路径)`);
    return pass;
}

// R-07:模式块必须排在 STATE 早退之前
export function checkModeOrdering(report) {
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
}

// R-08:不得静默 no-op
export function checkNoSilentNoop(report) {
    // 扫描面跟实现走:主文件 + checks/ 下全部实现模块(下沉后判定代码住 checks/,漏扫 = 静默失去覆盖面)
    let src = readFileSync(CHECKER, "utf8") + readFileSync(R("tools", "mmc.mjs"), "utf8");
    try {
      for (const f of readdirSync(R("tools", "checks")).filter((x) => x.endsWith(".mjs")))
        src += readFileSync(R("tools", "checks", f), "utf8");
    } catch {}
    // JS 正则里出现 Python/PCRE 的转义是最常见的"静默失效"来源
    const pyEscapes = [...src.matchAll(/\\([ZAGzKQRh])/g)];
    let pass = true;
    for (const m of pyEscapes) { report.fail(`发现 PCRE 独有转义 \\${m[1]} —— 在 JS 里它匹配字面量字符,不是锚点,是静默失效`); pass = false; }
    // catch 里吞掉一切
    const bareCatches = [...src.matchAll(/catch\s*\{\s*\}/g)];
    if (bareCatches.length > 6) { report.fail(`有 ${bareCatches.length} 处空 catch —— 吞掉错误等于让失败看起来像成功`); pass = false; }
    if (pass) report.pass("无静默失效(无 PCRE 转义 / 空 catch 受控)");
    return pass;
}

// R-17:参考系对照表里的路径必须真的存在 —— 引用失效的对照表比没有表更坏
export async function checkReferenceMap(report) {
    const { runReferenceMapCheck, resolveGsdRoot } = await import("../reference-map.mjs");
    return runReferenceMapCheck({ mapPath: R("skills","mm-gsd-loop","references","reference-map.md"), gsdRoot: resolveGsdRoot(), report });
}

// R-18:工件记账完整性 —— 「做完了却没记账」不许静默通过
export async function checkArtifactLedger(report) {
    const { checkArtifactLedger } = await import("../../skills/mm-gsd-loop/references/artifact-ledger.mjs");
    return checkArtifactLedger({ root: ROOT, report });
}

// R-19:预发布通道时效 —— next 不得比 latest 旧(通道腐烂的唯一方式)
export function checkReleaseTags(report) {
    return checkTags(report);
}

// R-21:执行端只照施工图施工 —— 研究落盘了没人读 = 执行端会自己重查一遍。判据是工件事实不是散文:phase 有 *-RESEARCH.md + 活票没引用它 → 判红。实现放在 references/(mmc 只剩十几行头寸),这里只接线。
export async function checkResearchConsumed(report) {
    const { checkResearchConsumedAll } = await import("../../skills/mm-gsd-loop/references/research-gates.mjs");
    return checkResearchConsumedAll({ root: ROOT, report });
}

// R-20:改外部发布通道必须显式 —— promote 默认只演练;发版只落 next,latest 只能由 promote 显式动。
// 为什么:改 npm 的 dist-tag 是外部副作用,「批 promote」是人保留的动作(03-CONTEXT D-04);promote 一旦默认就真跑。
// 这里不查源码查行为:注入一个会记账的假 exec,断言默认路径一次 registry 都没碰。
// 发版那一半:npm publish 默认落 latest —— 「发个版」会把正式通道一起带走,而 latest 的语义是「最稳那条」
// (03-CONTEXT D-01)。2026-10-22 真发 0.4.1 时就是这么发生的:latest 从 0.4.0 跳到 0.4.1,收尾文案却写着「latest 未动」。
// 断言的是命令本身(构造与调用是同一处),不是某句文案。
// R-24:票面 wave 是 DAG 推导的缓存不是真相源(28-13)。只判 active_phase 的活票(D-14:收口票退出全部门禁)。
export function checkWaveFromDag(report) {
    let active = null;
    try {
      const m = readFileSync(R(".planning", "STATE.md"), "utf8").match(/^active_phase:\s*"?(\d+)"?/m);
      if (m) active = m[1];
    } catch { /* 无 STATE:判不了不猜 */ }
    if (!active) { report.info("没有 active_phase —— wave 推导门不适用(冷启动前无票可判)"); return true; }
    const dir = R(".planning");
    const names = existsSync(dir) ? readdirSync(dir).filter((n) => new RegExp("^" + active + "-\\d+-PLAN\\.md$").test(n)) : [];
    if (!names.length) { report.info("phase " + active + " 没有 PLAN —— wave 推导门不适用"); return true; }
    const plans = [];
    const coveredIds = new Set();
    for (const n of names) {
      const id = n.replace(/-PLAN\.md$/, "");
      let covered = false;
      try {
        covered = /^status:\s*complete/m.test(readFileSync(R(".planning", id + "-SUMMARY.md"), "utf8"));
      } catch { /* 无 SUMMARY = 未收口,照判 */ }
      // 收口票进推导宇宙(它是别人依赖的图锚),只豁免判红(D-14:门只对活票判)
      if (covered) coveredIds.add(id);
      const fm = readFileSync(R(".planning", n), "utf8").split(/^---$/m)[1] ?? "";
      const waveM = fm.match(/^wave:\s*(\d+)\s*$/m);
      const depM = fm.match(/^depends_on:\s*(.+)$/m);
      plans.push({ id, wave: waveM ? Number(waveM[1]) : null, depends: depM ? (depM[1].match(/\d+-\d+/g) ?? []) : [] });
    }
    const derived = deriveWaves(plans);
    let pass = true;
    for (const p of plans) {
      if (coveredIds.has(p.id)) continue;
      if (p.wave !== null && derived.get(p.id) !== p.wave) {
        report.fail(p.id + ": wave 手写 " + p.wave + " ≠ DAG 推导 " + derived.get(p.id) + " —— 次序从 depends_on 推导;要改顺序就改 depends_on,不是改 wave");
        pass = false;
      }
    }
    if (pass) report.pass("wave 与 DAG 推导一致(" + (plans.length - coveredIds.size) + " 张活票)");
    return pass;
}

// R-25:预审只审判断题(28-11)——分类降级的接线必须活着,剥掉即红
export function checkReviewScope(report) {
    const src = readFileSync(R("skills", "mm-gsd-loop", "references", "plan-ready.mjs"), "utf8");
    let pass = true;
    for (const mark of ["MACHINE-CLASSIFIABLE", "MACHINE_SIGNS", "classifyArtifactBlockers"]) {
      if (!src.includes(mark)) { report.fail("plan-ready.mjs 丢了 " + mark + " —— 预审工件里的机器可判发现会重新混进拦工(R-25 被掏空)"); pass = false; }
    }
    if (pass) report.pass("机器可判发现分类降级接线在位(plan-ready.mjs)");
    return pass;
}

// R-26:收敛单位是 phase,计数不降即停转人(28-11)
export function checkReviewConvergence(report) {
    const src = readFileSync(R("skills", "mm-gsd-loop", "references", "plan-ready.mjs"), "utf8");
    let pass = true;
    for (const mark of ["readPhaseConvergence", "REVIEW-CONVERGENCE-STALLED", "PHASE_CONVERGENCE_REQUIRED_FROM"]) {
      if (!src.includes(mark)) { report.fail("plan-ready.mjs 丢了 " + mark + " —— phase 级收敛被掏空"); pass = false; }
    }
    if (pass) {
      let active = null;
      try {
        const m = readFileSync(R(".planning", "STATE.md"), "utf8").match(/^active_phase:\s*"?(\d+)"?/m);
        if (m) active = m[1];
      } catch { /* 无 STATE:活检不适用 */ }
      if (active && existsSync(R(".planning"))) {
        const conv = [];
        for (const n of readdirSync(R(".planning"))) {
          if (!n.startsWith(active + "-REVIEW-CONVERGENCE") || !n.endsWith(".md")) continue;
          const fm = readFileSync(R(".planning", n), "utf8").split(/^---$/m)[1] ?? "";
          const rm = fm.match(/^round:\s*(\d+)\s*$/m), nm = fm.match(/^new_judgment:\s*(\d+)\s*$/m);
          if (rm && nm) conv.push({ round: Number(rm[1]), nj: Number(nm[1]) });
        }
        conv.sort((a, b) => a.round - b.round);
        for (let i = 1; i < conv.length; i++) {
          if (conv[i].nj >= conv[i - 1].nj) {
            report.fail("phase " + active + " 的预审收敛停滞(round " + conv[i].round + " 的 new_judgment 未低于上一轮)—— 升级到人拍板,不要再开一轮");
            pass = false;
          }
        }
      }
    }
    if (pass) report.pass("phase 级收敛接线在位,无停滞序列");
    return pass;
}

// R-27:票据体量真门禁(28-10 落地口径,此处对活票活检)
export async function checkTicketSize(report) {
    const { parsePlan, BUDGET, SIZE_EXEMPT } = await import("../../skills/mm-gsd-loop/references/plan-review-gate.mjs");
    let active = null;
    try {
      const m = readFileSync(R(".planning", "STATE.md"), "utf8").match(/^active_phase:\s*"?(\d+)"?/m);
      if (m) active = m[1];
    } catch { /* 无 STATE:活检不适用 */ }
    if (!active) { report.info("没有 active_phase —— 体量门活检不适用"); return true; }
    const dir = R(".planning");
    let pass = true, checked = 0;
    if (existsSync(dir)) {
      for (const n of readdirSync(dir)) {
        if (!n.startsWith(active + "-") || !n.endsWith("-PLAN.md")) continue;
        const id = n.replace(/-PLAN\.md$/, "");
        if (SIZE_EXEMPT.has(id)) continue;
        let covered = false;
        try { covered = /^status:\s*complete/m.test(readFileSync(R(".planning", id + "-SUMMARY.md"), "utf8")); } catch { /* 未收口照判 */ }
        if (covered) continue;
        const { tasks } = parsePlan(readFileSync(R(".planning", n), "utf8"));
        for (const t of tasks) {
          const bytes = Buffer.byteLength(String(t.labels.verify ?? ""), "utf8");
          if (bytes > BUDGET.verifyBytes) {
            report.fail(id + " " + t.id + ": verify " + bytes + " 字节 > " + BUDGET.verifyBytes + " —— 夹具落自测,verify 只跑它");
            pass = false;
          }
        }
        checked++;
      }
    }
    if (pass) report.pass("活票 verify 体量全部在预算内(" + checked + " 张)");
    return pass;
}

// R-28:核心不许知道可选包(28-04,D-09/REQ-60)—— 判据权威在 references/core-boundary.mjs
export async function checkCoreBoundary(report) {
    const { checkCoreBoundaryAll } = await import("../../skills/mm-gsd-loop/references/core-boundary.mjs");
    return checkCoreBoundaryAll({ root: ROOT, report });
}

// R-29:discuss 落 REQ 前必须深挖(28-07,D-13/REQ-63)—— 判据权威在 references/requirement-mining.mjs
export async function checkRequirementMining(report) {
    const { checkRequirementMiningAll } = await import("../../skills/mm-gsd-loop/references/requirement-mining.mjs");
    return checkRequirementMiningAll({ root: ROOT, report });
}

// R-30:模板里的脚本必须真能跑 —— 判据权威在 references/web-template-gate.mjs
export async function checkWebTemplateJs(report) {
    const { checkWebTemplateJsAll } = await import("../../skills/mm-gsd-loop/references/web-template-gate.mjs");
    return checkWebTemplateJsAll({ root: ROOT, report });
}

// R-31:update 必须映射 registry 上的最新版 —— 判据权威在 references/update-gate.mjs
export async function checkUpdateMapsLatest(report) {
    const { checkUpdateMapsLatest } = await import("../../skills/mm-gsd-loop/references/update-gate.mjs");
    return checkUpdateMapsLatest({ root: ROOT, report });
}

export async function checkChannelSafety(report) {
    const { makeReleaseFlow, publishArgs } = await import("../release-flow.mjs");
    const calls = [];
    const fakeTags = { ok: true, tags: { latest: "0.0.0", next: "0.0.0" } };
    const flow = makeReleaseFlow({
      log: () => {}, ok: () => {}, bad: (m) => report.fail(m), warn: () => {}, head: () => {},
      C: { d: "", x: "" }, health: async () => 0,
      exec: (cmd, args) => { calls.push([cmd, ...(args ?? [])]); return ""; },
      readTags: () => fakeTags,
    });
    const dry = await flow.promote(["9.9.9"]);
    if (dry !== 0) { report.fail(`promote 默认演练返回 ${dry}(应为 0)—— 默认路径坏了`); return false; }
    if (calls.length) {
      report.fail(`promote 不带 --execute 竟然真的调了 ${JSON.stringify(calls[0])} —— 默认必须只演练,改公开标签得显式 --execute`);
      return false;
    }
    report.pass("promote 默认只演练,不带 --execute 一次 registry 都没碰");
    const real = await flow.promote(["9.9.9", "--execute"]);
    const tagged = calls.find((c) => c[0] === "npm.cmd" && c[1] === "dist-tag" && c[2] === "add");
    if (!tagged) { report.fail("promote --execute 没有发出 dist-tag add —— 晋级路径断了"); return false; }
    if (real !== 0) { report.fail(`promote --execute 返回 ${real}(应为 0)`); return false; }
    report.pass("promote --execute 才会真的改标签(" + tagged.slice(2).join(" ") + ")");
    // 发版:publish 必须钉 next。少了它,npm 默认落 latest —— 正式通道被顺手带走。
    const pub = publishArgs();
    const tagAt = pub.indexOf("--tag");
    if (tagAt < 0 || pub[tagAt + 1] !== "next") {
      report.fail(`发版的 publish 命令没钉 next(${JSON.stringify(pub)})—— latest 是给不想读文档的人的默认,发版不许把它带走(03-CONTEXT D-01)`);
      return false;
    }
    report.pass("发版只落 next 通道,latest 不动(publish " + pub.join(" ") + ")");
    return true;
}
