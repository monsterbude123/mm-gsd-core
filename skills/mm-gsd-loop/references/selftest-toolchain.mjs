// 自测族模块(phase 30 D-OV-2 从 gate-selftest.mjs 拆出):bin 工具链族(cwd 契约 / 红窗 / 批闸 lint / update / stage / summary / commit / wave-check / scope 门禁 / notes schema)—— 真仓 + spawn 实跑
// 断言工具由 runSelfTest 显式传入(不自建 —— 失败数必须聚合到同一个 st);
// 时序契约(遥测隔离/env 还原)仍由 runSelfTest 统一持有,本文件不做环境操作。

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkBatchVerifyLints } from "../references/verification-gates.mjs";

const CHECKER = fileURLToPath(new URL("../scripts/gsd-state-check.mjs", import.meta.url));

export function runToolchainCases(t) {
  const { eq, eqN, eqArr } = t;

  // ---- cwd 契约(phase 14 D-01,#16):命令量错树判红;缺字段提示;一致/子目录/$VAR 不误伤 ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-cwd-"));
    mkdirSync(join(d, ".planning"), { recursive: true });
    writeFileSync(join(d, "a.mjs"), "x\n");
    const p = join(d, ".planning", "14-01-PLAN.md");
    const mk = (fmExtra, tickets) => '---\nphase: "14"\nplan: "01"\ngoal: g\nrollback: r\nfiles_modified:\n  - a.mjs\ndepends_on: []\n' + fmExtra + '---\n\n'
      + tickets.map((v, i) => '### T' + (i + 1) + ' 事\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 做\n- **verify**: ' + v + '\n- **fails_when**: 退出码非 0(无 ok)\n- **done**: ok\n').join("\n");
    const run = () => { let out = "", code = 0;
      try { out = execFileSync(process.execPath, [CHECKER, "--plan", p], { cwd: d, encoding: "utf8", stdio: "pipe" }); }
      catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
      return { out, code }; };
    writeFileSync(p, mk("cwd: .worktrees/p33\n", ["cd /workspace/app && node a.mjs"]));
    let r = run();
    eqN(r.code === 1 && r.out.includes("命令量错树"), true, "cwd 不一致判红(命令量错树)");
    writeFileSync(p, mk("", ["cd /workspace/app && node a.mjs"]));
    r = run();
    eqN(r.code === 0 && r.out.includes("cwd 缺省"), true, "cwd 缺省有 cd → 提示补字段");
    writeFileSync(p, mk("cwd: .worktrees/p33\n", ["cd .worktrees/p33/ && node a.mjs", "cd .worktrees/p33/sub && node a.mjs", "cd $TREE && node a.mjs"]));
    r = run();
    eqN(r.code === 0 && !r.out.includes("命令量错树"), true, "cwd 一致/前缀子目录/$VAR 不误伤");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- 红窗兑现票(phase 14 D-02,#18):red_windows 条目缺 ticket 判红;补票转绿 ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-redw-"));
    mkdirSync(join(d, ".planning"), { recursive: true });
    writeFileSync(join(d, "a.mjs"), "x\n");
    const p = join(d, ".planning", "14-01-PLAN.md");
    const fm = '---\nphase: "14"\nplan: "01"\ngoal: g\nrollback: r\nfiles_modified:\n  - a.mjs\ndepends_on: []\nbatch_verify: node --test a.mjs\nred_windows:\n  - guards/a.guard.mjs | wave 2 | ticket 14-01 | close: 本票 verify 转绿\n  - guards/b.guard.mjs | wave 3 | close: 没写兑现票\n---\n\n';
    const body = '### T1 事\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 做\n- **verify**: node a.mjs\n- **fails_when**: 退出码非 0(无 ok)\n- **done**: ok\n';
    const run = () => { let out = "", code = 0;
      try { out = execFileSync(process.execPath, [CHECKER, "--plan", p], { cwd: d, encoding: "utf8", stdio: "pipe" }); }
      catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
      return { out, code }; };
    writeFileSync(p, fm + body);
    let r = run();
    eqN(r.code === 1 && r.out.includes("红窗缺兑现票"), true, "红窗缺兑现票 → 判红(防永久豁免)");
    writeFileSync(p, fm.replace("| wave 3 | close: 没写兑现票", "| wave 3 | ticket 14-01 | close: 补上兑现票") + body);
    r = run();
    eqN(r.code === 0, true, "红窗补上兑现票 → 转绿");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- 批闸形状 lint(phase 14 D-03,#17):裸无界目录报 WARNING;有界形状不误报 ----
  eqN(checkBatchVerifyLints("npm test -- tests/").length, 1, "lint 命中无界批闸目录(报 WARNING)");
  eqN(checkBatchVerifyLints("npm test -- src").length, 1, "lint 命中无界批闸目录(报 WARNING)—— 无尾斜杠裸目录也算(预审 I7)");
  eqN(checkBatchVerifyLints("vitest run ./tests").length, 1, "lint 命中无界批闸目录(报 WARNING)—— ./ 前缀归一后判(预审 I7)");
  eqN(checkBatchVerifyLints("node --test a.mjs && npm test -- tests").length, 1, "lint 命中无界批闸目录(报 WARNING)—— 多命令段各自判");
  eqN(checkBatchVerifyLints("npm test -- tests/unit/x.test.mjs").length, 0, "有界批闸不误报(具名文件)");
  eqN(checkBatchVerifyLints("npm test -- tests/unit/").length, 0, "有界批闸不误报(子目录树,深度 ≥2)");
  eqN(checkBatchVerifyLints("vite build --out build/").length, 0, "有界批闸不误报(flag 值形态不判,预审 I7)");
  eqN(checkBatchVerifyLints("npm run build").length, 0, "有界批闸不误报(裸脚本词不是目录参数)");
  eqN(checkBatchVerifyLints("cd /tmp && npm test -- tests").length, 1, "cd 目标豁免不外溢:-- 后的无界目录照判");
  eqN(checkBatchVerifyLints("").length, 0, "空 batch_verify 不报");
  // 带参多子目录批闸(35-01 T2):引号内的多词参数是一个 token,不拆成裸目录误红
  eqN(checkBatchVerifyLints('npm test -- tests/unit tests/integration --grep "case one two"').length, 0, "带参多子目录批闸不误红:引号内多词过滤器不是目录");
  eqN(checkBatchVerifyLints('npm test -- --grep "auth test"').length, 0, "引号内过滤参数不是目录");
  eqN(checkBatchVerifyLints('npm test -- --grep "auth test" tests/').length, 1, "引号参数不豁免真无界目录(判别力保持)");
  // ---- update 机械覆盖(用户指令:更新零判断) ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-upd-"));
    mkdirSync(join(d, ".zcode", "agents"), { recursive: true });
    mkdirSync(join(d, ".agents", "skills", "mm-gsd-plan"), { recursive: true });
    writeFileSync(join(d, ".agents", "skills", "mm-gsd-plan", "OLD.txt"), "stale");
    writeFileSync(join(d, ".zcode", "agents", "mm-gsd-plan.md"), "user content");
    const BIN = fileURLToPath(new URL("../../../bin/mm-gsd.mjs", import.meta.url));
    let code = 0;
    try { execFileSync(process.execPath, [BIN, "update", "--home", d], { stdio: "pipe" }); }
    catch (e) { code = e.status ?? 1; }
    eqN(code, 0, "update 退出码 0(零提问)");
    eqN(existsSync(join(d, ".agents", "skills", "mm-gsd-plan", "SKILL.md")) && !existsSync(join(d, ".agents", "skills", "mm-gsd-plan", "OLD.txt")), true, "update 机械覆盖:技能整删重拷,旧文件不残留");
    eqN(readFileSync(join(d, ".zcode", "agents", "mm-gsd-plan.md"), "utf8").includes("别在本卡里找规则"), true, "update 宿主卡无条件刷新(不接管判断)");
    eqN(existsSync(join(d, ".zcode", "agents", "mm-gsd-plan-reviewer.md")) && existsSync(join(d, ".agents", "skills", ".mm-gsd-install.json")), true, "update 复核卡与版本清单齐");
    let code2 = 0;
    try { execFileSync(process.execPath, [BIN, "update", "--home", d], { stdio: "pipe" }); }
    catch (e) { code2 = e.status ?? 1; }
    eqN(code2, 0, "update 幂等(二次执行仍 0)");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- stage 工具(phase 14 D-04,#19):literal pathspec 与不存在路径跳过,都要真仓用例 —— 使用方的 CRLF+[locale] bug 毁过提交 ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-stage-"));
    const sh = (args) => { const r = spawnSync("git", args, { cwd: d, encoding: "utf8" }); if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr); return r.stdout; };
    sh(["init", "-q"]); sh(["config", "user.name", "t"]); sh(["config", "user.email", "t@t"]);
    mkdirSync(join(d, "src", "app", "[locale]"), { recursive: true });
    writeFileSync(join(d, "src", "app", "[locale]", "a.css"), "x\n");
    mkdirSync(join(d, ".planning"), { recursive: true });
    // files_modified 用 CRLF 行尾(使用方踩的坑)且含 [locale] 形状路径;docs/not-yet.md 不存在也不在索引
    writeFileSync(join(d, ".planning", "14-01-PLAN.md"), '---\r\nphase: "14"\r\nplan: "01"\r\nfiles_modified:\r\n  - src/app/[locale]/a.css\r\n  - docs/not-yet.md\r\n---\r\n\r\n### T1 事\r\n- **files**: src/app/[locale]/a.css\r\n- **read_first**: src/app/[locale]/a.css\r\n- **action**: 做\r\n- **verify**: node a.mjs\r\n- **fails_when**: 退出码非 0\r\n- **done**: ok\r\n');
    const STAGE = fileURLToPath(new URL("../../mm-gsd-exec/scripts/mm-gsd-stage.mjs", import.meta.url));
    const runTool = (script, args) => { const r = spawnSync(process.execPath, [script, ...args], { cwd: d, encoding: "utf8" }); return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") }; };
    const r1 = runTool(STAGE, ["--ticket", "14-01"]);
    // phase 36(REQ-75/D-01):stage 改走票级隔离索引 —— 暂存视图从工具自己的输出看,共享主索引零写入
    eqN(r1.code === 0 && r1.out.includes("A  src/app/[locale]/a.css") && sh(["diff", "--cached", "--name-only"]).trim() === "", true, "stage 按票面 literal 暂存走隔离索引(共享主索引零写入)");
    eqN(r1.code === 0 && r1.out.includes("跳过"), true, "stage 对不存在路径跳过不报错");
    // ---- R 票票号格式孪生(36-R1,I-023):正则认点修 <NN>-Rk;常规 NN-MM 零变化;杂牌照拒 ----
    writeFileSync(join(d, "c.txt"), "c\n");
    const mkT = (n) => writeFileSync(join(d, ".planning", `${n}-PLAN.md`), `---\nphase: "${n.split("-")[0]}"\nplan: "${n.split("-")[1]}"\nfiles_modified:\n  - c.txt\n---\n\n### T1 事\n- **files**: c.txt\n`);
    mkT("13-R1"); mkT("07-R1"); mkT("12-34");
    const tR1 = runTool(STAGE, ["--ticket", "13-R1"]);
    eqN(tR1.code === 0 && tR1.out.includes("暂存 1/1"), true, "stage 票号认点修 R 票格式(13-R1)");
    const tR2 = runTool(STAGE, ["--ticket", "07-R1"]);
    eqN(tR2.code === 0 && tR2.out.includes("暂存 1/1"), true, "stage 票号认点修 R 票格式(07-R1)");
    const tMM = runTool(STAGE, ["--ticket", "12-34"]);
    eqN(tMM.code === 0 && tMM.out.includes("暂存 1/1"), true, "stage 常规票号 12-34 照旧认(行为零变化)");
    const tBad = runTool(STAGE, ["--ticket", "abc"]);
    eqN(tBad.code === 1 && tBad.out.includes("用法"), true, "stage 杂牌票号 abc 照拒");
    // ---- summary 工具(phase 14 D-04/D-05,#19):scope 精确 / 前缀兜底 WARN / 拒绝覆盖,同一真仓 fixture ----
    const commit = (m) => sh(["commit", "--allow-empty", "-q", "-m", m]);
    commit("feat(14-02): stage 工具");
    commit("fix(14-02): bin 转发");
    commit("chore: 提到 14-02 但没写 scope");   // 精确匹配不得把它算进去(--grep 子串就栽在这)
    commit("14-03 草稿:还没补 scope");          // 前缀兜底用例的靶子
    commit("fix(13-R1): R 票 scope 落地");       // R 票 scope 计数靶子(36-R2 孪生)
    const SUMMARY = fileURLToPath(new URL("../../mm-gsd-exec/scripts/mm-gsd-summary.mjs", import.meta.url));
    let r2 = runTool(SUMMARY, ["--ticket", "14-02"]);
    eqN(r2.code === 0 && readFileSync(join(d, ".planning", "14-02-SUMMARY.md"), "utf8").includes("commits: 2") && !r2.out.includes("WARN"), true, "summary 按 scope 精确实测 commits");
    r2 = runTool(SUMMARY, ["--ticket", "14-03"]);
    eqN(r2.code === 0 && readFileSync(join(d, ".planning", "14-03-SUMMARY.md"), "utf8").includes("commits: 1") && r2.out.includes("WARN"), true, "summary 零命中按前缀兜底并 WARN");
    // ---- R 票票号格式孪生(36-R2,I-023):summary 正则认点修 <NN>-Rk;frontmatter split 出 plan:R1;常规照旧(上面 14-02/14-03 即锚);杂牌照拒 ----
    r2 = runTool(SUMMARY, ["--ticket", "13-R1"]);
    const s13 = readFileSync(join(d, ".planning", "13-R1-SUMMARY.md"), "utf8");
    eqN(r2.code === 0 && s13.includes('plan: "R1"') && s13.includes("commits: 1") && !r2.out.includes("WARN"), true, "summary 票号认点修 R 票格式(13-R1 scope 精确计数,frontmatter split 出 plan:R1)");
    r2 = runTool(SUMMARY, ["--ticket", "abc"]);
    eqN(r2.code === 1 && r2.out.includes("用法"), true, "summary 杂牌票号 abc 照拒");
    r2 = runTool(SUMMARY, ["--ticket", "14-02"]);
    eqN(r2.code === 1 && r2.out.includes("拒绝覆盖"), true, "summary 拒绝覆盖已存在");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- commit 工具(phase 14 D-02,#18):受限放行 —— 真仓 + core.hooksPath 必败钩子:清单内 FAST_PATH --no-verify 重试;清单外/提取空集 exit 2 停下 ----
  {
    const COMMIT = fileURLToPath(new URL("../../mm-gsd-exec/scripts/mm-gsd-commit.mjs", import.meta.url));
    const mkRepo = (hookBody, rwEntry, ticket = "14-01") => {
      const d = mkdtempSync(join(tmpdir(), "mm-gsd-cmt-"));
      const sh = (args) => { const r = spawnSync("git", args, { cwd: d, encoding: "utf8" }); if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr); return r.stdout; };
      sh(["init", "-q"]); sh(["config", "user.name", "t"]); sh(["config", "user.email", "t@t"]);
      let hooksPath = null;
      if (hookBody !== null) {
        hooksPath = join(d, "hooks"); mkdirSync(hooksPath, { recursive: true });
        writeFileSync(join(hooksPath, "pre-commit"), "#!/bin/sh\n" + hookBody + "\nexit 1\n");
      }
      mkdirSync(join(d, ".planning"), { recursive: true });
      writeFileSync(join(d, "a.mjs"), "x\n");
      writeFileSync(join(d, ".planning", `${ticket}-PLAN.md`), `---\nphase: "${ticket.split("-")[0]}"\nplan: "${ticket.split("-")[1]}"\nfiles_modified:\n  - a.mjs\ndepends_on: []\n` + rwEntry + '---\n\n### T1 事\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 做\n- **verify**: node a.mjs\n- **fails_when**: 退出码非 0\n- **done**: ok\n');
      sh(["commit", "--allow-empty", "-q", "-m", "init"]);   // 先落 init:hooksPath 还没配,必败钩子不拦空提交
      if (hooksPath) sh(["config", "core.hooksPath", hooksPath]);
      const run = () => { const r = spawnSync(process.execPath, [COMMIT, "--ticket", ticket, "--message", `feat(${ticket}): c1`], { cwd: d, encoding: "utf8" }); return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") }; };
      return { d, sh, run, clean: () => rmSync(d, { recursive: true, force: true }) };
    };
    const A = mkRepo(`echo "guard 'no-force-push'" >&2`, "red_windows:\n  - no-force-push | wave 2 | ticket 14-01 | close: 守卫修复票\n");
    let r = A.run();
    eqN(r.code === 0 && r.out.includes("FAST_PATH:失败项全部落在已登记红窗清单") && A.sh(["rev-list", "--count", "HEAD"]).trim() === "2", true, "commit 清单内失败走快路径(--no-verify 重试)");
    A.clean();
    const B = mkRepo(`echo "guard 'no-force-push'" >&2`, "red_windows:\n  - other-guard | wave 2 | ticket 14-01 | close: 别的守卫\n");
    r = B.run();
    eqN(r.code === 2 && r.out.includes("清单外") && B.sh(["rev-list", "--count", "HEAD"]).trim() === "1", true, "commit 清单外失败 exit 2 停下(真缺陷,不提交)");
    B.clean();
    const C = mkRepo("echo boom >&2", "");
    r = C.run();
    eqN(r.code === 2 && r.out.includes("UNPARSEABLE_FAILURE"), true, "commit 提取空集 UNPARSEABLE_FAILURE exit 2 停下(空集 ⊆ 清单恒真,绝不当全部命中)");
    C.clean();
    const D = mkRepo(null, "");
    r = D.run();
    eqN(r.code === 0 && !r.out.includes("FAST_PATH") && D.sh(["rev-list", "--count", "HEAD"]).trim() === "2", true, "commit 正常提交优先(无守卫拦截时不走 --no-verify)");
    D.clean();
    // ---- R 票票号格式孪生(36-R1,I-023):commit 同族正则认 R 票(正常通道提交落地);杂牌照拒 ----
    const E = mkRepo(null, "", "13-R1");
    r = E.run();
    eqN(r.code === 0 && E.sh(["rev-list", "--count", "HEAD"]).trim() === "2", true, "commit 票号认点修 R 票格式(13-R1 正常通道提交落地)");
    E.clean();
    const cBad = (() => { const s = spawnSync(process.execPath, [COMMIT, "--ticket", "abc", "--message", "x"], { cwd: tmpdir(), encoding: "utf8" }); return { code: s.status, out: String(s.stdout || "") + String(s.stderr || "") }; })();
    eqN(cBad.code === 1 && cBad.out.includes("用法"), true, "commit 杂牌票号 abc 照拒");
  }
  // ---- wave-check 工具(phase 14 D-03/D-04,#17):生成脚本以 cd 头;--baseline 差分摘要(只呈现,不归因) ----
  {
    const WAVE = fileURLToPath(new URL("../../mm-gsd-exec/scripts/mm-gsd-wave-check.mjs", import.meta.url));
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-wv-"));
    mkdirSync(join(d, ".planning"), { recursive: true });
    const fm = (plan, cwd, bv) => '---\nphase: "14"\nplan: "' + plan + '"\nwave: 2\n' + (cwd ? "cwd: " + cwd + "\n" : "") + 'depends_on: []\nbatch_verify: ' + bv + '\n---\n\n### T1 事\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 做\n- **verify**: node a.mjs\n- **fails_when**: 退出码非 0\n- **done**: ok\n';
    const run = (args) => { const r = spawnSync(process.execPath, [WAVE, ...args], { cwd: d, encoding: "utf8" }); return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") }; };
    writeFileSync(join(d, ".planning", "14-01-PLAN.md"), fm("01", ".worktrees/w2", "echo hi"));
    let r = run(["--phase", "14", "--wave", "2", "--dry"]);
    eqN(r.code === 0 && r.out.startsWith("cd '.worktrees/w2'"), true, "wave-check 生成脚本以 cwd 开头");
    writeFileSync(join(d, ".planning", "14-01-PLAN.md"), fm("01", "", "node w.mjs"));
    writeFileSync(join(d, ".planning", "14-02-PLAN.md"), fm("02", "", "node ok.mjs"));
    writeFileSync(join(d, "w.mjs"), "process.exit(1);\n");
    writeFileSync(join(d, "ok.mjs"), "process.exit(0);\n");
    const base = mkdtempSync(join(tmpdir(), "mm-gsd-wvb-"));
    writeFileSync(join(base, "w.mjs"), "process.exit(0);\n");
    writeFileSync(join(base, "ok.mjs"), "process.exit(0);\n");
    r = run(["--phase", "14", "--wave", "2", "--baseline", base]);
    eqN(r.code === 1 && r.out.includes("差分摘要") && r.out.includes("本批独有红") && r.out.includes("14-01") && r.out.includes("基线独有红"), true, "wave-check --baseline 出差分摘要");
    rmSync(d, { recursive: true, force: true }); rmSync(base, { recursive: true, force: true });
  }
  // ---- wave-check 健壮性(phase 15 D-01):单引号路径转义 + 多行 batch_verify,读取/门禁/执行三处视图一致 ----
  {
    const WAVE = fileURLToPath(new URL("../../mm-gsd-exec/scripts/mm-gsd-wave-check.mjs", import.meta.url));
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-wv15-"));
    mkdirSync(join(d, ".planning"), { recursive: true });
    mkdirSync(join(d, ".worktrees", "it's q"), { recursive: true });   // 含单引号与空格的 cwd(中文项目名/Windows 常见)
    const fm = (cwd, bv) => '---\nphase: "15"\nplan: "01"\nwave: 3\n' + (cwd ? "cwd: " + cwd + "\n" : "") + 'depends_on: []\n' + bv + '\n---\n\n### T1 事\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 做\n- **verify**: node a.mjs\n- **fails_when**: 退出码非 0\n- **done**: ok\n';
    const run = (args) => { const r = spawnSync(process.execPath, [WAVE, ...args], { cwd: d, encoding: "utf8" }); return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") }; };
    // 用例 1:含单引号路径的 cwd 生成合法脚本(POSIX 转义 ' → '\'')
    writeFileSync(join(d, ".planning", "15-01-PLAN.md"), fm(".worktrees/it's q", "batch_verify: echo hi"));
    let r = run(["--phase", "15", "--wave", "3", "--dry"]);
    const shFile = join(d, "gen.sh");
    writeFileSync(shFile, r.out);
    let bn = spawnSync("bash", ["-n", shFile.split("\\").join("/")], { encoding: "utf8" });
    eqN(r.out.startsWith(`cd '.worktrees/it'\\''s q'`) && bn.status === 0, true, "含单引号路径的 cwd 生成合法脚本(转义 + bash -n 过)");
    // 用例 2:多行 batch_verify 逐行落脚本,空行跳过(不终止收集)
    writeFileSync(join(d, ".planning", "15-01-PLAN.md"), fm("", "batch_verify: echo one\n\n  echo two"));
    r = run(["--phase", "15", "--wave", "3", "--dry"]);
    eqN(r.out.includes('# ==== 15-01 ====\necho one\necho two\necho "WAVECHECK 15-01 exit=$?"'), true, "多行 batch_verify 逐行落脚本(空行跳过,两行紧邻各占一行)");
    rmSync(d, { recursive: true, force: true });
    // 用例 3:多行 batch_verify 在 --plan 下逐行过 lint 与 cd 扫描(不漏行 —— 门禁只见第一行就是错误级盲区,预审 F3)
    const d2 = mkdtempSync(join(tmpdir(), "mm-gsd-wv15p-"));
    mkdirSync(join(d2, ".planning"), { recursive: true });
    writeFileSync(join(d2, "a.mjs"), "x\n");
    const p2 = join(d2, ".planning", "14-01-PLAN.md");
    writeFileSync(p2, '---\nphase: "14"\nplan: "01"\ngoal: g\nrollback: r\ncwd: .worktrees/p33\nfiles_modified:\n  - a.mjs\ndepends_on: []\nbatch_verify: cd .worktrees/p33 && node a.mjs\n  cd /elsewhere && node a.mjs\n  npm test -- tests\n---\n\n### T1 事\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 做\n- **verify**: node a.mjs\n- **fails_when**: 退出码非 0(无 ok)\n- **done**: ok\n');
    let out2 = "";
    try { out2 = execFileSync(process.execPath, [CHECKER, "--plan", p2], { cwd: d2, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { out2 = String(e.stdout || "") + String(e.stderr || ""); }
    eqN(out2.includes("命令量错树") && out2.includes("无界目录"), true, "多行 batch_verify 在 --plan 下逐行过 lint 与 cd 扫描(不漏行:第 2 行 cd 错树判红,第 3 行无界目录报 WARNING)");
    rmSync(d2, { recursive: true, force: true });
  }
  // ---- 提交 scope 警告上门禁(phase 15 D-02):fixture 真仓(照 runLedgerGateCases 的 git init 先例),黄不拦红 ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-scope-"));
    const sh = (args) => { const r = spawnSync("git", args, { cwd: d, encoding: "utf8" }); if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr); return r.stdout; };
    sh(["init", "-q"]); sh(["config", "user.name", "t"]); sh(["config", "user.email", "t@t"]);
    mkdirSync(join(d, ".planning"), { recursive: true });
    writeFileSync(join(d, ".planning", "STATE.md"), '---\nstatus: discussing\nactive_phase: "14"\n---\n');
    writeFileSync(join(d, ".planning", "14-01-PLAN.md"), '---\nphase: "14"\nplan: "01"\n---\n');
    writeFileSync(join(d, ".planning", "14-01-PLAN-CHECK.md"), '---\nstatus: passed\n---\n');
    const run = () => {
      const r = spawnSync(process.execPath, [CHECKER, "--json"], { cwd: d, encoding: "utf8" });
      const out = String(r.stdout || "") + String(r.stderr || "");
      let j = null;
      try { j = JSON.parse(out.slice(out.indexOf("{"))); } catch {}
      return { code: r.status, out, j };
    };
    // scope 缺失 → 黄(不拦红):commits=2 全部无 (14-01): scope
    sh(["commit", "--allow-empty", "-q", "-m", "chore: 提到 14-01 但没写 scope"]);
    sh(["commit", "--allow-empty", "-q", "-m", "chore: another unscoped"]);
    writeFileSync(join(d, ".planning", "14-01-SUMMARY.md"), '---\nphase: "14"\nplan: "01"\nstatus: complete\ncommits: 2\n---\n');
    let r = run();
    eqN(r.code, 0, "scope 缺失 → 黄(不拦红):退出码 0");
    eqN((r.j?.errors.length ?? 1) === 0 && (r.j?.warnings.some((w) => w.message.includes("但提交主题无")) ?? false), true, "scope 缺失 → 黄(不拦红):errors 空、scope 警告进 warnings");
    // scope 齐全 → 无警告:两笔提交都带 (14-01): scope,scoped === commits
    sh(["commit", "--allow-empty", "-q", "-m", "feat(14-01): c1"]);
    sh(["commit", "--allow-empty", "-q", "-m", "fix(14-01): c2"]);
    writeFileSync(join(d, ".planning", "14-01-SUMMARY.md"), '---\nphase: "14"\nplan: "01"\nstatus: complete\ncommits: 2\n---\n');
    r = run();
    eqN(r.code === 0 && (r.j?.errors.length ?? 1) === 0 && (r.j?.warnings.length ?? 1) === 0, true, "scope 齐全 → 无警告(scoped 与 commits 同口径命中)");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- 票外实碰对账只认本批次的提交(phase 22 修):提交块按 %x1e 切,不靠主题行首 "(" ----
  // 旧写法按行首 "(" 切块 → 主题开头没有 "(" 时整段 git log 变成一块,后面每一笔提交的文件
  // 全算到最新那笔头上 → 别的批次的文件被报成"票外实碰"(实测把 22-01 的 8 个文件算到 22-02 头上)。
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-scope2-"));
    const sh = (args) => { const r = spawnSync("git", args, { cwd: d, encoding: "utf8" }); if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr); return r.stdout; };
    sh(["init", "-q"]); sh(["config", "user.name", "t"]); sh(["config", "user.email", "t@t"]);
    mkdirSync(join(d, ".planning"), { recursive: true });
    writeFileSync(join(d, "a.mjs"), "export const a = 1;\n");
    sh(["add", "-A"]); sh(["commit", "-q", "-m", "feat(99-01): 另一批"]);
    writeFileSync(join(d, "b.md"), "b\n");
    sh(["add", "-A"]); sh(["commit", "-q", "-m", "docs(99-02): 本批"]);
    writeFileSync(join(d, ".planning", "STATE.md"), '---\nstatus: discussing\nactive_phase: "99"\n---\n');
    writeFileSync(join(d, ".planning", "99-02-PLAN.md"), '---\nphase: "99"\nplan: "02"\ngoal: g\nrollback: r\nfiles_modified:\n  - b.md\n---\n');
    writeFileSync(join(d, ".planning", "99-02-PLAN-CHECK.md"), '---\nstatus: passed\n---\n');
    writeFileSync(join(d, ".planning", "99-02-SUMMARY.md"), '---\nphase: "99"\nplan: "02"\nstatus: complete\ncommits: 1\n---\n\n## One-liner\n\nx\n\n## Self-Check: PASSED\n');
    const r = spawnSync(process.execPath, [CHECKER, "--json"], { cwd: d, encoding: "utf8" });
    const out = String(r.stdout || "") + String(r.stderr || "");
    let j = null;
    try { j = JSON.parse(out.slice(out.indexOf("{"))); } catch {}
    const stray = (j?.warnings ?? []).filter((w) => w.message.includes("票外实碰文件"));
    eqN(stray.length, 0, "票外实碰对账只算本批次的提交(别的批次文件不算账)");
    eqN(out.includes("a.mjs"), false, "票外实碰对账不把别的批次的文件算进来");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- summary notes schema(phase 15 D-03):未知字段/类型错一次列全并拒绝;合法填进模板字面节 ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-notes-"));
    const sh = (args) => { const r = spawnSync("git", args, { cwd: d, encoding: "utf8" }); if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr); return r.stdout; };
    sh(["init", "-q"]); sh(["config", "user.name", "t"]); sh(["config", "user.email", "t@t"]);
    mkdirSync(join(d, ".planning"), { recursive: true });
    sh(["commit", "--allow-empty", "-q", "-m", "feat(15-03): c1"]);
    const SUMMARY = fileURLToPath(new URL("../../mm-gsd-exec/scripts/mm-gsd-summary.mjs", import.meta.url));
    const run = (args) => { const r = spawnSync(process.execPath, [SUMMARY, ...args], { cwd: d, encoding: "utf8" }); return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") }; };
    const put = (obj) => writeFileSync(join(d, "notes.json"), JSON.stringify(obj));
    const gen = join(d, ".planning", "15-03-SUMMARY.md");
    // 未知字段拒绝:违规列出,草稿不落盘
    put({ one_liner: "x", bogus: "y" });
    let r = run(["--ticket", "15-03", "--notes", "notes.json"]);
    eqN(r.code === 1 && r.out.includes("bogus") && !existsSync(gen), true, "notes 未知字段拒绝(违规指名、草稿不落盘)");
    // 类型错拒绝:两处违规一次列全(字符串字段给了非 string;数组元素非字符串)
    put({ accomplishments: "not-array", deferred: [1, "ok"] });
    r = run(["--ticket", "15-03", "--notes", "notes.json"]);
    eqN(r.code === 1 && r.out.includes("accomplishments") && r.out.includes('"deferred"[0] 非字符串') && !existsSync(gen), true, "notes 类型错拒绝(全部违规一次列出)");
    // 合法:six 字段填进对应节,节标题与 templates/summary.md 字面一致
    put({ one_liner: "JWT 认证含刷新轮换,用 jose 库", accomplishments: ["登录态可保持"], deviations: ["[R1 - bug] 修了 X"], threats: ["新增 /admin 端点"], stubs: ["src/a.ts:42 — 占位"], deferred: ["LF 归一"] });
    r = run(["--ticket", "15-03", "--notes", "notes.json"]);
    const t = () => readFileSync(gen, "utf8");
    eqN(r.code === 0
      && t().includes("## One-liner\nJWT 认证含刷新轮换,用 jose 库")
      && t().includes("## Accomplishments\n- 登录态可保持")
      && t().includes("## Deviations from Plan\n- [R1 - bug] 修了 X")
      && t().includes("## Known Stubs\n- src/a.ts:42 — 占位")
      && t().includes("## Deferred Issues\n- LF 归一")
      && t().includes("## Threat Flags\n- 新增 /admin 端点"), true, "notes 合法填进对应节(六字段与模板节字面一一对应,缺节按模板补建)");
    rmSync(d, { recursive: true, force: true });
  }
}