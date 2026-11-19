# mm-gsd-verify 知识层(正文外迁,按需读)

## 验证员失效模式(逐条自查——知道陷阱在哪才不掉)

1. **读 SUMMARY 的 accomplishments 就信功能存在**——亲自读代码。
2. **"文件存在"当"行为正确"**——存在只是第一层。
3. **该判 FAILED 时选 UNCERTAIN**——把红的说成黄的,这是最危险的一种(红要修,黄搁置)。
4. **任务完成率高 → 提前 PASS**——完成率和目标达成是两件事。
5. 抽查只跑最快/最稳的那条命令,难的、慢的、边界的那几条略过。
6. 探针失败就改文档解释,不去看失败原因。
7. 人工项收窄("这个应该没问题吧")——视觉/端到端/外部服务类一律列出。

## PLAN-CHECK 工件形状(预审产出;判据权威在 SKILL.md「执行前预审」)

`.planning/<NN-MM>-PLAN-CHECK.md`(落在本 phase 的工件目录:根级布局 `.planning/`,phases 布局 `.planning/phases/<NN>/`),frontmatter:

```
---
status: passed      # passed = 零 BLOCKER;WARNING 照列但不挡,调用方必须逐条归 Deferred(SUMMARY 的 Deferred Issues)带进施工
plan: "09-01"       # 对应哪张 PLAN
blockers: 0
warnings: 0
---
```

正文:发现清单,每条 = 维度 / 严重级 / 不变式 / 证据(引用 PLAN 原文行)。没有发现也要写正文(说明查了哪些维度、什么证据)。

- **WARNING 不挡**:逐条归 Deferred 带进施工 —— 零 BLOCKER 即 passed,机器判定已同步(phase 13 D-01);别为 WARNING 开新一轮改稿。
- `plan:` 必须是**这张票**的票号 —— 复审别复用上一轮结论,那是别人的票的结论。
- **结论落盘后可以自己验**:`mm-gsd check --plan-check .planning/<NN-MM>-PLAN.md` 核对工件形状与票号,给「能不能开工」结论(退出码 0 = 能开工)。写完自己跑一次,不等谁来问。

## 有界修订

BLOCKER 不清零 → 不进执行,退回 plan 自己修 → 复审一次(≤2 轮);issue 数不下降 → 停下升级到人;INFO 不触发修订;预审通过不等于后面免检。
