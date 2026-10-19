# PLAN.md 模板(plan 的执行契约,planner 写、executor 照着做、verifier 逐条对 verdict)

只复制下面 ```markdown 块内的内容到 `.planning/<NN>-<MM>-PLAN.md`,连同上面的说明不要带走。
写完立刻跑:`node ~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs --plan .planning/<你的文件>`
**转绿再进执行环节**——检查器会拦缺字段、缺失败方向、模糊文件清单、超预算、缩水措辞。

```markdown
---
phase: "02"
plan: "01"
goal: <结果形一句话:做完之后用户能做到什么。写"完成用户体系",不写"实现 auth 模块">
rollback: <这个 phase 怎么回退:删掉哪些文件/回滚哪个提交>
files_modified:
  - src/api/auth.ts
  - src/lib/session.ts
depends_on: []
---

## Truths(用户视角,可观察;3-7 条)

- <"密码是安全的"✓ —— "bcrypt 已安装"✗,后者是 artifact 不是 truth>

## Tasks

### T1 <一句话任务名>
- **files**: src/api/auth.ts, src/lib/session.ts
- **read_first**: src/api/auth.ts, src/lib/types.ts   <!-- 要改的文件 + 作为真理来源的文件(接口定义/类型声明/既有同类实现) -->
- **action**: <做什么 + 避免什么及为什么。不写代码块,代码留给执行者;避免的手法要写出来,否则它会用最顺手的那个>
- **verify**: `npm test -- auth`
- **fails_when**: <失败时看到什么:退出码非 0,或输出缺 "2 passing"。没有失败方向的验证是假验证>
- **done**: <可度量判据:测试名、命令输出、CLI 结果。不写"看起来对">
- **precondition**: <一行可检验的前置事实;不满足即停。选填>
- **covers**: REQ-3, D-01   <!-- 引用 CONTEXT 的决策编号;每条 D-NN 至少被一个任务引用 -->

<!-- 还需要 T2/T3 时:把上面 T1 整个块复制过来改标题与内容,五个字段一个都不能少。
     占位符(例如用 "..." 代替路径)会被门禁直接拦下,这是有意的。 -->

## Auto Decisions(预授权,执行期照做不再问)

规划时就把执行期可能需要问用户的点查清项目事实并定夺,标 [AUTO] + 依据。
只覆盖拍板权五类**之外**的点(库、文件组织、命名、实现路线、测试写法);五类白名单里的不预授权。

- [AUTO] 用 <选型> —— 依据 <哪个文件/既有约定>

## 覆盖审计(定稿前必做)

四源对照:GOAL / REQ / RESEARCH(如做了) / CONTEXT。任何一项 MISSING → 显式报告并决定
(补任务 / 移到下一 phase / 用户裁决),绝不带缺口静默定稿。

| 源 | 覆盖情况 | 缺口如何处理 |
|----|---------|------------|
| GOAL | | |
| REQ  | | |
| CONTEXT | | |
```

维护规则:

- 任务数 2-3 张;多于 3 张或多子系统 → 拆成多张票。超预算的正解是拆票,不是把内容做小
  (被禁的范围承诺措辞见 SKILL.md「缩水禁令」)。
- 单张票触及的文件多于 5 个 → 拆。执行者拿不到装得下的计划,就会临场发挥。
- `verify` 不得用 `||` 掩盖非零退出码,也不得重定向后 echo 一个假 0 —— 那样的命令永远为真,
  执行者照抄就能拿到绿。失败必须能失败。
- 任务数少时可以只写上面那个 T1 的骨架(标题 + 五个字段),但**必须落盘**——状态机靠它推进,
  验证环节靠它逐条对 verdict;不落盘等于闭环断裂。
