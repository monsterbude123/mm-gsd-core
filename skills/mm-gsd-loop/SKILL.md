---
name: mm-gsd-loop
description: "极简 GSD 主循环:discuss→plan→execute→verify→ship 五步成环 + STATE 状态工件 + fast 通道分级 + 暂停恢复协议。任何超过一步的工作先立 phase 再动手。"
---

# MM-GSD 主循环

## 工件布局(所有环节遵守,检查器按此推导状态)

```
.planning/
├── STATE.md                        # 唯一状态入口;frontmatter.status ∈ {discussing,planning,executing,verifying,completed,shipped,reopened,paused}
├── HANDOFF.md                      # 仅 paused 时存在
├── REQUIREMENTS.md                 # REQ-N 编号的唯一出处(discuss 落盘)
└── <NN>-CONTEXT.md / <NN-MM>-PLAN.md / <NN-MM>-SUMMARY.md / <NN>-VERIFICATION.md / <NN-MM>-SHIP.md / <NN>-RESEARCH.md
    (phase 用 NN 前缀;多 phase 可放 .planning/phases/<NN-slug>/ 下,检查器两种布局都认)
```

命名规则:`<phase>[-<plan>]-<类型>.md`,类型固定为 CONTEXT/PLAN/SUMMARY/VERIFICATION/SHIP/RESEARCH。**检查器只看文件存在性与 frontmatter 契约**——文件名不对,状态机就推导错。工件链 = CONTEXT → PLAN → SUMMARY → VERIFICATION → SHIP;**只有 SHIP 落盘才推出 `shipped`**(最后一环最容易被省掉)。

## 冷启动(项目里还没有 .planning/STATE.md 时)

一条命令,不要手搓模板:`node ~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs --init "<一句话项目目标>"`。它建好 STATE 并告诉你下一步(已有 CONTEXT.md 会提示不必重来)。**为什么必须是命令**:门禁要求 STATE 存在,但建 STATE 是 loop 的职责、不是 discuss 的 —— 门禁要的东西执行方做不到,就不是门禁,是死锁。

- **新项目**:一句话目标 → 建 STATE(REQUIREMENTS.md 不在冷启动建 —— REQ-N 是 verify 逐条对 verdict 的对象,discuss 落盘)→ 第一个 phase 定为 walking skeleton,选型集中在其 CONTEXT 里定(D-NN)。
- **现存项目**:先读 README / AGENTS.md / package.json 再建 STATE(Project Reference 从现有代码提炼,**不装作绿地**),从 issue tracker 倒推 REQ;项目已有约定优先于本技能默认,冲突记为偏差。
- 冷启动是 loop 的职责 —— discuss 只产 CONTEXT。职责唯一,免得两个入口抢着建。

## 工件归属边界

| 类 | 位置 | 入库? | 内容 |
|---|---|---|---|
| **流程记忆** | `.planning/` | **否** | STATE / CONTEXT / PLAN / SUMMARY / VERIFICATION / HANDOFF / RESEARCH |
| **业务产出** | 项目既有票面目录 | **是** | 缺陷票 / 设计稿票 / DAG / 票面 README |

三个要点:`.planning/` 被双排除是既定决定不是漂移,直接落盘别改规则;业务目录入库确需 `git add -f`,该动作只用于业务产出;代码/测试/配置照常进 git。

## 分级路由(动手前先判断)

先分**入口**,再分**规模** —— 两个问题,混在一起会走错路。

**入口**:需求(想做功能/改进)→ 五步成环;异常(门禁红了但输入没错 / 测试挂了 / 行为与文档不符 / 指令自相矛盾)→ **先调 `mm-gsd-diagnose --diagnose`**,定位根因再进 plan,诊断期间不改代码(改代码污染现象)。

**规模**:**fast 通道** = ≤3 文件、≤1 分钟、无新依赖、无架构变更、无需调研 → 直接做 + verify 转绿后原子提交 + STATE 记一行,不立 phase 不建 PLAN 不开子代理;超出任一条件立即转完整循环,不降级执行 —— **「小改动」不是跳过验证的理由,只是不建 PLAN**。**完整循环**:其余一切,一个 phase 一个目标,五步不可省。

## 五步成环(是环不是线)

1. **discuss** → 调用 mm-gsd-discuss。**灵魂环节**:执行期偏差的源头多半是讨论期没捕获的隐含期望;捕获标准是"下游不再需要追问用户"。纯基础设施/路径清晰/决策已全在 CONTEXT → 可跳过,不硬凑问题。
2. **plan** → 调用 mm-gsd-plan。PLAN 落盘后必须 `--plan` 转绿;**预审门**:执行前由编排层调用 mm-gsd-plan-check(全新上下文),产出 PLAN-CHECK 工件,`status` 非 passed **不许进执行**。也可手动跑 `node ~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs --plan-check <PLAN>`;用户问「这份计划能开工吗」时调技能,别凭印象回答。**收敛判据与轮次上限见 mm-gsd-plan-check「收敛判据」节**(机器门绿 ∧ 零 BLOCKER ⇒ 开工;WARNING 归 Deferred;上限 2,到顶升级到人)。产品面变更的 PLAN 声明 `product_surface: REQ-N…`。
3. **execute** → 调用 mm-gsd-exec。**施工方,不是设计师**:照票施工,不重做调研、不重新理解项目、**不审批**(图纸对不对是 verify 的活)。
4. **verify** → 调用 mm-gsd-verify。验证不过 → 回 execute 修 → 重 verify;每条 REQ 拿到证据才准进 ship。修复预算 2 次,超了升级到人(执行侧「同一根因 ≤2 次」与验证侧「重验 2 轮」是两件事)。
5. **ship** → 交付物**被消费**才算完成(PR 已开/合并/发布),落 `<NN>-MM-SHIP.md`(模板 templates/ship.md)。**验证通过不等于交付**:没有 SHIP,状态机停在 completed。STATE 勾 phase = SHIP 落盘之后;声明 product_surface 的批次在 req-ledger 落 delivered 行。

**ship 硬要求**:写 `delivered` 前先核对真的被消费了,证据写具体;受阻写 `status: held` 并说明(蒙混成 shipped 会让整个 phase 判成终态)。删数据/force push/动生产/发布属拍板权第 2/3 类,**先问用户**。

## 完成后

phase 走完五步环(SHIP 落盘、交付物被消费)→ 下一步是**下一个 phase**:回到 `mm-gsd-discuss` 或 `mm-gsd-plan`;环没走完按「五步成环」接着走。

## 门禁接线(每步跑哪个模式,不是"想起来才跑")

`CK=~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs`,下表 `node $CK` 代指:

| 时点 | 命令 | 转绿才准进入下一步 |
|---|---|---|
| 项目无 STATE | `--init "<目标>"` | 建好 STATE;不要手搓、不要留给"下一步" |
| phase 清单定完 | `--phases` | 波次无环、同波次零重叠 |
| PLAN 落盘 | `--plan` | 四件套 + read_first 齐、失败方向明确、预算未超;PLAN-CHECK passed 才准进执行;顺带打印过程健康三数(票/受阻/缺口 —— 过程健康,不是质量分) |
| 每步收尾 | 默认(无参数) | 声明与工件推导一致、无假完成信号、无交付缺口 |
| 开多 worktree 前 | `--worktrees` | 跨 worktree 文件与 REQ 无冲突 |
| 改了模板或技能 | `--templates` / `--routes` | 模板合规;每个技能说清了下一步 |
| 排查 | `--stats` | 反复失败 = 死锁嫌疑 |
| 改了检查器正则 | `--selfcheck` | 门禁对自己用例仍全绿 |

每步收尾 = 跑检查器转绿(含把 STATE status 改为 derived,是转绿的一部分)。**门禁必须自带解法**:转绿需要的东西这一步做不到,门禁就是挡路的墙。分层采样与批量收尾细节、遥测、报修、worktree、三层门禁宿主矩阵、pre-commit → `references/operations.md`。

## 拿不准就去查参考系

mm-gsd 是从更大项目蒸馏的,丢掉的部分往往是「为什么这么设计、哪些做法被否掉了」。查 `references/reference-map.md` 对照表 → 读对应文件 → 结论**落盘**进 CONTEXT 或提交描述(没落盘的参考等于没参考)。理论在 `docs/theory.md`(含「明确排除的做法」)。**不是照抄** —— 参考的是判据与理由,不是实现;查完发现缺了什么,记进对照表「已知差距」。

## 派活纪律(编排层的硬边界)

- **探索一律外包**(完整循环):调研/搜代码/读实现文件一律派子代理,主上下文只拿摘要 + 落盘路径。**实施也外包**,只给路径与目标;**计划复核也外包** —— 全新上下文只读子代理,自己写自己审不算数。
- **一批 = 一张 PLAN,一票 = 一个子代理**:一次只派一批;同批零文件重叠才可并行。
- **单票硬预算**:一个子代理 20 分钟的量(≤5 文件、≤1 条 verify);超量或超时 → **停下升级**,不静默续做。
- **主上下文只管 todo 与进度**:todo 记「票 → 状态 → 结论」,不记实现细节;进度靠 STATE digest。
- **并发 ≤4 + 同票复用代理**:同一时刻最多 4 个子代理;同一张票复用同一代理(预审/修票/销号复核同一人,增量销号才有效)——三条挂不上机器门的收敛纪律之一(C-06)。

## 黄金纪律

- 每步产出**落盘**,不留在对话里;位置按「工件归属边界」分流。
- 主会话只做编排与验收(上下文占比 ≤15%),只传路径不传内容;用全新 agent 续做,不做进程内 resume。
- 卡住或依赖缺失:记 blockers,跳过继续无依赖任务,不空转重试。
- 时效三层(冻结层/活跃层/临时层)与 deferred 卫生(三列 + 处置台账)的定义 → `references/operations.md`。
- **正在工作的执行者不被催促**:有近期活动就继续等;不注入催促,那会截断正确的运行(#4218)。

## 拍板权(谁能问用户)

**技术细节一律自己决定**:选库、命名、重构边界、测试写法 —— 按项目约定定,记进 PLAN 的 Auto Decisions 节(`[AUTO]` + 一句理由;`[AUTO]` 的家只有 PLAN 一处)。技术问题的正确解法是查项目事实,不是问人;拿不准就去查,查不到选合理默认标明。

**只有这五类停下问用户**,且必须带选项、代价和推荐:①产品取舍(用户可感知地不同);②不可逆/破坏性(删数据/force push/发布/动生产);③花钱/外部副作用(付费 API/部署/真实消息);④法律/合规;⑤只有用户知道的输入(凭据/生产地址)。其余自己决定并记录。

## STATE.md 纪律(模板 templates/state.md)

每个循环第一步**先读** STATE,执行后更新。全文 **<100 行** —— 是 DIGEST 不是档案;`## Current Position` 整节覆写不追加;决策只留 3-5 条近期;blockers 只留活跃的;按索引地图分层(L0 一句话 / L1 阶段目录 / L2 当前明细),不堆散文。phase 完成 = 勾当前项 + 推进位置 + STATUS 推进;测试不过不标完成。

## 暂停与恢复(HANDOFF)

会话中断时写 `.planning/HANDOFF.md`(不 commit;含:当前 phase/plan/task、已完成/剩余清单、决策、blockers、`git status --porcelain` 实测未提交文件,绝不取整为空)。**业务侧交接另写进业务票面目录并入库** —— 那是给团队的。恢复顺序:HANDOFF → STATE → 未完成的 PLAN(有 PLAN 无 SUMMARY = 未完成,续做不重做)。

## 预授权与自动续行

- **计划期预授权**:PLAN 里列出执行期可能要问人的点,规划时替用户定夺标 `[AUTO]` + 依据 —— 提问成本从执行期挪到规划期;预授权不匹配实际选项时**不许静默选一个**,停下升级。
- **不无限等**:子代理没发完成信号但 commits 可见 + SUMMARY 存在 → **按成功继续**(信号可能丢,文件系统不会说谎)。
- **非失败重新分类**:认证失败 = 等凭据;限流 = 等额度恢复再 resume,不要立刻重试烧配额;环境起不来 = 自己修。把"我跑不动"分类成已知状态,agent 就不会中途放弃。

## 状态机 = 工件存在性(可查询)

状态不是记录,是**从工件推导**:CONTEXT→PLAN→SUMMARY→VERIFICATION→SHIP。每步收尾跑检查器(加 `--json` 供程序消费),它做四件事:推导真实状态并与 STATE 声明比对(不符即错);工件字段契约(SUMMARY status∈{complete,halted}、commits 纯数字实测;VERIFICATION status∈{passed,gaps_found,human_needed};SHIP status∈{shipped,held});交付缺口(验证过没 SHIP → 警告);假完成信号(占位文本/STATE 超 100 行/paused 无 HANDOFF)。退出码 0 = 一致。

## 点修(已交付 phase 的快速修复)

已交付 phase 的细节缺陷(看板批注 type=验收不过、verify 新 gap)→ **不开新 phase、不贴疤**,走点修。分流判据三条全满足才点修,任一超出 → 升级新 phase(升级不是失败,是范围扩张的正确通道):不新增 REQ;不改 CONTEXT 的 D-NN;修复面 ≤5 文件。

R 票形态(命名钉死,checker 推导依赖):`.planning/<NN>-Rk-PLAN.md` 挂原 phase,四件套照填,verify 重验没达标的那条 truth;`<NN>-Rk-SUMMARY.md` 收口;VERIFICATION 的「## 重验记录」逐票追加;关联批注标 digested;预审走点修轻量三查(mm-gsd-plan-check)。STATE 翻转:开出时 reopened,重验 passed 改回 shipped —— STATE 不许说谎。**上限**:同一 truth/根因 R 票 ≤2 张;phase 累计 ≥3 → 强制升级。与 fast 通道分清:fast 不建工件;点修挂原 phase,全链可追溯。

## 假完成检测

占位文本("To be filled"/"placeholder"/"TBD")= 未完成;SUMMARY 缺失或无对应提交 = 未完成;完成判定要 SUMMARY + 提交双证。旧 PLAN 三态(未完成/没记账/过时)判据见 `references/historical-artifacts.md` —— 认出「做完了却没记账」最要紧,当成未完成重做一遍最贵。

## 引导安装/体检

`node ~/.agents/skills/mm-gsd-loop/scripts/mm-gsd-install.mjs`(交互)/ `--check`(只体检)。做:检测现状 + 列待修项 + 按需装宿主 hook + 询问 pre-commit(默认否)。不负责冷启动。已实测:幂等、合并不覆盖既有配置、备份只留最初原件。宿主矩阵、遥测、报修、worktree、pre-commit、失效模式自查 → `references/operations.md`。
