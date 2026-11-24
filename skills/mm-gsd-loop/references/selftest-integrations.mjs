// 自测族模块(phase 30 D-OV-2 从 gate-selftest.mjs 拆出):集成族(工具日志聚合 / 点修闭环 / 债面板口径 / 遥测图 / 端点映射)
// 断言工具由 runSelfTest 显式传入(不自建 —— 失败数必须聚合到同一个 st);
// 时序契约(遥测隔离/env 还原)仍由 runSelfTest 统一持有,本文件不做环境操作。

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDebt } from "../references/debt-panel.mjs";
import { runToolStats } from "../references/telemetry-aggregate.mjs";
import { aggregateByDay } from "../references/telemetry-view.mjs";

const CHECKER = fileURLToPath(new URL("../scripts/gsd-state-check.mjs", import.meta.url));

export function runIntegrationCases(t) {
  const { eq, eqN, eqArr } = t;

  // ---- 工具日志聚合(REQ-18,20-01 T2):grep 计数与派发分布必须真的出得来(具名用例) ----
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-tstat-"));
    const p = join(d, "tools.jsonl");
    const row = (ts, cwd, tool, brief, extra = {}) => JSON.stringify({ ts, cwd, tool, brief, ...extra });
    writeFileSync(p, [
      row("2026-11-12T00:00:00.000Z", "P1", "Bash", "grep -rn foo src"),
      row("2026-11-12T00:01:00.000Z", "P1", "Grep", "foo"),
      row("2026-11-12T00:02:00.000Z", "P1", "Task", "施工", { subagent_type: "mm-gsd-exec", prompt_head: "照 PLAN" }),
      row("2026-11-12T00:32:00.000Z", "P1", "Task", "验收", { subagent_type: "mm-gsd-verify", prompt_head: "推翻" }),
      row("2026-11-12T01:00:00.000Z", "P1", "Bash", "cat f | rg bar"),
    ].join("\n") + "\n");
    let out = "";
    runToolStats({ path: p, log: (s) => (out += s + "\n") });
    eqN(/grep 3 次/.test(out), true, "工具日志聚合出 grep 计数(Grep 行 + Bash 含 grep/rg,rg 也计)");
    eqN(out.includes("mm-gsd-exec×1") && out.includes("mm-gsd-verify×1"), true, "工具日志聚合出派发角色分布(subagent_type)");
    eqN(out.includes("派发 2 次") && out.includes("近似时长"), true, "派发计数与近似时长口径在场");
    eqN(out.includes("进行中"), true, "末次派发标「进行中」(预审 F2:无 PostToolUse/UserPromptSubmit 终止符)");
    rmSync(d, { recursive: true, force: true });
  }
  // ---- 点修闭环(phase 21,REQ-20/21):批注黄提醒 / reopened 推导 / R 票门禁兼容 / R≥3 升级(具名用例) ----
  {
    const runCk = (d, args) => { let out = "", code = 0;
      try { out = execFileSync(process.execPath, [CHECKER, ...args], { cwd: d, encoding: "utf8", stdio: "pipe" }); }
      catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
      return { out, code }; };
    // ① open 批注 → checker 黄提醒;全 digested → 静默(默认模式端到端,D-04 后半)
    const dA = mkdtempSync(join(tmpdir(), "mm-gsd-ann-"));
    mkdirSync(join(dA, ".planning"), { recursive: true });
    writeFileSync(join(dA, ".planning", "STATE.md"), '---\nstatus: discussing\nactive_phase: "01"\n---\n');
    writeFileSync(join(dA, ".planning", "annotations.json"), JSON.stringify([{ id: "a1", ts: "t", target: "REQ:REQ-1", type: "备注", text: "x", status: "open" }]));
    let rA = runCk(dA, []);
    eqN(rA.out.includes("待消化") && rA.out.includes("1 条"), true, "open 批注 → checker 黄提醒");
    writeFileSync(join(dA, ".planning", "annotations.json"), JSON.stringify([{ id: "a1", ts: "t", target: "REQ:REQ-1", type: "备注", text: "x", status: "digested" }]));
    rA = runCk(dA, []);
    eqN(rA.out.includes("待消化"), false, "全 digested → 不提醒");
    rmSync(dA, { recursive: true, force: true });

    // ②③ reopened 推导(D-09):已 shipped 的 phase 开 R 票 → reopened;收口 + 重验 passed → 回 shipped
    // 已 shipped fixture 四件套照契约造(缺任何一项推导就走不到 shipped,用例会自己暴露)
    const mkShipped = (d) => {
      mkdirSync(join(d, ".planning"), { recursive: true });
      writeFileSync(join(d, ".planning", "STATE.md"), '---\nstatus: shipped\nactive_phase: "01"\n---\n');
      writeFileSync(join(d, ".planning", "01-CONTEXT.md"), "<domain>做安全登录</domain>\n<decisions>无</decisions>\n<specifics>无</specifics>\n<deferred>无</deferred>\n");
      writeFileSync(join(d, ".planning", "01-01-PLAN.md"), '---\nphase: "01"\nplan: "01"\n---\n');
      writeFileSync(join(d, ".planning", "01-01-PLAN-CHECK.md"), '---\nstatus: passed\nplan: "01-01"\nblockers: 0\nwarnings: 0\n---\n');
      writeFileSync(join(d, ".planning", "01-01-SUMMARY.md"), '---\nphase: "01"\nplan: "01"\nstatus: complete\ncommits: 2\n---\n');
      writeFileSync(join(d, ".planning", "01-VERIFICATION.md"), '---\nstatus: passed\nscore: 1/1\n---\n\n## Observable Truths\n\n| # | Truth | 状态 | 证据 |\n|---|---|---|---|\n| T1 | 登录安全 | ✓ VERIFIED | t:1 |\n\n## Human Verification Required(机器验不了,恒发不省略)\n\nNone —— 全部由程序验证\n');
      writeFileSync(join(d, ".planning", "01-SHIP.md"), '---\nstatus: shipped\ndelivered: PR #128\ndocs_synced: yes\n---\n');
    };
    const runJson = (d) => { let out = "";
      try { out = execFileSync(process.execPath, [CHECKER, "--json"], { cwd: d, encoding: "utf8", stdio: "pipe" }); }
      catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); }
      return JSON.parse(out.slice(out.indexOf("{"))); };
    const dB = mkdtempSync(join(tmpdir(), "mm-gsd-rrep-"));
    mkShipped(dB);
    writeFileSync(join(dB, ".planning", "01-R1-PLAN.md"), '---\nphase: "01"\nplan: "R1"\n---\n');
    eqN(runJson(dB).derived, "reopened", "R 票未收口 → derived reopened");
    rmSync(dB, { recursive: true, force: true });
    const dC = mkdtempSync(join(tmpdir(), "mm-gsd-rdone-"));
    mkShipped(dC);
    writeFileSync(join(dC, ".planning", "01-R1-PLAN.md"), '---\nphase: "01"\nplan: "R1"\n---\n');
    writeFileSync(join(dC, ".planning", "01-R1-PLAN-CHECK.md"), '---\nstatus: passed\nplan: "01-R1"\nblockers: 0\nwarnings: 0\n---\n');
    writeFileSync(join(dC, ".planning", "01-R1-SUMMARY.md"), '---\nphase: "01"\nplan: "R1"\nstatus: complete\ncommits: 1\n---\n');
    const vt = readFileSync(join(dC, ".planning", "01-VERIFICATION.md"), "utf8");
    writeFileSync(join(dC, ".planning", "01-VERIFICATION.md"), vt.replace("## Human", "## 重验记录\n\n- R1: passed — 重验 登录安全\n\n## Human"));
    eqN(runJson(dC).derived, "shipped", "R 票收口且重验 passed → 回 shipped");
    rmSync(dC, { recursive: true, force: true });

    // ④⑤⑥ --plan 门的 R 票兼容(D-06/D-08)
    const rPlan = (k) => '---\nphase: "01"\nplan: "' + k + '"\ngoal: 重验登录安全这条 truth\nrollback: 回退本票 commit\nfiles_modified:\n  - a.mjs\n---\n\n### T1 重验\n\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 修复并重验原 truth,不扩 scope。\n- **verify**: node a.mjs\n- **fails_when**: 退出码非 0(输出无 ok)\n- **done**: 输出 ok\n';
    const mkRDir = (ks) => { const d = mkdtempSync(join(tmpdir(), "mm-gsd-rplan-"));
      mkdirSync(join(d, ".planning"), { recursive: true });
      writeFileSync(join(d, "a.mjs"), "console.log('ok');\n");
      writeFileSync(join(d, ".planning", "STATE.md"), '---\nstatus: shipped\nactive_phase: "01"\n---\n');
      for (const k of ks) writeFileSync(join(d, ".planning", "01-" + k + "-PLAN.md"), rPlan(k));
      return d; };
    // ④ R 票过 --plan 门:无 frontmatter wave 不判红(R 票是串行补票,不进波次)
    const dD = mkRDir(["R1"]);
    let rD = runCk(dD, ["--plan", ".planning/01-R1-PLAN.md"]);
    eqN(rD.code === 0 && !rD.out.includes("wave"), true, "R 票过 --plan 门(wave 可空不判红)");
    rmSync(dD, { recursive: true, force: true });
    // ⑤ 两张 R 票撞同一文件 → 批图不判红(修复是串行的,不是新并行面)
    const dE = mkRDir(["R1", "R2"]);
    let rE = runCk(dE, ["--plan", ".planning/01-R1-PLAN.md", ".planning/01-R2-PLAN.md"]);
    eqN(rE.code === 0 && !rE.out.includes("撞了文件"), true, "R 票不被批图卷入(同文件不判并行冲突)");
    rmSync(dE, { recursive: true, force: true });
    // ⑥ 同 phase R 票 ≥3 → 强制升级黄提醒(黄不拦红,退出码仍 0)
    const dF = mkRDir(["R1", "R2", "R3"]);
    let rF = runCk(dF, ["--plan", ".planning/01-R1-PLAN.md", ".planning/01-R2-PLAN.md", ".planning/01-R3-PLAN.md"]);
    eqN(rF.code === 0 && rF.out.includes("强制升级"), true, "R 票 ≥3 → 强制升级黄提醒");
    rmSync(dF, { recursive: true, force: true });
    // ⑦⑧ 收口豁免认点修 R 票(36-R2,I-023):gsd-state-check 判活票名解析认 <NN>-Rk 整票号 ——
    // 修前解析 null,已收口 R 票豁免永不生效(活票误红);⑧ 常规票同路径零变化锚。
    const dG = mkRDir(["R1"]);
    writeFileSync(join(dG, ".planning", "01-R1-PLAN.md"), '---\nphase: "01"\nplan: "R1"\n---\n');   // 去掉 goal:活票会判红「缺 goal」
    writeFileSync(join(dG, ".planning", "01-R1-SUMMARY.md"), '---\nphase: "01"\nplan: "R1"\nstatus: complete\ncommits: 1\n---\n');
    const rG = runCk(dG, ["--plan", ".planning/01-R1-PLAN.md"]);
    eqN(rG.code === 0 && !rG.out.includes("缺 goal"), true, "R 票已收口 → 退出全部门禁(判活解析认 R 票,修前判活误红)");
    rmSync(dG, { recursive: true, force: true });
    const dH = mkRDir([]);
    writeFileSync(join(dH, ".planning", "01-02-PLAN.md"), '---\nphase: "01"\nplan: "02"\n---\n');   // 同款无 goal 常规票
    writeFileSync(join(dH, ".planning", "01-02-SUMMARY.md"), '---\nphase: "01"\nplan: "02"\nstatus: complete\ncommits: 1\n---\n');
    const rH = runCk(dH, ["--plan", ".planning/01-02-PLAN.md"]);
    eqN(rH.code === 0 && !rH.out.includes("缺 goal"), true, "常规票收口豁免照旧(捕获整票号,行为零变化)");
    rmSync(dH, { recursive: true, force: true });
  }
  // ---- 债面板口径(phase 22 D-02/D-05 + 23 D-03 分类感知):parked/deferred 分列 + 台账处置为准(纯函数断言,不写盘不起服务) ----
  {
    const debtDir = {
      "issues/LEDGER.md": "| 件 | 处置 | 挂靠 | 说明 |\n|---|---|---|---|\n| I-001.md | closed | — | 已修 |\n",
      "issues/I-001.md": "# I-001 已修的件\n\n## 状态\n\nopen\n",
      "issues/I-002.md": "# I-002 台账没登记的件\n\n## 状态\n\nopen\n",
      "01-CONTEXT.md": "<deferred>\n\n| 项 | 分类 | 触发条件 / 关闭理由 | 归属 |\n|---|---|---|---|\n| 精确耗时 | 挂条件 | 宿主新增事件 | 每次 release 后查一次 |\n\n</deferred>\n",
    };
    const debt = buildDebt({ planningDir: debtDir, annotations: [] });
    // ① 挂条件条目带齐五要素进 parked(项/分类/触发条件/归属/来源),且不进 deferred、不计数
    //    (23 D-03:已有处置理由的不计数;归一成纯文本就答不出「何时做、谁做、为什么不做」)
    eqArr(
      debt.parked.map((d) => [d.text, d.kind, d.condition, d.owner, d.source]),
      [["精确耗时", "挂条件", "宿主新增事件", "每次 release 后查一次", "01-CONTEXT.md"]],
      "挂条件条目 → 进 parked 不进 deferred",
    );
    eqN(debt.deferred.some((d) => d.text === "精确耗时") || debt.counts.total !== debt.counts.openIssues + debt.counts.openAnnotations + debt.counts.deferred, false, "挂条件条目 → 进 parked 不进 deferred(deferred 侧为空且不进 total)");
    // ② 台账 closed 的不计入 open;台账没行才回退原件状态(原件 open 才算)
    eqArr(debt.localIssues.map((i) => i.id), ["I-002"], "台账 closed → 不计入 open");
  }
  // ---- 工具遥测 → 看板迷你图可渲染(phase 22 D-03):按本地日切桶 + cwd 归一后等值比较(纯函数断言,不写盘不起服务) ----
  {
    // 两个时刻相隔 35 小时 —— 超过一个整日,任何时区下都落在两个不同的本地日。
    // ts1 在 UTC+8 落在 11-11(UTC 是 11-10):按本地日切与按 UTC 日切结果不同,断言有判别力。
    const telRoot = "/proj/demo";
    const TS1 = "2026-11-10T23:30:00.000Z";
    const TS2 = "2026-11-12T10:30:00.000Z";
    // 期望的本地日由本用例自己按本地构造器算(不借用被测实现的切桶函数)
    const localDay = (iso) => {
      const d = new Date(iso);
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    };
    const tel = aggregateByDay([
      { ts: TS1, cwd: "/proj/demo/", tool: "Bash" },   // 尾斜杠变体 → 计入
      { ts: TS1, cwd: "/PROJ/DEMO", tool: "Read" },    // 大小写变体 → 计入
      { ts: TS2, cwd: "/proj/demo", tool: "Write" },   // 正常写法 → 计入
      { ts: TS2, cwd: "/proj/other", tool: "Edit" },   // 异 cwd → 不计入
    ], telRoot);
    // 桶键必须是补零的 YYYY-MM-DD(不补零时「2026-1-2」与「2026-01-02」是两个桶)
    eqN(
      JSON.stringify({
        total: tel.total,
        series: tel.series,
        byTool: tel.byTool,
        empty: tel.empty,
      }),
      JSON.stringify({
        total: 3,
        series: [{ date: localDay(TS1), count: 2 }, { date: localDay(TS2), count: 1 }],
        byTool: { Bash: 1, Read: 1, Write: 1 },
        empty: false,
      }),
      "工具遥测 → 看板迷你图可渲染",
    );
  }
  // ---- 生产端点名映射(24-01 T2,D-03/D-04):SHIP 的一句话结论占位 / STATE 的索引地图注记 ----
  //      口径 = 只点名不新建:模板占位在场即完成;消费端门禁(读 summary 断言真实工件)不在本批范围(PLAN-CHECK 记录为接受残余)。
  {
    const shipTpl = readFileSync(fileURLToPath(new URL("../templates/ship.md", import.meta.url)), "utf8");
    const stateTpl = readFileSync(fileURLToPath(new URL("../templates/state.md", import.meta.url)), "utf8");
    eqN(/(^|\n)summary:/.test(shipTpl), true, "SHIP 模板含 summary 一句话结论占位");
    eqN(stateTpl.includes("L0/L1/L2 索引地图"), true, "STATE 模板含 L0/L1/L2 索引地图注记");
  }
}