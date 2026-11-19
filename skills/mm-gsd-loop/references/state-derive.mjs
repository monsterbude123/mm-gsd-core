// 状态机工件契约判定(phase 30 30-03 从 gsd-state-check.mjs 拆出):
// SUMMARY 字段契约 / 提交 scope 警告 / 记账门与预审工件门接线 / 交付契约 /
// 声明 vs 推导 / 占位文本。判据逐字保留 —— 报错文案是使用方在看的契约。
// 形态:带 root/base 与注入 err/warn 的判定模块(与既有 26 个模块同形;
// 块里的 err/warn 调用点原样保留,主文件把闭包显式传入)。
// 行为证明:夹具 selftests/fixtures/state-demo/ + baseline.json 逐字断言(见 selftest-suite.mjs)。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export async function stateContracts(x) {
  // validateVerification 在主文件 import 于搬移段之外 —— 模块内自行按同路径取
  const { validateVerification } = await import("../references/template-gates.mjs");
  const {
    root, base, artifactInfo, frontmatter, unquote, parsePlanFile,
    derived, declared, err, warn, argvJson,
    SUMMARY_STATUSES, VERIF_STATUSES, SHIP_STATUSES, STATUSES, PLACEHOLDER, NO_DIRECTION,
  } = x;
  const P = (...s) => join(root, ".planning", ...s);
  const J = (f) => join(base, f);

  for (const s of artifactInfo.summaries) {
    const sfm = frontmatter(J(s));
    if (!sfm?.status) err(`${s}: 缺 status(须为 ${SUMMARY_STATUSES.join("|")})`, "补 frontmatter;受阻就如实写 halted,别不写");
    else if (!SUMMARY_STATUSES.includes(sfm.status)) err(`${s}: status 非法值 "${sfm.status}"`, `改为 ${SUMMARY_STATUSES.join(" 或 ")}`);
    else if (sfm.status === "halted") warn(`${s}: status=halted —— 有未解决的阻碍目标,不算完成`, "补修复计划或如实留待下个 phase;别拿它当完成");
    if (sfm && !/^\d+$/.test(sfm.commits ?? "")) err(`${s}: commits 非纯数字 "${sfm.commits ?? "(缺)"}" —— 必须 git rev-list 实测`, "git rev-list --count <base>..HEAD");
  }
  // ---- 提交 scope 警告(phase 15 D-02):commits 数字实测的另一半 —— 主题里没有 (<票号>): scope 就是人工回填(issue #19 实测 2 票)----
  // 黄不拦红:commits 数字本身已由上面契约实测过,scope 是质量提示;与 commits(全批数)同口径比较。
  // git 缺席/非仓库/取数失败 → 静默跳过(外部依赖不在不能判红的先例)。部分混提是 info,只走文本通道,不给 --json 加新形状。
  {
    let subs = null;
    const gitSubjects = () => {
      if (subs !== null) return subs;
      try {
        const r = spawnSync("git", ["log", "--format=%s"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        subs = r.status === 0 ? String(r.stdout || "").split(/\r?\n/).filter((x) => x.trim()) : null;
      } catch { subs = null; }
      return subs;
    };
    for (const s of artifactInfo.summaries) {
      const sfm = frontmatter(J(s));
      if (sfm?.status !== "complete" || !/^\d+$/.test(sfm?.commits ?? "") || Number(sfm.commits) <= 0) continue;
      const subjects = gitSubjects();
      if (!subjects) continue;
      const phase = unquote(String(sfm.phase ?? "")).trim() || s.slice(0, 2);
      // 票号集合:frontmatter plan 字段,逗号/顿号多值(跨票 SUMMARY 先例,ticket-alive 同口径);无 plan 字段退回文件名单值
      const ids = (sfm.plan ? unquote(sfm.plan).split(/[,,、\s]+/) : [s.replace(/-SUMMARY\.md$/, "")])
        .filter(Boolean).map((p) => (p.includes("-") ? p : `${phase}-${p}`));
      if (!ids.length) continue;
      const scoped = subjects.filter((sub) => ids.some((id) => sub.includes(`(${id}):`))).length;
      const commits = Number(sfm.commits);
      if (scoped === 0)
        warn(`${s}: commits=${commits} 但提交主题无 (${ids.join("|")}): scope —— commits 是人工回填或 scope 缺失(exec SKILL);补 scope 或改用 mm-gsd summary 重新生成`);
      else if (scoped < commits && !process.argv.includes("--json"))
        console.log(`  · ${s}: 部分提交混提(scope 精确命中 ${scoped}/${commits})`);
      // ---- SUMMARY↔git 对账(phase 16 D-02):票外实碰文件未在 SUMMARY 声明 → 黄 ----
      // 差集基准 = ids 展开后全部对应 PLAN 的 files_modified 并集;提交归属按主题 scope。
      // 提及检测先归一化(两侧斜杠统一,全路径子串,不中再「末两段路径」兜底)。
      {
        const planNames = ids.map((id) => id + "-PLAN.md").filter((n) => artifactInfo.plans.includes(n));
        if (planNames.length) {
          const planFiles = new Set();
          for (const pn of planNames) {
            for (const f of parsePlanFile(readFileSync(J(pn), "utf8")).files) planFiles.add(f.replace(/\\/g, "/"));
          }
          if (planFiles.size) {
            // 提交块用 %x1e(记录分隔符)切,不要靠行首 "(" 切 —— 主题开头有没有 "(" 取决于作者怎么写,
            // 靠它切块会把后面每一笔提交的文件全算到最新那笔头上(实测:别的批次的文件被报成"票外实碰")。
            const r2 = spawnSync("git", ["log", "--name-only", "--format=%x1e%s"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
            if (r2.status === 0) {
              const touched = new Set();
              // git log --format=%x1e%s --name-only 输出形状(实测):\x1e主题 \n 空行 \n 文件行 \n\x1e主题 …
              for (const block of String(r2.stdout || "").split("\x1e")) {
                const bl = block.split(/\r?\n/).map((x) => x.trim()).filter((x) => x);
                if (!bl.length) continue;
                if (!ids.some((id) => bl[0].includes(`(${id}):`))) continue;
                for (const f of bl.slice(1)) touched.add(f.replace(/\\/g, "/"));
              }
              const sumText = readFileSync(J(s), "utf8").replace(/\\/g, "/");
              const undeclared = [...touched].filter((f) => {
                if (planFiles.has(f)) return false;
                if (sumText.includes(f)) return false;
                const seg2 = f.split("/").slice(-2).join("/");
                return !sumText.includes(seg2);
              });
              for (const f of undeclared)
                warn(`${s}: 票外实碰文件未在 SUMMARY 声明:${f} —— 偏差区纪律的机器化(16-CONTEXT D-02);在 SUMMARY 偏差区补记,或回退该改动`);
            }
          }
        }
      }
    }
  }
  // ---- 记账纪律随包分发(D-02):「声称完成却零 commit」当场判红 ----
  // 记账门只判这一条 —— 「这张票认领了哪条决策」由 phase 级 union 门判(D-03),
  // 一个判定只能有一个 owner;两处各判一半,判据还各说各话。
  // 存量项目的老工件会立刻变红,豁免台账(.planning/artifact-ledger.md)是随包件:
  // 记一行指向一个真实存在的 commit,原件不动。
  {
    const { checkArtifactLedger } = await import("../references/artifact-ledger.mjs");
    checkArtifactLedger({ root, report: { pass: () => {}, fail: (m) => err(m), info: (m) => warn(m) } });
    // 本地账三选一门(phase 19 D-11,RC2 解药):诊断过的坑不许裸放 —— e 通道,记账门旁
    for (const m of (await import("../references/verification-gates.mjs")).checkIssueLedger({ root }))
      err(m, "三选一:status 改 closed/fixed 销账;或全文挂 REQ-NN;或挂机器门名(check-…);或在 .planning/issues/LEDGER.md 登记一行");
    const { checkPlanCheckArtifacts } = await import("../references/ticket-alive.mjs");
    // 预审工件契约(phase 09 D-08):形状要对;已经开工却没有预审结论 → 不许静默跳过。
    // phase 级收敛工件在场 ⇒ 票级预审被取代(R-26)—— 与 checkPlanReady 同一口径。
    // 两处口径不一致会让「29 起按 phase 一次预审」的新流程每张票都恒红(有收敛工件仍报缺票级工件)。
    // 取代按**票自己的 phase 号**算(票文件名前缀),不用 STATE 的 active_phase ——
    // active_phase 为空或跨 phase 时,两条路会得出相反结论。
    const { readPhaseConvergence } = await import("../references/plan-ready.mjs");
    const supersededPhases = new Set();
    for (const pf of artifactInfo.plans) {
      const ph = (pf.match(/^(\d+)/) || [])[1] ?? "";
      if (!ph || supersededPhases.has(ph)) continue;
      if (readPhaseConvergence(base, ph).present) supersededPhases.add(ph);
    }
    for (const m of checkPlanCheckArtifacts({ dir: base, plans: artifactInfo.plans, summaries: artifactInfo.summaries, frontmatter, supersededPhases }))
      err(m, "先派一个全新上下文的只读子代理做预审(见 mm-gsd-verify「执行前预审」),产出 .planning/<NN-MM>-PLAN-CHECK.md");
  }
  if (artifactInfo.verification) {
    const vfm = frontmatter(J(artifactInfo.verification));
    if (!vfm?.status) err(`${artifactInfo.verification}: 缺 status(须为 ${VERIF_STATUSES.join("|")})`, "补 frontmatter");
    else if (!VERIF_STATUSES.includes(vfm.status)) err(`${artifactInfo.verification}: status 非法值 "${vfm.status}"`, `改为 ${VERIF_STATUSES.join(" 或 ")}`);
    // status 合法 ≠ 报告诚实。这条闸拦的是「正文 4 条 FAILED、frontmatter 却写 passed」
    for (const i of validateVerification(readFileSync(J(artifactInfo.verification), "utf8"), vfm.status)) i.level === "warn" ? warn(`${artifactInfo.verification}: ${i.message}`, i.fix) : err(`${artifactInfo.verification}: ${i.message}`, i.fix);
  }
  // D-04 要求漂移门管四类工件,--plan 那条只管 PLAN;验收/交付两份在这里补上
  if (artifactInfo.context) {
    const { checkConclusionDrift } = await import("../references/decision-gates.mjs");
    const concl = [[artifactInfo.verification, "验收"], [artifactInfo.shipment, "交付"]].filter(([f]) => f);
    for (const i of checkConclusionDrift({ ctxPath: J(artifactInfo.context), items: concl.map(([file, kind]) => ({ kind, file, path: J(file) })) }))
      i.level === "warn" ? warn(i.message, i.fix) : err(i.message, i.fix);
  }
  // ---- 交付契约:交付物"被消费",不是"被做完" ----
  if (artifactInfo.shipment) {
    const shm = frontmatter(J(artifactInfo.shipment));
    if (!shm?.status) err(`${artifactInfo.shipment}: 缺 status(须为 ${SHIP_STATUSES.join("|")})`, "补 frontmatter;受阻就如实写 held");
    else if (!SHIP_STATUSES.includes(shm.status)) err(`${artifactInfo.shipment}: status 非法值 "${shm.status}"`, `改为 ${SHIP_STATUSES.join(" 或 ")}`);
    if (shm?.status === "shipped") {
      const ev = unquote(shm.delivered ?? "");
      if (!ev || NO_DIRECTION.test(ev)) err(`${artifactInfo.shipment}: delivered 缺交付证据`, "填 PR 链接 / 合并 commit / 发布单号 —— 交付是被消费的,不是被完成的");
      else if (/[<>]/.test(ev)) err(`${artifactInfo.shipment}: delivered 还是模板占位符`, "替换成真实位置(PR 链接 / 合并 commit / 发布单号);尖括号包着的是说明,不是证据");
      if (shm.docs_synced !== "yes") warn(`${artifactInfo.shipment}: docs_synced != yes —— 用户可见变更没同步文档`, "改了用法/接口/配置就更新文档;没改写 no 并说明");
    }
  } else if (derived === "completed") {
    warn("验证已通过但没有 SHIP 工件 —— 本 phase 停在验证,没走到交付", "写 <NN>-MM-SHIP.md(status/delivered/docs_synced);交付物被消费才算完成");
  }
  // ---- STATE 声明 vs 推导 ----
  if (declared && !STATUSES.includes(declared)) {
    err(`STATE status "${declared}" 非法`, `改为 ${STATUSES.join("|")}`);
  }
  if (declared && derived && declared !== derived && declared !== "paused") {
    err(`STATE 声明 "${declared}" 但工件推导是 "${derived}" —— 请将 .planning/STATE.md 的 status: 改为 "${derived}" 后重跑`, `把 STATE status 改为 ${derived}(或补齐缺失工件)`);
  }
  if (declared === "paused") {
    const hasHandoff = existsSync(P("HANDOFF.md")) || existsSync(P("HANDOFF.json"));
    if (!hasHandoff) warn("paused 但无 HANDOFF.md —— 中断后无法快速恢复", "写 HANDOFF(位置/已完成/未提交文件实测)");
  }

  // ---- 占位文本(假完成信号)----
  for (const f of [...artifactInfo.summaries, ...(artifactInfo.verification ? [artifactInfo.verification] : []), ...(artifactInfo.shipment ? [artifactInfo.shipment] : [])]) {
    const text = readFileSync(J(f), "utf8");
    if (PLACEHOLDER.test(text)) warn(`${f}: 含占位文本 —— 判假完成风险(Known Stubs 节里的合法描述可忽略)`, "填真实内容或移到 Known Stubs 并说明原因");
  }
}
