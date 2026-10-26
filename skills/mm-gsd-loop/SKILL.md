---
name: mm-gsd-loop
description: "极简 GSD 主循环:discuss→plan→execute→verify→ship 五步成环 + STATE 状态工件 + fast 通道分级 + 暂停恢复协议。任何超过一步的工作先立 phase 再动手。"
---

# MM-GSD 主循环

## 工件布局(所有环节遵守,检查器按此推导状态)

```
.planning/
├── STATE.md                        # 唯一状态入口;frontmatter.status ∈ {discussing,planning,executing,verifying,completed,shipped,paused}
├── HANDOFF.md                      # 仅 paused 时存在
├── REQUIREMENTS.md                 # REQ-N 编号的唯一出处(冷启动时建)
└── <NN>-CONTEXT.md / <NN-MM>-PLAN.md / <NN-MM>-SUMMARY.md / <NN>-VERIFICATION.md / <NN-MM>-SHIP.md / <NN>-RESEARCH.md
    (phase 用 NN 前缀;多 phase 可放 .planning/phases/<NN-slug>/ 下,检查器两种布局都认)
```

命名规则:`<phase>[-<plan>]-<类型>.md`,类型固定为 CONTEXT/PLAN/SUMMARY/VERIFICATION/SHIP/RESEARCH。**检查器只看文件存在性与 frontmatter 契约**——文件名不对,状态机就推导错,每步收尾报错。

**工件链 = CONTEXT → PLAN → SUMMARY → VERIFICATION → SHIP**:最后一环最容易被省掉 —— VERIFICATION 通过只推出 `completed`,**只有 SHIP 落盘才推出 `shipped`**。

## 冷启动(项目里还没有 .planning/STATE.md 时)

**一条命令,不要手搓模板**:

```bash
node ~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs --init "<一句话项目目标>"
```

它建好 `.planning/STATE.md`,并告诉你下一步该做什么(检测到已有 CONTEXT.md 会提示讨论已完成的部分不必重来)。

**为什么必须是命令而不是纪律**:门禁要求 STATE 存在,但建 STATE 是 loop 的职责、不是 discuss 的 —— agent 在 discuss
结束时跑门禁会报"未初始化"并卡住,而它站在这一步造不出 STATE。**门禁要的东西,执行方做不到,那它就不是门禁,是死锁。**

- **新项目**:一句话目标 → 建 STATE + `REQUIREMENTS.md`(REQ-N 是 verify 逐条对 verdict 的对象,没有它闭环断裂)→ 第一个 phase 定为 walking skeleton:最薄可运行骨架,选型集中在这个 phase 的 CONTEXT 里定(D-NN)。
- **现存项目**:先读 README / AGENTS.md / CLAUDE.md / package.json 再建 STATE(Project Reference 从现有代码提炼,**不装作绿地**),从 issue tracker 倒推 REQ。第一个 phase 挑小而有价值的改动,不上大重构;项目已有约定优先于本技能默认,冲突记为偏差。
- 冷启动是 loop 的职责 —— discuss 只产 CONTEXT。职责唯一,免得两个入口抢着建。

## 工件归属边界(先分清两类产出,再决定放哪)

| 类 | 位置 | 入库? | 内容 |
|---|---|---|---|
| **流程记忆** | `.planning/` | **否** | STATE / CONTEXT / PLAN / SUMMARY / VERIFICATION / HANDOFF / RESEARCH |
| **业务产出** | 项目既有票面目录(如 `.scratch/<主题>-<日期>/`) | **是** | 缺陷票 / 设计稿票 / DAG / 票面 README |

两类混放会让下一棒分不清哪些是共享契约、哪些是临时状态。三个要点:

- `.planning/` 若已被 gitignore / exclude 双排除,那是**既定决定不是漂移** —— 直接落盘,别改排除规则、别 `git add -f`。
- 业务票面目录常被 exclude,入库确需 `git add -f`;该动作**只用于业务产出**。
- 代码 / 测试 / 配置照常进 git。

## 分级路由(动手前先判断)

先分**入口**,再分**规模** —— 这是两个问题,混在一起会走错路。

**入口:这是需求,还是异常?**

- **需求**(想做某个功能/改进)→ 走下面的五步成环
- **异常**(门禁红了但输入没错 / 测试挂了不知从哪挂 / 行为与文档不符 / 指令自相矛盾)→
  **先调 `mm-gsd-diagnose --diagnose`**,定位到根因再进 plan。诊断与修复是分离的两个模式,
  诊断期间不改代码 —— 改代码会污染现象。详见 `mm-gsd-diagnose` 的「诊断与修复分离」节。

**规模:**

- **fast 通道**:≤3 文件、≤1 分钟内可完成、无新依赖、无架构变更、无需调研 → 直接做 + **verify 转绿后**原子提交 + STATE 记一行。不立 phase、不建 PLAN、不开子代理。超出任一条件立即停下转入完整循环,不降级执行。**「小改动」不是跳过验证的理由,只是不建 PLAN。**
- **完整循环**:其余一切工作。一个 phase 一个目标,phase 可小到一个 PR,但五步不可省。

## 五步成环(是环不是线)

1. **discuss** → 调用 mm-gsd-discuss。**灵魂环节**:执行期的一切偏差,源头多半是讨论期没捕获的隐含期望;捕获标准是"下游不再需要追问用户"。纯基础设施、实现路径清晰、或决策已全在 CONTEXT → 可跳过,不硬凑问题。
2. **plan** → 调用 mm-gsd-plan。**PLAN 落盘后必须跑 `--plan` 转绿再进下一步**(见「门禁接线」)。
   **预审门**:PLAN 落盘后、执行前,**由你(编排层)**开一个**全新上下文的只读子代理**,按 `mm-gsd-verify` 的
   「执行前预审」节复核这份计划,产出 `.planning/<NN-MM>-PLAN-CHECK.md`;`status` 不是 `passed` → **不许进执行**
   (机械合规过了不等于这份计划成立)。预审子代理多半不能自己再派子代理 —— 你派它,别让 plan 派。
   **这条门可以随时手动跑**:`node ~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs --plan-check .planning/<NN-MM>-PLAN.md`
   (= `mm-gsd check --plan-check <路径>`)会跑完整的机器判据 + 核对预审工件,直接给出「能不能开工」。
   用户问「这份计划能开工吗」时跑它,别凭印象回答;预审没做时它会把该派的子代理提示词直接打印出来。
3. **execute** → 调用 mm-gsd-exec。**施工方,不是设计师**:照 PLAN 那张票施工,只核对自己落的与图纸对不对得上;不重做调研、不重新理解项目、**不审批**(图纸对不对是 verify 的活)。
4. **verify** → 调用 mm-gsd-verify。**验证不过 → 回 execute 修 → 重 verify;每条 REQ 拿到证据才准进 ship。修复预算 2 次,超了升级到人。**(执行侧「同一根因自动修 ≤2 次」与验证侧「重验 2 轮」是**两件事**:前者管一次施工里能自己修几回,后者管 gap 修完能重验几轮。)
5. **ship** → 交付物**被消费**才算完成(PR 已开/已合并/已发布),用户可见变更同步文档,并落
   `.planning/<NN>-MM-SHIP.md`(模板见 templates/ship.md)。**验证通过不等于交付**:没有 SHIP 工件,状态机停在 `completed`,
   检查器会警告"停在验证没走到交付"。STATE 勾掉本 phase 的时点 = SHIP 落盘之后。

**ship 步的硬要求**:写 `delivered` 之前先核对东西真的被消费了(PR 无阻断 / 已合并 / 已发布),证据写具体;受阻就写
`status: held` 并说明阻碍(蒙混成 shipped 会让状态机把整个 phase 判成终态)。涉及删数据、force push、动生产、发布,属于拍板权第 2/3 类,**先问用户**。

## 完成后

这个 phase 走完五步环(SHIP 落盘、交付物被消费)→ **下一步是下一个 phase**:回到 `mm-gsd-discuss` 或 `mm-gsd-plan`;环没走完就按上面「五步成环」接着走。

## 门禁接线(每步跑哪个模式,不是"想起来才跑")

`CK=~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs`,下表用 `node $CK` 代指。

| 时点 | 命令 | 转绿才准进入下一步 |
|---|---|---|
| 项目无 STATE | `--init "<目标>"` | 建好 STATE;**不要手搓,也不要把建 STATE 留给"下一步"** |
| phase 清单定完 | `--phases` | 波次无环、同波次零重叠 |
| PLAN 落盘 | `--plan` | 四件套齐、失败方向明确、文件清单可解析、预算未超;顺带打印本 phase 过程健康三数 |
| 每步收尾 | 默认(无参数) | 声明与工件推导一致、无假完成信号、无交付缺口 |
| 开多 worktree 前 | `--worktrees` | 跨 worktree 文件与 REQ 无冲突 |
| 改了模板或技能 | `--templates` / `--routes` | 6 份模板结构合规;每个技能都说清了自己的下一步 |
| 排查 | `--stats` | 反复失败的同一个项目 = 死锁嫌疑 |
| 改了检查器正则 | `--selfcheck` | 门禁对自己的用例仍全绿(防 admin 路径、全角括号那类判错) |

**每步收尾的动作是"跑检查器转绿",不是"更新 STATE"**——后者是散文约定,前者是门禁。
但**门禁必须自带解法**:转绿需要的东西如果这一步做不到,门禁就变成了挡住路的墙。

**`--plan` 顺带打印本 phase 的过程健康三数**(票数 / 受阻票数 / 缺口数):量来自工件历史,
不是遥测(遥测不记 phase 维度);它测的是**过程健康,不是质量分**——别拿它当评分卡用。

**门禁分层采样(贵的门禁别放在每一步)**:

| 层 | 什么时候跑 | 跑什么 |
|---|---|---|
| 票级 | 每张票做完 | **本票的便宜检查**(具名测试 / 单文件 / 单入口)—— 票级 verify **不许**是全量套件 |
| 批级 | 一批票全做完 | 批级检查**跑一次**;失败**一次修完**,再跑一次(≤2 轮) |
| 全量 | phase 收尾 | 全量套件 + 全量 health(仓库自己的 `mmc health`) |

**批量收尾**:一批实施完 → 跑一次批级检查 → 全部失败一起修 → 再跑一次(≤2 轮)。
**不做**「改一处 → 修一次 → 测一次 → 提交一次」:逐次循环里的重复检查没有新证据,只吃上下文。
逐次提交可以(提交很便宜),但**贵的门禁不在票里跑**。

## 拿不准就去查参考系(概念模糊时的动作)

> **概念模糊、不知道该怎么做时,先查参考系,别凭印象造。**

mm-gsd 是从更大的项目蒸馏出来的。被丢掉的部分往往不是功能,而是
**「为什么这么设计」「哪些做法被否掉了、代价是什么」**。


| 东西 | 位置 |
|---|---|
| 概念→实现的对照表 | `references/reference-map.md`(本 skill 内)` |
| 规律与理论 | `docs/theory.md` |
| 被明确排除的做法 + 重开条件 | `docs/theory.md`「明确排除的做法」一节 |
| 原始参考项目 | 本机的 gsd-core 仓(路径随机器不同,不在分发包里) |

**动作**:查表 → 读对应文件 → 结论**落盘**进 CONTEXT 或提交描述(没落盘的参考等于没参考)。

**不是照抄**:参考系规模是 mm-gsd 的十倍以上,很多机制在 mm-gsd 里没有对应场景 —— 参考的是**判据与理由**,不是实现。

**查完发现 mm-gsd 缺了什么,记下来** —— 对照表里的「已知差距」是活的。

## 派活纪律(编排层的硬边界)

- **探索一律外包**:摸清现状、调研、搜代码、读实现文件 —— 一律派子代理。主上下文只拿**摘要 + 落盘路径**,
  不读实现文件本身,也不把探查结果灌进自己的上下文。(读 mm-gsd 自己的参考系不算探索 —— 那是几个短文件。)
- **实施也要外包**:施工交给子代理,你只给路径与目标。**计划复核也外包**:预审派全新上下文的只读子代理 —— 自己写自己审不算数。(原来这条只列了「研究、批量重写、验证」,漏了实施。)
- **一批 = 一张 PLAN,一票 = 一个子代理**:一次只派一批;同批零文件重叠才可并行;不要把多张票塞给一个子代理。
- **单票有硬预算**:一张票 = 一个子代理 **20 分钟**能做完的量(≤5 文件、≤1 条 verify);超量或超时 → **停下升级**,不静默续做、不接着往下堆活。
- **主上下文只管 todo 与进度**:todo 只记「票 → 状态 → 结论」,不记实现细节;进度靠 STATE digest。

## 黄金纪律

- 每步产出**落盘**(STATE/CONTEXT/PLAN/SUMMARY/VERIFICATION),不留在对话里;落盘位置按上方「工件归属边界」分流。
- 主会话只做编排与验收(上下文占比 ≤15%),只传**路径**不传内容,结论摘要传回。用全新 agent 续做,不做进程内 resume。
- 卡住或依赖缺失:记 blockers,跳过该任务继续无依赖任务,不空转重试。
- **正在工作的执行者不被催促**:等子代理/长任务时,进度看提交活动与文件变化——有近期活动就继续等;不注入"快点收尾/立即完成"类催促,那会把正确的运行截断(#4218 的教训)。

## 拍板权(谁能问用户)

- **技术细节一律自己决定,不要问用户**。选库、文件怎么组织、命名、重构边界、测试怎么写、日志级别、目录划分——按项目既有约定和你的判断定,**记进 PLAN 的 Auto Decisions 节**(标 `[AUTO]`,附一句理由),事后用户可推翻。技术问题的正确解法是查项目事实(代码/文档/配置),不是问人。
  (`[AUTO]` 的家只有 PLAN 一处 —— 执行期照的是 PLAN,不是 CONTEXT;两处都标就没人知道哪个算数。)

- **只有这五类才停下问用户**,且必须带选项、代价和推荐:
1. **产品取舍**——两种方案用户可感知地不同(功能给不给、默认行为选哪个、UI 走 A 还是 B)。
2. **不可逆/破坏性**——删数据、force push、发布、动生产配置。
3. **花钱/外部副作用**——付费 API、生产部署、向真实用户发消息。
4. **法律/合规**——许可、隐私条款。
5. **只有用户知道的输入**——凭据、生产地址、账号密码;或代码与文档里都查不到的外部事实。

不属于以上五类的疑问:自己决定并记录,继续干。不要因为"拿不准"而上浮——拿不准就去查,查不到就选一个合理默认并标明,用户看到 `[AUTO]` 条目自然会纠正。
## STATE.md 纪律(模板见 templates/state.md)

- 每个循环第一步**先读** `.planning/STATE.md`;执行后更新。
- 全文 **<100 行**——它是 DIGEST 不是档案;`## Current Position` 整节覆写不追加;决策只留 3-5 条近期(全量在 CONTEXT/git);blockers 只留活跃的。
- phase 完成 = 勾掉当前项 + 推进位置 + STATUS 推进。测试不过不标完成。

## 暂停与恢复(HANDOFF)

会话要中断时写 `.planning/HANDOFF.md`(本地工件,不 commit;内容为:当前 phase/plan/task、已完成清单、剩余清单、决策、blockers、`git status --porcelain` 实测的未提交文件(绝不取整为空))。**业务侧的交接文档另写进业务票面目录并入库**,那是给团队看的,不是给下一个 agent 看的。恢复顺序:HANDOFF → STATE → 未完成的 PLAN(有 PLAN 无 SUMMARY = 未完成,续做不重做)。

## 预授权与自动续行(自主性的来源)

- **计划期预授权决策**:PLAN 里列出"执行期可能需要问人的点",在规划时就替用户定夺并标 `[AUTO]` + 依据。执行期照着做,**提问成本从执行期挪到规划期**;预授权不匹配实际选项时**不许静默选一个** —— 停下升级,或按图纸已有的 [AUTO] 走。
- **不无限等**:子代理/长任务没有发完成信号,但 commits 可见 + SUMMARY 存在 → **按成功继续**,不要死等(信号可能丢,文件系统不会说谎)。
- **非失败重新分类**:认证失败 = 等凭据的门,不是失败;配额/限流 = 等额度恢复再 resume,不是失败(不要立刻重试烧配额);环境起不来 = 自己修,不是甩锅(见 exec 的环境修复义务)。把"我跑不动"分类成已知状态,agent 就不会中途放弃或过度报告。

## 运行日志(让"用起来不顺"可诊断)

**检查器每跑一次就自动记一行**到 `~/.agents/mm-gsd-runs.jsonl`(用户目录,跨项目可比)—— 之前让 agent 手工追加,实测跑完整个项目一个文件都没有:需要自觉的探子等于没有探子。遥测写失败也绝不阻断流程。
不想被记录就设 `GSD_TELEMETRY=0`。

聚合视图(诊断入口,加 `--all` 看全部项目):

```bash
node ~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs --stats
```

它报三样最有用的东西:**门禁失败率**、**同一项目反复失败的次数**(≥3 次 = 死锁嫌疑)、**高频报错类型排行**。字段含义跑 `--help` 看。

**每次安装 mm-gsd 后手动清一次这个日志文件**:它记的是上次安装前的使用历史,旧语义混进 `--stats` 会误导;自动清
不可追溯,所以程序里刻意没这个开关 —— 要清就手动删。

## 报修(卡住时把坑报回去,不要自己将就)

**什么时候该报**(这三条不是你的项目的问题,是 mm-gsd 自己的 bug,别绕过去):
- 门禁红了,但你确认输入没错
- 两处指令自相矛盾,你要自己挑一个执行
- 模板照抄不改动,却判非法

```bash
npx mm-gsd-core report "<一句话说清什么坏了>" --evidence "<你跑了什么 + 它报了什么>"
```

**批量:同类问题合成一条**,多个 `--evidence`;**不同类问题分开报** —— 合成一条反而看不出哪个先修(维护方按 issue 排队修)。
没有证据的抱怨不算 issue,`--evidence` 必填。**报完记下 URL** —— 命令打印的 issue 地址才是闭环凭据;没装 `gh` 或没登录时它会
**非零退出**让你手动贴,那是真的没发出去。展开用法(`--evidence-file`、dry-run)跑 `mm-gsd-report.mjs --help`。

## 编排层失效模式(你会怎么偷懒,逐条自查)

1. 把"跑完了"当"完成了"——verify 没 PASS 就 ship。
2. 每步产出留在对话里不落盘,下次会话全丢(STATE/CONTEXT/SUMMARY 才是记忆)。
3. STATE 越写越长,最后没人读(它是 <100 行的 digest)。
4. 中断时不写 HANDOFF,下次从零猜。
5. fast 通道做到一半发现是大事,硬着头皮降级做完(应该停下转完整循环)。
6. 修复回路超预算还继续盲修(2 轮不成就该找根因)。
7. 派活时替子代理把活想一遍 —— 那是它的工作,不是你的。你只给路径与目标。
8. 把流程记忆 commit 进业务目录、或对被 exclude 的 `.planning/` 硬 `git add -f` —— 越权污染共享契约。
9. 逐次循环:改一处 → 修一次 → 测一次 → 提交一次,贵的门禁插在每次改动里 —— 那是重复检查、没有新证据、只吃上下文。

## 状态机 = 工件存在性(可查询,不是散文约定)

状态不是记录,是**从工件推导**的:CONTEXT→PLAN→SUMMARY→VERIFICATION→SHIP。**每步收尾跑一次检查器**(`node $CK`,加 `--json` 供 agent/工作流消费),它做四件模型自觉做不好的事:

1. **推导真实状态并与 STATE 声明比对**——声明与事实不符就报错(STATE 不能说谎)。
2. **工件字段契约**:SUMMARY 的 status∈{complete,halted}、commits 必须纯数字(实测);VERIFICATION 的 status∈{passed,gaps_found,human_needed};SHIP 的 status∈{shipped,held}、`delivered` 必须写得出可核对的位置。
3. **交付缺口**:验证过了却没有 SHIP → 警告"停在验证没走到交付";`shipped` 却缺证据 → 报错。
4. **假完成信号**:占位文本扫描、STATE 超 100 行、paused 却无 HANDOFF。

退出码 0 = 一致,1 = 有违规。**每步的收尾动作是"跑检查器转绿",不是"更新 STATE"**——后者是散文约定,前者是门禁。

## 多 worktree 并发(一个 phase 一个 worktree)

**默认不做多 worktree。** 一个项目一个 worktree、串行走完五步环,是绝大多数项目的正解;多开换来的
是合并冲突和 STATE 基线过期,不是速度。只在 phase 之间真能零重叠、或同一 phase 内有大片可并行的
独立任务时才开。

确要开,五件事:①每个 worktree 独占一个 phase(同一 phase 内一组 `files_modified` 零重叠的任务);
②动手前先跑 `--worktrees` 冲突检查(在**任意** worktree 里跑,它读全局列表),有冲突就回去改 phase
切分边界 —— PLAN 没落盘就等于没检查,顺序是"plan 落盘 → 跑检查 → 才建 worktree 并派活";
③`files_modified` 是跨 worktree 的唯一安全契约,必须精确到路径:共享入口(路由表、schema、类型索引、
公共 util)被两个 phase 碰到,并行必冲突,这个成本要在 plan 阶段暴露,不是合并时才发现;
④`files_modified` 管不到的资源(端口、数据库/迁移、共享构建产物、单例服务、测试固定端口)自己分配,
写进 plan 的前置条件;⑤合并一个 worktree 后**立刻**在剩余 worktree 里重跑检查器并重读 STATE ——
合并是唯一会全局改变并行安全性的事件。

`.planning/` 是每个 worktree 各自的工作记忆(见上文「工件归属边界」),不跨 worktree 同步;跨 worktree 的事实来源只有一个——git commit history。

## 假完成检测

占位文本("To be filled"/"placeholder"/"TBD")= 未完成;SUMMARY 缺失或无对应提交 = 未完成。完成判定要 SUMMARY + 提交双证(提交指代码提交,与 SUMMARY 是否入库无关)。

**旧 PLAN 怎么办**看 `references/historical-artifacts.md`:历史工件分三态(未完成 / 没记账 / 过时),判据只取
可机器判定的事实。**认出第三种比认出前两种重要** —— 把「做完了却没记账」当成「未完成」重做一遍最贵。

## 引导安装/体检(第一次用,或怀疑哪里没对时)

```bash
node ~/.agents/skills/mm-gsd-loop/scripts/mm-gsd-install.mjs            # 交互:逐项确认
node ~/.agents/skills/mm-gsd-loop/scripts/mm-gsd-install.mjs --check    # 只体检,不改任何东西
```

它做:检测项目现状 + 跑一遍检查器列出待修项 + 按需装宿主 hook(危险 git 拦截)+ 询问是否装 pre-commit(默认否,检查器已覆盖其阻断项)。
**不负责冷启动**(建 STATE 是 mm-gsd-loop 的活)。已实测:幂等、合并不覆盖既有配置、备份只留最初原件。

## 三层门禁(各管一段,互不替代)

| 层 | 时点 | 管什么 | 强度 |
|---|---|---|---|
| **宿主 hook**(PreToolUse/Bash) | 命令执行前 | 破坏性 git(reset --hard / clean -f / stash drop / force push / 删分支 / 全量 checkout) | 环境级,agent 无法绕过 |
| **gsd-state-check**(每步收尾) | 工件写完 | 工件契约 + 状态一致性 + 假完成信号 + **交付缺口** | 流程级 |
| **gsd-state-check `--plan`** | PLAN 落盘 | 四件套完整性 / fails_when 失败方向 / files_modified 可解析 / 任务预算 / 决策保真 | 流程级 |
| **gsd-state-check `--phases` / `--worktrees`** | 并行开工前 | depends_on 环与波次 / 同波次零重叠 / 跨 worktree 文件与 REQ 冲突 | 流程级 |
| **git pre-commit** | 提交那一刻 | 入库前的工件 | 环境级,但有冲突风险 |

**真正不可替代的是第一层**:那些危险命令不是"提交了错东西",是根本不该执行——后面几层都拦不住(没有 commit 发生)。文本纪律里那串 git 禁令,只有它能机器化。
安装(可选,影响该宿主的全部项目;先确认你接受"不能再随手 reset --hard"):

```bash
node ~/.agents/skills/mm-gsd-loop/scripts/mm-gsd-install.mjs   # 自动探测宿主并按各家格式安装
```

安装器已适配的宿主与 hooks 落点:

| 宿主 | 技能 | 危险 git 拦截 |
|---|---|---|
| ZCode | 主仓原生(`~/.agents/skills/`) | ✅ `~/.zcode/cli/config.json` → `hooks.events.PreToolUse`(需 `hooks.enabled: true`) |
| Claude Code | ✅ → `~/.claude/skills/` | ✅ `~/.claude/settings.json` → `hooks.PreToolUse` |
| Codex | ✅ → `~/.codex/skills/` | ❌ 跳过(hooks 由插件托管,直装会与插件冲突) |
| Trae / Cursor | ✅ → 各自 `skills/` | ❌ 跳过(未验证 hooks 机制) |
| MiniMax | — | ❌ 跳过(未发现 skills 目录约定) |

用别的宿主?只要它读 `SKILL.md`,把 `~/.agents/skills/mm-gsd-*` 链到它的技能目录即可;hooks 那层对照它的文档手动加一条 PreToolUse(Bash)即可(守卫脚本本身是宿主无关的 node)。

阻断时给出理由和更安全的替代(丢工作用 stash / 要存 WIP 用分支 / 强推用 --force-with-lease)。真需要执行时:改写命令避开匹配,或临时禁用该条 hook。

## pre-commit 门禁(可选,多数项目**不建议装**,先查再装)

它的阻断项(status 契约 / commits 纯数字 / 占位文本)已被 **gsd-state-check 完全覆盖且更强**(检查器读全量工件并推导状态,pre-commit 只看 staged 的那几个文件),所以它**只剩一个独特价值:防止坏工件进入 git 历史**。若你不需要这层保险,只装检查器就够——文件流不进 git,工件污染不进历史。

⚠️ **装之前必须先查 `git config --get core.hooksPath`。** 若项目已指向 `.husky`(或任何现有目录),**本门禁不可安装**:它靠 `git config core.hooksPath .githooks` 生效,而 `core.hooksPath` 只能指向一个目录,改了等于**整体顶掉项目现有门禁**(husky 的 commit-msg / pre-commit / pre-merge-commit / pre-push 全部失效)。部分项目还在 `package.json` 的 `prepare` 脚本里自动重设该值,改完会被下一次 install 打回。

确认目标项目**没有**任何现有 hooks 体系时,才可用下面两条(不装也能用,纯文本纪律):

```bash
mkdir -p .githooks && cp ~/.agents/skills/mm-gsd-loop/hooks/pre-commit .githooks/pre-commit
chmod +x .githooks/pre-commit && git config core.hooksPath .githooks
```

阻断:SUMMARY 缺 `status: complete|halted` 或 `commits` 非纯数字;VERIFICATION 的 status 非法;警告:工件含占位文本。跳过单次用 `--no-verify`(想清楚为什么)。已有门禁体系的项目**不要叠加**——要加只能**追加到现有 hook 文件内**,不换 hooksPath。
