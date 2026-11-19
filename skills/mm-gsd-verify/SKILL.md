---
name: mm-gsd-verify
description: "极简 GSD 验证:goal-backward 三层倒推(TRUE→EXIST→WIRED)、真相四态、不信 SUMMARY(自评盲区)、数据流追踪、gap 编号闭环、人工项恒发清单。"
---

# MM-GSD 验证

## 立场

- **SUMMARY 不是证据**。自评盲区:执行 agent 在自己的上下文里会可靠地报告 PASSED,即使交付物合并后会失败。验证必须独立进行。
- **任务完成 ≠ 目标达成**。起始假设:任务都完成了但目标落空;逐条拿证据推翻这个假设。

## 审计范围

独立不等于无界 —— **翻的范围是收敛的**:票面 `files_modified` + 该票 scope 提交的 diff(提交主题 `(NN-MM):` scope)+ 相关测试文件。该翻的范围里逐条拿证据,不翻无界全仓。工具优先级:代码索引类工具(如 codegraph_explore)> 定向读文件 > ripgrep 定向 glob(排除 .worktrees/node_modules/dist/vendor)> 全目录 grep(禁)。**消费 `.planning/codebase-map.md`,不重建**:地图缺失或过期,注明后重做入口级一屏。

## 三层倒推(goal-backward)

什么必须 **TRUE**(可观察 truths)→ 什么必须 **EXIST**(工件)→ 什么必须 **WIRED**(连线)。**80% 的 stub 藏在连线处**——文件都在、各自能跑,但没人把 A 接到 B。

**真相四态**:✓ VERIFIED(有行为证据,不只是存在)/ ⚠ PRESENT_BEHAVIOR_UNVERIFIED(存在且接好,行为没验过)/ ✗ FAILED(有证据不成立)/ ? UNCERTAIN(拿不到证据,如实标不猜)。presence ≠ behavior:行为依赖型真相必须有**具名的测试通过**才算 VERIFIED。

**工件三层**:exists(在)→ substantive(实质内容;"Only N lines"/缺模式 → STUB)→ wired(imported **AND** used)。**Stub 判定归你**;**Stub 反误报**:只有"值流入用户可见输出且无其他真实数据路径"才算 STUB;测试助手、类型默认值、会被真实请求覆写的初始状态都**不是** stub——误报会淹没真缺口。

**数据流追踪**:渲染/输出值回溯到真实数据源;链终于硬编码返回值 / mock / 静态数据 → 标 HOLLOW_PROP。

## 执行检查

- 逐条 REQ 给 verdict;孤儿需求必须出现在报告里;没被认领的 REQ ⇒ BLOCKER(判定归机器门 checkReqCoverage,这里补解释与后果,不重新实现)。
- 债务标记:TBD/FIXME/XXX 且同行无 issue 引用 → 阻断级发现。
- **行为抽查**:2-4 个单命令可验行为,每个 <10 秒;探针**在自己的进程里跑**,不信 SUMMARY 的 PASS 标记;探针缺失 = 缺口。测试纪律:全量测试整个验证**至多跑一次**;存在性用 `--list`/`-t` 枚举,通过用**单个具名测试**——绝不逐条 truth 过滤全量。分层:票级便宜检查归票,批级归执行端,你最多跑一次全量。
- **冷启动冒烟**:交付涉及服务/入口/数据库/migrations 必加——杀服务、清临时态、从零启动、主查询返回活数据;"开发时能跑"和"重启后能跑"是两件事,后者才是交付真相。
- 报告里每条结论附 file:line 或命令输出;拿不到证据标 UNCERTAIN。

## gap 闭环

- 每个缺口编号 `G-{phase}-{N}`,修复计划引用 gap_id;修完对账标 resolved(附证据),不重新诊断已解决的问题。报告写清:这轮发现几条、修了几条、下一轮重验范围(只重验失败项)。
- **「退役 + 承接」闭合**:判据与 resolved 同严——承接物必须 wired(imported AND used),no-op 承接 = 未闭合;承接声明要指名等价锚点,锚点不存在就是不承接。
- **再验证模式**:只对失败项做全三层深验,已过项快速回归(存在 + 基本健全)。**重验模式(点修 R 票收口)**:只深验被重开的那条 truth;结论按钉死格式追加进 VERIFICATION「**## 重验记录**」:`- Rk: passed — 重验 <truth 名>`(未过写 failed)——全部 R 票 passed → phase 回 shipped(checker 推导,格式漂移推导就瞎)。
- **批量修复**:全部缺口编号齐全后一轮一起修,修完统一重验一次(≤2 轮);**不做**「发现一条修一条验一条」——逐条闭环把同批检查重复跑 N 遍。修复→重验预算 2 轮,超了升级到人(复合失败指数级难诊断,第 3 次盲修大概率在错误方向上叠加)。
- 延迟项(later/future)≠ 缺口:记 Deferred Follow-Ups,不生成修复计划。失效模式自查 7 条与 PLAN-CHECK 工件形状、有界修订细节 → `references/failure-modes.md`。

## 人工项(恒发,不省略)

视觉、端到端流程、实时行为、外部服务、性能体感、错误文案——机器验不了,**每条写清:测什么/期望什么/怎么算过**。人工区非空时状态只能是 human_needed,**不得标 passed**。**环境坏了不自己修** —— 那是 exec 的活;verifier 改被验环境就毁了自己的独立性 → 记 gap 交回 exec。自动覆盖分类:自动验证全 pass 且无人工判断需求才算自动过;拿不准 → 归人工(假阴性可容忍,假阳性不可)。

## 逐票对 verdict

PLAN 每张票在这里都要拿到 verdict —— **不看 SUMMARY 自述**,自己核:`<done>` 判据达成了吗;`<verify>` 自己跑一遍退出码是不是 0,`<fails_when>` 的失败方向真出问题时看得见吗;`<files>` 里的东西真的存在且真的被接上了吗(存在 ≠ 接上);票认领的决策(`covers`)真被实现了还是只被提到。对不上 → gap 清单;对上 → 写清「哪张票、哪条判据、什么证据」。逐票对完才是验收。

## 执行前预审(计划复核:PLAN 落盘后、执行前)

> 本节是预审的**判据权威**;调度(派谁、什么时候派、怎么收口)归 `mm-gsd-plan-check` 技能。

**你是审查方,不是作者。** 立场:先假设这份计划有缺陷,只认可**可验证的覆盖** —— 不认努力、不认意图。**任务存在 ≠ 目标被覆盖**:「加了 auth 端点」的票可以存在,「密码是安全的」仍未达成。**只看计划,不看实现**:不查代码写没写、不跑应用、不替 plan 做决策(拍板归 discuss)。

### 预审只审判断题

需求覆盖与票完整性、验收命令可用性与路径前置已由 `--plan` / `--plan-check` 机器门兜底，预审工件里的机器可判发现会自动降级不拦工；预审只审**判断四题**：

| 判断题 | 问什么 |
|---|---|
| **需求对齐** | 这批票合起来真的达成用户要的吗(任务存在 ≠ 目标被覆盖);跨票归属与语义衔接机器判不了,人来看 |
| **方案合理** | 关键连线与设计选择站得住吗(只建组件没建调用、口径打架——机器看不出「合理」) |
| **风险被看见** | 每条风险有人认领吗;deferred 是有证据的处置还是掩埋 |
| **载量离谱吗** | 一张票一个子代理 20 分钟做得完吗(读得完、改得完——离谱即升级信号) |

**次序不是评审维度**:wave 由 depends_on 推导(R-24),评审只看 DAG 对应,不评「先做谁后做谁」。

### 每条发现的写法

- **severity 必填**:BLOCKER(不修就达不成 phase 目标)/ WARNING(质量打折,能继续)/ INFO(不触发修订)。缺 severity 或值认不出 → 当 BLOCKER(fail closed)。
- **写不变式,不写改法**:「每张票的 verify 能区分通过与失败」,不是「加一个 verify 块」;`fix_hint` 只是一条可选路线——说不出不变式的,降级 INFO 或丢掉。
- **只报不处方**:报出失败的原文行;改法归 plan,拍板归 discuss。
- **处置分级**:BLOCKER=开工前必修;WARNING=逐条归 Deferred 带进施工,不挡;INFO=不触发。

工件形状(frontmatter 与正文格式)、结论自验、有界修订细节 → `references/failure-modes.md`。

## 输出

VERIFICATION 落 `.planning/<NN>-VERIFICATION.md`(本地不入库):truths 表(四态+证据)、工件三层、数据流、抽查、REQ 覆盖、gap 清单、人工项清单。只认证据,不认自述。**status 三个合法值**(检查器按此判定):`passed`(全部 VERIFIED 且人工区空 → 可进 ship,但**不是终态**)/ `gaps_found`(gap 清单非空 → 回 exec,预算 2 轮)/ `human_needed`(代码侧无缺口但人工项非空 → 等人,清空前不得改 passed)。

**`passed` 只推出 `completed`,不推出 `shipped`。** 验证回答"做出来的东西对不对",不回答"到用户手里没有"。合并/发布/文档同步归 ship 步,凭据是 `<NN>-MM-SHIP.md`(模板 mm-gsd-loop/templates/ship.md)。**不要代劳 ship**(没有交付上下文),也**不要在 passed 之后宣布 phase 完成**——那是循环断在半路。

## 完成后

- 判据:`.planning/<NN>-VERIFICATION.md` 落盘,每条 REQ 有证据,人工区非空如实写 human_needed。
- 下一步按 status 分支(上面那张表就是判据):`gaps_found` → 回 mm-gsd-exec 修;`human_needed` → **等人**,此时不调任何技能;`passed` → 进 mm-gsd-loop 的 ship 步。
- 环的完整顺序只有 mm-gsd-loop 持有,这里只写自己这一步的出口。
