/* zcode-workflow
description: mm-gsd 极简 GSD 循环的自动化版:决策捕获 → 拆票 → 执行 → 测试门 → 独立验证 → 修复回路(≤2
  轮)。模型自动配置(执行者快档,其余用会话模型);每步跑状态机检查器(gsd-state-check)保证工件契约与状态一致;技术细节自主决策标 AUTO
  事后可推翻;产物落盘 .planning/,新项目自动冷启动。
whenToUse: 给一个 phase 目标(goal 参数),想全自动跑完 mm-gsd
  五步循环时。新项目自动冷启动;技术细节由子代理自主决策并标注,跑完你可在 CONTEXT.md
  推翻;只有产品取舍/破坏性操作/付费/合规/凭据缺失才会上浮问你。每步跑 gsd-state-check 确定性校验状态机(工件存在性推导 +
  契约校验),不靠散文约定。
args:
  exec_model:
    type: string
    description: 执行者模型:flash(默认,快档)| idle(闲时便宜档)| highspeed(高速卡)| session(跟随会话模型)
    default: flash
  goal:
    type: string
    description: 本 phase 的目标(结果形,一句话)
    required: true
*/
// mm-gsd-phase —— mm-gsd 五步循环的 ZCode 工作流版
// 纪律单一来源:各子代理先读 ~/.agents/skills/mm-gsd-*/SKILL.md 再干活。
// 模型自动配置:讨论/规划/验证 = 会话模型(强模型);执行者默认快档,args.exec_model 可切。
// 拍板权:技术细节全部自主决策(标 [AUTO]);只有五类白名单才上浮用户。
// 状态机:每步后跑 gsd-state-check(确定性,模型无法绕过)。

const SKILLS = "C:/Users/septe/.agents/skills/mm-gsd";
const CHECK = SKILLS + "-loop/scripts/gsd-state-check.mjs";
const RIGHTS =
  "【拍板权】技术细节一律自己决定,不要问人:选库、文件组织、命名、实现路线、重构边界、测试写法——按项目既有约定和代码事实定," +
  "在 CONTEXT.md/计划里标 [AUTO] 并附一句依据,用户事后会看到并可推翻。拿不准就去查项目事实(代码/文档/配置/既有模式),不是问用户;查不到就选合理默认并标明。" +
  "只有这五类才 escalate 问运行主人,且必须带选项+代价+推荐:①产品取舍(用户可感知不同的两种方案)②不可逆或破坏性操作(删数据/force push/发布/动生产配置)" +
  "③花钱或外部副作用(付费 API/生产部署/向真实用户发消息)④法律合规(许可/隐私条款)⑤只有用户知道的输入(凭据/生产地址/账号)。" +
  "不属于这五类的疑问:自己决定、记录、继续干——绝不因为'拿不准'而上浮,那会让运行无谓地停摆。";
const ARTIFACT_RULES =
  "【工件契约】写完 .planning/ 下的工件后必须让 gsd-state-check 转绿(它会校验你的 status/commits 是否合规);" +
  "STATE 的 status 必须与工件存在性一致(completed 需要一份 passed 的 VERIFICATION);" +
  "不要对被 gitignore 的 .planning/ 硬 git add -f——流程记忆是本地工件,业务变更才入库。";

interface Decision {
  /** D-NN 编号 */
  id: string;
  /** 决策一句话;[ASSUMED]/[AUTO] 表示自主决策,用户可推翻 */
  decision: string;
  /** 置信度 */
  confidence: "high" | "medium" | "low";
}
interface DiscussResult {
  /** 写入的 CONTEXT.md 工作区相对路径 */
  contextPath: string;
  decisions: Decision[];
  /** 本次是否冷启动新建了 .planning/STATE.md */
  coldStart: boolean;
}
interface TaskBrief {
  /** 任务号 */
  id: string;
  /** 涉及文件(精确路径清单) */
  files: string;
  /** 一句话:这个任务做什么 */
  summary: string;
}
interface PlanResult {
  /** PLAN.md 工作区相对路径 */
  planPath: string;
  /** phase 目录(工作区相对) */
  phaseDir: string;
  tasks: TaskBrief[];
}
interface ExecResult {
  /** 本轮新增提交数(git 实测,非手填) */
  commits: number;
  /** SUMMARY.md 工作区相对路径 */
  summaryPath: string;
  /** 偏差记录摘要;无偏差为 "None" */
  deviations: string;
  /** 受阻未完成的任务一句话;空串 = 全部完成 */
  blocked: string;
}
interface Gap {
  /** 缺口编号,形如 G-01-1 */
  id: string;
  /** 未达成的真相(用户视角) */
  truth: string;
  /** 一句话:为什么失败 */
  reason: string;
}
interface Verdict {
  /** passed | gaps_found | human_needed */
  status: "passed" | "gaps_found" | "human_needed";
  /** 分数,如 "5/6"(VERIFIED truths / 总数) */
  score: string;
  /** VERIFICATION.md 工作区相对路径 */
  reportPath: string;
  gaps: Gap[];
  /** 需要人工验证的条目(视觉/端到端/外部服务等) */
  humanItems: string[];
}
interface Finding {
  /** Workspace-relative path, with a line when it applies. */
  where: string;
  /** One sentence: what is wrong, or what was found. */
  what: string;
  /** What showed it: the lines read, or the command and the output that proved it. */
  evidence: string;
  /** "verified" when an independent subagent or a deterministic check confirmed it. */
  status: "verified" | "unconfirmed";
  /** How much it matters. */
  severity: "low" | "medium" | "high";
}
interface WorkflowReport {
  /** Two or three sentences answering what the user asked for. */
  conclusion: string;
  findings: Finding[];
  /** What the run checked and how. */
  verified: string[];
  /** What the run did not look at or could not check, and why. */
  notCovered: string[];
}

// ---- 模型自动配置(执行者快档;表驱动,launch 时校验)----
const EXEC_MODELS: Record<string, ModelRef | undefined> = {
  flash: model("account:bigmodel-individual-coding-plan/GLM-5.3-Flash"),
  idle: model("account:bigmodel-offpeak-idle-plan/GLM-5.3-Flash"),
  highspeed: model("account:bigmodel-highspeed-card/GLM-5.3-Flash"),
  session: undefined,
};
const goalText = String(args.goal ?? "").trim();

phase("捕获决策(自动决策模式)");
const hasState = await files.read(".planning/STATE.md").then(() => true).catch(() => false);
const discussant = agent("讨论员", {
  system:
    "你是 mm-gsd 循环的讨论环节。第一步:读 " + SKILLS + "-discuss/SKILL.md 并遵守全部规则。" +
    "本工作流无人交互:用带置信度的自主决策替代提问,每条决策标 [ASSUMED] 并在 CONTEXT.md 的 canonical refs 记依据。" +
    RIGHTS + ARTIFACT_RULES +
    " 若某项检查/规则真的无法满足而必须中止,如实 escalate 纯技术性说明,而不是绕过。",
});
const discuss = await discussant.ask<DiscussResult>(
  (hasState
    ? "项目已有 .planning/STATE.md:先读它和现有 CONTEXT,已决的不重新发明;与既有决策冲突处显式标注。"
    : "项目无 STATE.md:冷启动。先读 README.md / AGENTS.md / CLAUDE.md / package.json(存在哪个读哪个)了解项目,再按 " + SKILLS + "-loop/templates/state.md 模板创建 .planning/STATE.md(一句话项目目标 + 粗拆 2-4 个 phase),本次目标即首个 phase。") +
  "\n本次 phase 目标:" + goalText +
  "\n然后按模板 " + SKILLS + "-plan/templates/context.md 写当前 phase 的 CONTEXT.md:决策标 [ASSUMED]、范围蔓延进 deferred、引用的文档进 canonical refs。返回决策清单与 CONTEXT 路径。",
);
const autoDecisions = discuss.decisions.length;
log("决策 " + autoDecisions + " 条自主记录(" + (discuss.coldStart ? "冷启动" : "增量") + ")→ " + discuss.contextPath);

phase("拆票与规划");
const planner = agent("规划员", {
  system:
    "你是 mm-gsd 循环的规划环节。第一步:读 " + SKILLS + "-plan/SKILL.md 并遵守全部规则:" +
    "两层拆票、tracer-first 垂直切片、任务四件套、fails_when、缩水禁令、四源覆盖审计、预授权决策清单([AUTO] 标注技术选型)、规划者失效模式自查。" +
    "规划者无权判定'太难'(只有装不下/信息缺/依赖冲突三个正当拆分理由)。" + RIGHTS + ARTIFACT_RULES,
});
const plan = await planner.ask<PlanResult>(
  "phase 目标:" + goalText +
  "\n先读 .planning/STATE.md 与 " + discuss.contextPath + ",再产出 PLAN.md 写入 .planning/phases/<NN-slug>/ 下:" +
  "首任务 = 最薄端到端 tracer;每个任务四件套齐全(files/action/verify/done);每条验证命令紧跟 fails_when;" +
  "列 files_modified 与依赖;技术选型标 [AUTO] 并注依据。返回任务清单与 PLAN 路径。",
);
log("拆票 " + plan.tasks.length + " 张 → " + plan.planPath);

phase("执行(逐任务提交)");
const execModelRef = EXEC_MODELS[String(args.exec_model ?? "flash")];
const EXEC_SYSTEM =
  "你是 mm-gsd 循环的执行环节。第一步:读 " + SKILLS + "-exec/SKILL.md 并遵守全部规则:" +
  "开工说明、read_first 全读后批量编辑、偏差规则 R1-R4(R4 技术变更自主决策并记 [R4 - 自主调整])、环境修复义务(用户从不跑 CLI、绝不带坏环境)、" +
  "git 纪律(逐文件 staging、禁 git add . / clean / stash / reset --hard)、原子提交 type(phase-plan): 描述、SUMMARY 原子块(写完立即提交,commits 用 git rev-list 实测)。" +
  "遇认证门(401/要密钥)escalate 要凭据,不算失败。卡住记 blocker 跳过继续无依赖任务。" + RIGHTS + ARTIFACT_RULES;
const executor = agent("执行者", execModelRef === undefined ? { system: EXEC_SYSTEM } : { model: execModelRef, system: EXEC_SYSTEM });
const exec1 = await executor.ask<ExecResult>(
  "执行 " + plan.planPath + " 的全部任务。注意:不要自己跑全量测试——工作流随后有确定性测试门和独立验证,你只负责按计划实现、原子提交、写 SUMMARY。",
);
report({ stage: "执行完成", commits: exec1.commits, deviations: exec1.deviations.slice(0, 300), blocked: exec1.blocked });

phase("跑测试门与状态机检查");
const pkgText = await files.read("package.json").catch(() => "");
let hasTest = false;
let testGate = "跳过:项目无 package.json 或无 test script";
if (pkgText !== "" && /"test"\s*:/.test(pkgText)) {
  hasTest = true;
  const t = await world.run("npm", ["test"], { timeoutMs: 600000 });
  testGate = t.exitCode === 0 ? "npm test 通过" : "npm test 失败(exit " + t.exitCode + "):" + t.stderr.slice(0, 500);
  log(testGate);
}
const stateCheck = await world.run("node", [CHECK], { timeoutMs: 30000 });
if (stateCheck.exitCode !== 0) log("状态机检查器报告(交给执行者/验证员修):" + stateCheck.stdout.slice(0, 800));

phase("独立验证(goal-backward)");
const verifier = agent("验证员", {
  system:
    "你是 mm-gsd 循环的验证环节,独立于执行者(你没参与实现,这是你的价值)。第一步:读 " + SKILLS + "-verify/SKILL.md 并遵守全部规则:" +
    "SUMMARY 不是证据(自评盲区);任务完成 ≠ 目标达成;三层倒推 TRUE→EXIST→WIRED;四态真相;数据流追踪;行为抽查自己跑探针;" +
    "占位文本判假完成;stub 反误报;验证员失效模式清单逐条自查(尤其'该红不红选黄'和'完成率高就 PASS')。" +
    "验证中发现的实现方式问题(命名/结构/库用法)记 advisory 建议,不算 gap、不需要问人——除非属于拍板权五类白名单。" +
    ARTIFACT_RULES,
});
let verdict = await verifier.ask<Verdict>(
  "独立验证 phase 目标「" + goalText + "」:读 " + plan.planPath + " 与 " + exec1.summaryPath +
  "(不信其自述),按技能规则逐条 truths 验证并写 VERIFICATION.md(status: passed|gaps_found|human_needed;人工项恒列)。" +
  "确定性测试门结果(供参考,你的抽查独立于它):" + testGate +
  " 状态机检查器输出(供参考):" + stateCheck.stdout.slice(0, 600),
);
report({ stage: "首轮验证", status: verdict.status, score: verdict.score, gaps: verdict.gaps.length });

for (let round = 1; round <= 2 && verdict.status === "gaps_found"; round++) {
  phase("修复回路");
  const fixed = await executor.ask<ExecResult>(
    "验证发现缺口,修复并提交(规则同前;不重做已完成任务):\n" + JSON.stringify(verdict.gaps) +
    "\n更新 SUMMARY 偏差区。当前测试门:" + testGate,
  );
  report({ stage: "修复", round, commits: fixed.commits, blocked: fixed.blocked });
  if (fixed.blocked !== "") {
    log("修复轮受阻,停止回路:" + fixed.blocked);
    break;
  }
  if (hasTest) {
    const t = await world.run("npm", ["test"], { timeoutMs: 600000 });
    testGate = t.exitCode === 0 ? "npm test 通过(修复后)" : "npm test 仍失败(exit " + t.exitCode + ")";
  }
  const sc = await world.run("node", [CHECK], { timeoutMs: 30000 });
  verdict = await verifier.ask<Verdict>(
    "重验(再验证模式:只深验失败项 " + JSON.stringify(verdict.gaps.map((g) => g.id)) + ",已过项快速回归)。更新 VERIFICATION.md。状态机检查器:" + sc.stdout.slice(0, 400),
  );
  report({ stage: "修复后重验", round, status: verdict.status, score: verdict.score, gaps: verdict.gaps.length });
}

phase("汇总交付");
const treeStatus = await git.status().catch(() => null);
const findings: Finding[] = verdict.gaps.map((g) => ({
  where: verdict.reportPath,
  what: "真相未达成:" + g.truth,
  evidence: g.reason,
  status: "verified",
  severity: "medium",
}));
if (exec1.blocked !== "") {
  findings.push({ where: exec1.summaryPath, what: "执行受阻:" + exec1.blocked, evidence: "执行者报告", status: "unconfirmed", severity: "medium" });
}
try {
  await artifact.file("verification", verdict.reportPath, { title: goalText + " — 验证报告", description: "goal-backward 独立验证的完整报告(四态真相 / 工件三层 / gap 清单)", primary: true });
} catch {
  await artifact.markdown("verification-fallback", "# " + goalText + "\n\n状态:" + verdict.status + " " + verdict.score + "\n\n缺口:\n" + verdict.gaps.map((g) => "- " + g.id + " " + g.truth + ":" + g.reason).join("\n"), { title: "验证摘要(报告文件缺失,摘要兜底)" });
}
const conclusionLine =
  verdict.status === "passed"
    ? "目标达成(验证 " + verdict.score + ")"
    : verdict.status === "human_needed"
      ? "代码侧验证 " + verdict.score + ",但有人工项待你确认后才算完成"
      : "修复预算用尽仍有 " + verdict.gaps.length + " 个缺口,需要人工介入";
const notCovered: string[] = [];
if (!hasTest) notCovered.push("测试门:项目未定义 package.json test script,未运行任何测试");
if (verdict.humanItems.length > 0) notCovered.push("人工验证项(机器验不了):" + verdict.humanItems.join(";"));
if (treeStatus !== null && !treeStatus.clean) notCovered.push("git 工作树仍有未提交内容(执行者应清理)");
if (stateCheck.exitCode !== 0) notCovered.push("状态机检查器未转绿(工件契约或 STATE 一致性问题,见上)");
const reviewHint = "另有 " + autoDecisions + " 条自主决策记录在 " + discuss.contextPath + "([ASSUMED] 标注),是本 agent 的技术判断,可直接推翻——没有为它们打断你。";

return {
  conclusion: "「" + goalText + "」:" + conclusionLine + "。提交 " + exec1.commits + " 个;产物在 .planning/(STATE/CONTEXT/PLAN/SUMMARY/VERIFICATION)。" + reviewHint,
  findings,
  verified: [testGate, "执行提交数 " + exec1.commits + "(SUMMARY 实测)", "独立 goal-backward 验证:" + verdict.score + "(" + verdict.reportPath + ")", "状态机检查器退出码 " + stateCheck.exitCode + "(工件契约与 STATE 一致性)"],
  notCovered,
} satisfies WorkflowReport;