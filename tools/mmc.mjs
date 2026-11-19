#!/usr/bin/env node
// mmc — mm-gsd-core 的自我维护 CLI
//
// 核心循环(每次改动都走一遍,别跳):
//   observe  读遥测找重复失败       → 发现问题
//   issue    带证据转 issue          → 问题可追溯
//   fix      最小改动 + 复现用例     → 问题解决
//   distill  复盘 → 规则/理论条目     → 经验落地
//   health   门禁生效(快检 --fast / 全量) → 预算/台账/自检/零依赖/模式顺序
//
// 零依赖,跨平台(Windows)。用法:mmc.mjs <命令> [参数]

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync, appendFileSync, rmSync, cpSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { missingRules, BASELINE_RULES } from "./rule-baseline.mjs";
import { MAIN_FILE_BASELINE } from "./main-file-baseline.mjs";
import { checkArtifactLedger, checkBudget, checkChannelSafety, checkCoreBoundary, checkGateCases, checkGateSelftest, checkInstallTraceable, checkIssueEvidence, checkLedgerIntegrity, checkMainFileOwnership, checkModeOrdering, checkNoSilentNoop, checkPackageVerifiable, checkReferenceMap, checkReleaseTags, checkReportFailsLoud, checkReportReachable, checkRequirementMining, checkResearchConsumed, checkReviewConvergence, checkReviewScope, checkSyntaxAndModes, checkTemplatesSelfValidate, checkTicketSize, checkUpdateMapsLatest, checkWaveFromDag, checkWebTemplateJs, checkZeroDep } from "./checks/core-checks.mjs";
import { baselineDrift, deadGates, checkCardClaims, checkCardRefresh } from "./module-registry.mjs";
import { collectFiles, countLines } from "./budget.mjs";
import { fileURLToPath } from "node:url";
import { makeInboxClose, clusterKey, readLocalIssues, findRecurrences, recurrenceRate } from "./gh-issues.mjs";
import { makeReleaseFlow } from "./release-flow.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const R = (...s) => join(ROOT, ...s);
const HOME_SKILLS = join(homedir(), ".agents", "skills");
const MANIFEST_NAME = ".mm-gsd-install.json";
const CHECKER = R("skills", "mm-gsd-loop", "scripts", "gsd-state-check.mjs");
const TELEMETRY = process.env.GSD_TELEMETRY_PATH || join(homedir(), ".agents", "mm-gsd-runs.jsonl");
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

// budget.json 的 pattern 用 ** 通配,转成匹配器

// ---- 检查器组:ledger 里每条 active 规则挂的那一个 ----
// 慢门禁:要起子进程、装包、跑冷启动沙盒的那几条。
// 逐次提交跑全量太贵(实测 24.3 秒/次,见 phase 08-RESEARCH),所以 health 分两档:
// `--fast` 跳过这几条(但要**点名**跳过,不许悄悄不跑),全量留到批次与 phase 收尾。
const HEAVY = new Set(["check-syntax-and-modes", "check-package-verifiable", "check-install-traceable", "check-card-refresh"]);

const CHECKS = {
  // 每个成员都是一行式转发壳(phase 30 下沉):实现住 tools/checks/core-checks.mjs;
  // 键名与台账 rule.check 逐字一致;壳体保留 "checkXxx(" 形态 —— deadGates 的 alive 判据认它。
  "check-issue-evidence"(report) { return checkIssueEvidence(report); },
  "check-ledger-integrity"(report) { return checkLedgerIntegrity(report, Object.keys(CHECKS)); },
  "check-main-file-ownership"(report) { return checkMainFileOwnership(report); },
  async "check-budget"(report) { return checkBudget(report); },
  async "check-syntax-and-modes"(report) { return checkSyntaxAndModes(report); },
  "check-templates-self-validate"(report) { return checkTemplatesSelfValidate(report); },
  "check-package-verifiable"(report) { return checkPackageVerifiable(report); },
  "check-install-traceable"(report) { return checkInstallTraceable(report); },
  async "check-zero-dep"(report) { return checkZeroDep(report); },
  "check-report-reachable"(report) { return checkReportReachable(report); },
  "check-report-fails-loud"(report) { return checkReportFailsLoud(report); },
  "check-gate-selftest"(report) { return checkGateSelftest(report); },
  async "check-gate-cases"(report) { return checkGateCases(report, Object.keys(CHECKS)); },
  "check-mode-ordering"(report) { return checkModeOrdering(report); },
  "check-no-silent-noop"(report) { return checkNoSilentNoop(report); },
  async "check-reference-map"(report) { return checkReferenceMap(report); },
  async "check-artifact-ledger"(report) { return checkArtifactLedger(report); },
  "check-release-tags"(report) { return checkReleaseTags(report); },
  async "check-research-consumed"(report) { return checkResearchConsumed(report); },
  "check-card-claims"(report) { return checkCardClaims(report, ROOT); },
  "check-card-refresh"(report) { return checkCardRefresh(report, ROOT); },
  "check-wave-from-dag"(report) { return checkWaveFromDag(report); },
  "check-review-scope"(report) { return checkReviewScope(report); },
  "check-review-convergence"(report) { return checkReviewConvergence(report); },
  async "check-ticket-size"(report) { return checkTicketSize(report); },
  async "check-core-boundary"(report) { return checkCoreBoundary(report); },
  async "check-requirement-mining"(report) { return checkRequirementMining(report); },
  async "check-web-template-js"(report) { return checkWebTemplateJs(report); },
  async "check-update-maps-latest"(report) { return checkUpdateMapsLatest(report); },
  async "check-channel-safety"(report) { return checkChannelSafety(report); },
};
const pathBase = (p) => p.split("/").pop();

// ---- 命令 ----
const CMD = {
  // GitHub 往返在 tools/gh-issues.mjs(拆分理由见那个文件头),挂进来当普通命令
  ...makeInboxClose({ ISSUES, GH_BIN, log, ok, bad, warn, head, C }),

  // 1. 观察:读遥测找重复失败 —— 排行按版本分两段(phase 27 D-05):当前版本还活着的在前,
  //    更早版本的累计折叠成一行。旧记录不是噪声(是事实),但排第一的应该是「现在还会再发生」的事。
  async observe() {
    head("① observe —— 读遥测找重复失败");
    if (!existsSync(TELEMETRY)) { warn(`还没有遥测:${TELEMETRY}`); log("  检查器每跑一次会自动记一行;跑一次任意模式即产生。\n"); return 0; }
    const rows = readFileSync(TELEMETRY, "utf8").split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    // 自测沙盒里的失败是**故意造的**(门禁自测要证明自己会红),混进排行会淹掉真问题。
    // 检查器早就给这些行打了 sandbox 标记,这里第一次真正用它。
    const bad = rows.filter((r) => r.exit === 1 && !r.sandbox);
    // 版本分桶(phase 27 D-04/D-05):观察方与写记录方共用同一份版本解析(skills/.../version.mjs)。
    const { mmGsdVersion, splitByVersion } = await import("../skills/mm-gsd-loop/references/version.mjs");
    const curVer = mmGsdVersion(dirname(fileURLToPath(import.meta.url)));
    const { cur, old } = splitByVersion(bad, curVer);
    const cluster = (list) => {
      const groups = {};
      for (const r of list) for (const m of r.errors ?? []) {
        // 聚类口径用共享函数:复发判定要用同一把尺子(见 gh-issues.mjs 的 clusterKey)
        const k = clusterKey(m);
        (groups[k] ??= { count: 0, projects: new Set(), sample: m, modes: new Set() });
        groups[k].count++; groups[k].projects.add(r.cwd); groups[k].modes.add(r.mode);
      }
      return Object.entries(groups).sort((a, b) => b[1].count - a[1].count);
    };
    const curList = cluster(cur);
    const oldList = cluster(old);
    // 旧版本段的「版本×次数」按失败行数计,缺 ver 的老行记 unknown(它们来自更早的版本,不许回填)
    const oldVers = {};
    for (const r of old) { const v = r.ver ?? "unknown"; oldVers[v] = (oldVers[v] ?? 0) + 1; }
    const versTxt = Object.entries(oldVers).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([v, n]) => `${v}×${n}`).join(", ");
    log(`  遥测 ${rows.length} 次运行,其中门禁失败 ${bad.length} 次(自测沙盒的失败不计):当前版本 ${curVer} —— ${cur.length} 次 / ${curList.length} 类;更早的版本 —— ${old.length} 次 / ${oldList.length} 类\n`);
    if (curList.length) log(`  当前版本(${curVer})还活着的:`);
    let i = 0;
    for (const [k, g] of curList.slice(0, 8)) {
      const cross = g.projects.size > 1 ? `(跨 ${g.projects.size} 个项目 → 系统性问题)` : `(仅 ${[...g.projects][0]})`;
      const hot = g.projects.size >= 1 && g.count >= 3 ? " ← 重复失败,值得转 issue" : "";
      log(`  ${String(++i).padStart(2)}. ${g.count}× ${k}\n      ${cross};模式:${[...g.modes].join(",")}${hot}`);
      log(`      ${C.d}原文:${g.sample.slice(0, 90)}${C.x}`);
    }
    if (!curList.length) log(`  当前版本(${curVer})没有失败记录`);
    if (old.length) {
      log(`  旧版本累计: ${old.length} 次 / ${oldList.length} 类(${versTxt})—— 多半已随升级修掉,升级后重跑一次门禁这里会重置`);
      for (const [k, g] of oldList.slice(0, 3)) log(`      · ${k} ×${g.count}`);
    }
    if (!curList.length && !oldList.length) log("  没有失败记录\n");

    // 复发(phase 03 D-03):关掉的 issue 不再是终态 —— 同一根因又出现就把它拉回来。
    const local = readLocalIssues(ISSUES);
    const recs = findRecurrences(local, rows);
    if (recs.length) {
      log(`\n  ♻ 复发 ${recs.length} 条(关掉之后又以同一把尺子出现):`);
      for (const r of recs) {
        const num = r.issue.github;
        // 每条都要说清「因哪类失败被拉回来」—— 只给 issue 编号,人还得自己回去翻是哪类
        const why = `因「${r.key}」复发 ${r.count} 次`;
        if (!num) { log(`  ${r.issue.id}: ${why} —— 但它没有 github: 行,拉不回远端,本地标记备查`); }
        else if (!GH_BIN) { warn(`${r.issue.id}: ${why} —— 没有 gh 命令,拉不回远端`); }
        else {
          try {
            execFileSync(GH_BIN, ["issue", "reopen", String(num), "--comment",
              `同一个根因又出现了(${r.count} 次,最近 ${String(r.lastSeen).slice(0, 10)})。按约定:close 不是终态,复发即拉回。\n\n---\n本条由 \`mmc observe\` 检测到复发 → 自动 reopen。对应本地 ${r.issue.id}。`],
              { encoding: "utf8", stdio: "pipe" });
            ok(`GitHub #${num} 已拉回未解决(对应 ${r.issue.id},${why})`);
          } catch (e) { bad(`拉回 #${num} 失败:` + String(e.stderr || e.message).split("\n")[0]); }
        }
        // 本地状态也改回来 —— 两边状态不同步是常态,但本地不能还写着 closed
        const today = new Date().toISOString().slice(0, 10);
        writeFileSync(r.issue.path, r.issue.text
          // 先清掉旧的日期行,再写新的 —— 否则 closed_at 会写两遍
          .replace(/^(closed_at|recurred_at):.*\n?/gm, "")
          .replace(/^## 状态\s*\n\s*closed[^\n]*$/m, `## 状态\n\nreopened\nclosed_at: ${r.issue.closedAt}\nrecurred_at: ${today}`));
      }
    }

    // 唯一那个刷不上去的数(phase 03 D-05)
    // 重新读一次:刚复发的 issue 已经被写上 recurred_at,拿旧快照算会把这次复发漏掉
    const rate = recurrenceRate(readLocalIssues(ISSUES));
    log(`\n  同一根因二次出现率:${rate.recurred}/${rate.closed}`
      + (rate.rate === null ? "(样本不足 5,只报原始数 —— 一个样本能刷出 100%)" : ` = ${(rate.rate * 100).toFixed(0)}%`));
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
    log(`    2. 修完之后系统变大了吗?${C.d}体积只报不拦(hard cap 已退役,见 docs/theory.md T-16)—— 大不是罪,看不懂才是${C.x}`);
    log(`    3. 这条经验是通用的,还是只对当前实现成立?通用的进 rules,只对实现成立的留在 git history 里就够了。`);
    log(`\n  理论文档:docs/theory.md   复盘模板:docs/lessons/TEMPLATE.md\n`);
    return 0;
  },

  // 5. 体检:逐次提交跑快检(--fast),批次与 phase 收尾跑全量
  async health(args) {
    const fast = (args ?? []).includes("--fast");
    head(fast ? "⑤ health —— 门禁体检(快检:跳过慢门禁;全量留到批次/phase 收尾)" : "⑤ health —— 门禁体检(全量)");
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
    let failed = 0, ran = 0, skipped = 0;
    for (const r of led.rules ?? []) {
      if (r.status !== "active" || !r.check) continue;
      const fn = CHECKS[r.check];
      if (!fn) { bad(`${r.id}: check "${r.check}" 不存在`); failed++; continue; }
      if (fast && HEAVY.has(r.check)) { skipped++; log(`  ${C.d}${r.id} 跳过(快检模式:慢门禁,留到全量)${C.x}`); continue; }
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
    ok(`${ran} 条规则门禁全通过` + (skipped ? `(${skipped} 条慢门禁在快检里跳过 —— 批次与 phase 收尾要跑全量)` : ""));
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
  // 主文件别再涨:发布流程的细节(打 tag、推 tag、验 tag)自成一份,留在主文件里只会让它读不下去。
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
  ${C.b}health${C.x}    体检:台账/预算/模板自检/零依赖/模式顺序   ${C.d}--fast 只跑快检;全量留到批次/phase 收尾${C.x}
  ${C.b}budget${C.x}    只看体积预算

${C.d}核心循环:observe → issue → fix → distill →(下次 observe)
每轮必须让系统净复杂度不增:变胖要有等量删除。${C.x}
`);
  process.exit(0);
}
if (!CMD[cmd]) { bad(`未知命令 ${cmd}`); process.exit(1); }
process.exit(await CMD[cmd](args.slice(1)));
