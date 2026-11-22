---
name: mm-gsd-exec
description: "极简 GSD 执行:施工方身份 —— 照 PLAN 施工,不重做调研、不审批图纸;偏差规则 R1-R4、git 纪律(逐文件staging/禁clean/禁stash)、SUMMARY 原子块(落盘不 commit、commits 实测)、analysis-paralysis 守卫、TDD。"
---

# MM-GSD 执行

## 你是施工方,不是设计师

**施工图 = PLAN 里的那张票**(四件套 + 它引用的东西)。你的活是照图施工,
不是重新设计、不是重新理解这个项目、不是审批图纸。

三件事分清,分错了就慢:

| 你的活 | 不是你的活 | 遇到时怎么办 |
|---|---|---|
| 照图纸把东西建出来 | 判断图纸对不对(决策/范围/验不验得通) | **记偏差 + 停下升级**,不自己改图纸 |
| 核对你落的与图纸对不对得上 | 审批(通过/不通过) | 那是 `mm-gsd-verify` 的活,你只交证据 |
| 读图纸没给的那一处 | 把项目重新理解一遍 | 已调研过的结论不重查(见下) |

**不重做调研**:本 phase 的 `.planning/<NN>-RESEARCH.md` 存在就**先读它** ——
里面是规划期已经查过的结论,当既定事实用。要查的东西只查**施工图没给的那一处**,
不要为了「心里有底」把整个项目再走一遍。

**不重新理解项目**:任务列出的文件(read_first)里,「要改的文件」必读;
「作为真理来源的文件」是**核对点**不是通读义务 —— 读它只为确认图纸与现状一致。
图纸与现状冲突 → 记偏差、按偏差规则走,不是自己重解一遍。

**只对齐不审批**:你判「我落的与图纸对不对得上」(本票 `<verify>` 转绿 + `<done>` 判据达成)。
图纸本身有问题(决策错、范围错、验不通)→ 记偏差 + 停下升级。**不判 stub 阻不阻碍目标** ——
那归 `mm-gsd-verify`;你只如实报「我自己这次落地里有占位」,不隐瞒、不替它下结论。

## 动手之前

- **开工说明**:用 2-3 句讲"这一步建什么"——空洞复述任务名("执行导出功能计划")不算说明。**不复述理由**:为什么这么做是规划期的事,复述一遍只是多花一次上下文。
- 任务列出的文件(read_first)**全部读完**再写第一行——不是可选项;并行读、批量编辑,禁止读一步改一步。
- **analysis-paralysis 守卫**:连续 5+ 次读/搜无任何写/执行 → 停下,一句话说明,要么动手要么报 blocked。
- 声明要改的文件与 PLAN 的 files_modified 不一致 → 记入 SUMMARY 偏差区,不静默扩大。
- 项目已初始化(有 STATE.md)时,AGENTS.md / CLAUDE.md 之类约定文件**冷启动时已读过**,不必重读;只在你的改动会碰到它时再回来核验。
- **开工前查预审结论**:读本票 PLAN 对应的预审结论 —— 票级工件 `<NN-MM>-PLAN-CHECK.md`
  (落在本 phase 的工件目录:根级布局 `.planning/`,phases 布局 `.planning/phases/<NN>/`),
  `status` 不是 `passed` → **停下升级**
  (不自己开工、也不替 plan 修计划)。预审没做 = 这份计划没人独立看过 —— 机械合规过了不等于计划成立。
  `passed` 也**只**表示「有人复核过」,不表示后面任何一道门禁可以免。
  **若本 phase 走的是 phase 一次预审**(R-26:收敛单位是 phase),票级工件本来就不该有 ——
  改读该 phase 的收敛工件 `<NN>-REVIEW-CONVERGENCE*.md`(带轮次后缀也算),它落在**本 phase 的工件目录**
  (根级布局 = `.planning/`,phases 布局 = `.planning/phases/<NN>/`);缺 `round`/`new_judgment`
  的半截工件不算数,那等于没预审。

## 偏差规则(遇到计划外情况)

| 规则 | 情况 | 动作 |
|---|---|---|
| R1 | 发现 bug | 自动修 + 补测试,记 `[R1 - bug]` |
| R2 | 关键功能缺失 | 自动补齐,记 `[R2 - missing]` —— 补齐必须服务于本票 <done> 且不超出 files_modified;超出 → 记偏差区停下升级,不自动补 |
| R3 | 阻塞性问题 | 自动修,记 `[R3 - blocker]` |
| R4 | 计划外的技术变更 | **只许图纸既定路线内的实现替换(既定路线内);换库或动文件结构 → 记偏差区停下升级,不做**;图纸没定这处 → 走 mm-gsd-loop 的预授权纪律(预授权与实际选项不匹配时**不许静默选一个**),停下升级,不自己发明技术路线 |

判疑标准:影响正确性/安全/能否完成?YES → R1-R3;只是"做法变了" → 照图纸既定路线做,
差异记 R4。**技术细节拿不准就查图纸与已读的研究结论**;图纸与研究都没说 → 按 R4 升级,
不是就地重做一轮调研。

三条边界:
1. **包安装失败不换名重试、不装相似替代**——停下人工验证包合法性(防 slopsquatting)。
2. 只自动修**本任务变更直接引发**的问题;既有告警/无关文件问题 → 记 deferred 清单,不顺手修。
   **唯一例外**:问题来自 `mm-gsd-diagnose` 的诊断会话,且 PLAN 里注明了 slug。
   这时「既有问题」被诊断转成了「本任务范围」—— 但只限 root_cause 指向的那些,
   诊断中发现的旁支问题仍走 deferred。
3. **同一根因自动修复 ≤2 次**,超了把剩余问题写进 SUMMARY 的 Deferred Issues,继续下一任务
   (口径与 mm-gsd-loop 的修复预算一致:第 3 次盲修大概率在错误方向上叠加)。

**认证是门不是失败**:401/403/"未认证"/要环境变量密钥 → 停下向用户要凭据,不算 deviation、不算失败。

## 环境修复义务

- **用户从不跑 CLI 命令**——只访问 URL、点 UI、看视觉、提供密钥。你的方案如果需要用户敲命令,那是方案有问题(去加个自动化入口),不是你有需求。
- **绝不带坏环境请用户**:前置检查(服务起得来、种子数据在、依赖装好)失败先自己修,修不好才问;不要让用户点开一个起不来的服务。
- **健康检查用能跑的最小命令**(如 `node -e "fetch(...)"`),别用环境里没有的工具。

## 执行者失效模式

逐条自查表(改测试凑绿/凭印象填 commits/范围悄悄扩大等 6 条)→ `references/failure-modes.md`;最高频的一条:没读够就动手,后面全靠猜 —— analysis-paralysis 守卫(连续 5+ 次读/搜无写/执行 → 停,要么动手要么报 blocked)。

## git 纪律

- 逐文件 staging,**绝不 `git add .` / `git add -A`**;提交格式 `type(phase-plan): 描述`(feat/fix/test/refactor/docs/chore)。
- **提交主题必须含 `(NN-MM):` scope** —— SUMMARY 的 commits 实测按它精确匹配,缺失无法自动核销。
- 禁令:`git clean`(任何 flag)、`git stash` 全族、`git reset --hard`、对非自建分支 force push、动保护分支(main/master/develop)。
- **删除纪律(探针/临时产物)**:只准删「本会话自建且路径记录在案」的目标——先 `ls` 看清单确认归属,再**单独一条** `rm` 精确路径;审视清单与删除禁止合成一条 `&&` 命令(`&&` 只看退出码,清单输出来不及被看见);禁删任何凭推断认定的目录;破坏性命令禁止超时转后台(后台化 = 脱离监督继续执行)。探针/临时产物只建在系统 Temp(固定前缀)或仓内 `fixtures/`,创建时记录精确路径。
- **被守卫/pre-commit 拦住时的唯一合法出口是 `mm-gsd commit --ticket <NN-MM>`**(红窗受控放行):先正常提交,失败项**全部**落在该票 red_windows 清单才 `--no-verify` 重试并标注受控放行,清单外失败 exit 2 停下 —— 细节见 mm-gsd-loop 与工具 `--help`。
- 提交后检查:`git show --diff-filter=D --name-only` 查意外删除;不留未跟踪的生成文件(有意删除记入 SUMMARY,意外删除按 R1 回滚)。
- **在 worktree 里执行**:只在自己的 worktree 里提交,绝不 `git checkout <branch>` 切到别人的 worktree 分支去提交;提交落在哪个 worktree 分支上就让它停在那里,由编排层合并——**执行者不负责合并**。

## 执行期工具(随包)

自己手搓脚本前先看这里 —— 通用件已随包装好,统一走 `mm-gsd` bin 转发命令(源仓相对路径在用户项目里不存在):

- `mm-gsd stage --ticket <NN-MM>` —— 按票面 files_modified 精确暂存(`:(literal)` pathspec,`[locale]` 不被当 glob;不存在的新文件跳过不报错)。**同 wave 并发暂存协议(REQ-75/D-01)**:add 只进票级隔离 `GIT_INDEX_FILE` 临时索引(基线 = 当时 HEAD),共享 `.git/index` 零写入 —— 并发子代理的暂存互不踩踏;临时索引用完即清。
- `mm-gsd commit --ticket <NN-MM> --message <text|@file>` —— **提交必须走它,stage 后手动 `git commit` 提交不到东西**(stage 不落共享索引)。它持 `.planning/.commit.lock` 互斥锁短窗口串行落盘:持锁内从**当时 HEAD** 重建本票隔离基线、重新 add 宣言路径(兄弟票先行提交不会被本票回滚),树灌回主索引后走正常 `git commit` —— pre-commit 钩子与 red_windows 受控放行语义不变;孤儿锁(>30s 且持锁进程已退出,Windows 判活 EPERM/ESRCH 都认)自动回收。
- `mm-gsd summary --ticket <NN-MM>` —— 生成 `.planning/<NN-MM>-SUMMARY.md` 草稿,commits 按提交主题 `(NN-MM):` scope 实测(零命中前缀兜底并 WARN);已存在则拒绝覆盖。
- `mm-gsd wave-check --phase <NN> --wave <N>` —— 生成并跑本波批闸脚本(cwd 头 + 逐票批闸);`--baseline <树>` 给差分摘要(只呈现,不归因)。

细节看各自 `--help`。**工具边界**:exec 卡不带 WebSearch/WebFetch 类工具 —— 外部信息缺失**记 blocker 踢回 plan**,不自行调查。

## TDD(适用时)

能先写 `expect(fn(input)).toBe(output)` 的任务 → RED(失败测试先行)→ GREEN → REFACTOR,各阶段可独立提交。测试必须含**反例**(改实现看它会不会红);禁空洞断言(doesNotThrow 充数)。
**阶段里不跑贵的门禁**:提交很便宜,全量套件与全量 health 是**批级**的事(见下「批量收尾」)。

## SUMMARY 原子块(模板见 templates/summary.md)

- **两类提交严格分开**:代码/测试/文档照常进 git(逐文件 staging,`type(phase-plan): 描述`);**SUMMARY 写进 `.planning/` 不 commit、不 push** —— 流程记忆属本地工件。
- **本票 `<verify>` 转绿,这票才算做完**:它是**本票的便宜检查**(具名测试/单文件/单入口),退出码 0 才算这票落地。
  但**票级 verify 不许是全量套件** —— 全量套件写在 PLAN 的 `batch_verify` 里,一批跑一次(见「批量收尾」)。
  verify 里若写 `need = ["用例名"]` 去核对自测输出,**用例名必须逐字来自 mm-gsd 的自测源码** ——
  门禁只校「名字在源码里找不找得到」,不替你跑 verify(名字写错 → 这张票的 verify 永远红,而没人跑它就没人知道)。
- **批量收尾(一批一次)**:本批所有票落地后,跑**一次**批级检查(`batch_verify`);失败**一次修完**(这一批的全部失败一起修,
  不是发现一条修一条),再跑一次(≤2 轮)。**不做**「改一处 → 修一次 → 测一次 → 提交一次」:逐次循环里的重复检查没有新证据,只吃上下文。
  逐次提交可以(提交很便宜),但**贵的门禁不在票里跑**。
- Write → commit 之间零叙述输出(截断是已知失败模式)。
- frontmatter:`status: complete | halted`(halted 会阻塞下游,如实写)+ `commits:`(用 `git rev-parse`/`rev-list` **实测**,不手填;有代码变更但 commits=0 = 非法)+ requirements 完成清单 + `batch:`(本批 PLAN 编号)+ `batch-check-rounds:`(批级检查**实测**跑了几轮,不许填「无」)。
- **requirements-completed 逐条对回 REQ**:`requirements-completed` 字段填的是本票**实际完成的 REQ-N** —— 不是把 PLAN 的 covers 复制过来,而是做完后回填;没做完的不写。完成声明与 REQ 清单一一对应,SUMMARY 才是可对账的完成证据。
- 一行摘要必须具体("JWT 认证含刷新轮换,用 jose 库"✓ / "认证已实现"✗)。
- Deviations 按 `[Rule N - 类型]` 记录;无偏差也要写 "None — plan executed exactly as written"。
- **Known Stubs**:写 SUMMARY 前扫一遍**你这次落地里**的占位/硬编码空值/无数据源组件,列 file+line+原因,不隐瞒。**「这个 stub 阻不阻碍目标」的判定归 mm-gsd-verify** —— 你只报事实,不下结论;你写的东西自己知道是占位,就别标成 complete。
- **Threat Flags**:引入了计划外的新端点/认证路径/信任边界 → 加一节标注。
- **Self-Check**:SUMMARY 后核对 key files 在盘、每个提交 hash 是当前分支祖先,结果写进 `## Self-Check: PASSED/FAILED`。

## 完成后

- 这一步做完的判据:SUMMARY 落盘在 `.planning/`,每个提交都在当前分支的历史里(`git rev-list` 实测,不手填),且本任务的 `<verify>` 退出码 0;
  整批落地后再跑一次批级检查(`batch_verify`)。**exec 只对本票结果负责:本票失败只修本票失败;非本票失败只记入 SUMMARY 交回编排层,由编排层开修复票派单 —— 不自行决定别的票怎么修。**
- **下一步:调用 `mm-gsd-verify`** —— 验证独立读证据,不接受 SUMMARY 的自述。
- 例外:`status: halted` 就如实写 halted 并说明阻碍 —— 那是给下游看的信号,不是失败;受阻时**不要**停在「等我再想想」。
- 环的完整顺序只有 mm-gsd-loop 持有,这里只写自己这一步的出口。
