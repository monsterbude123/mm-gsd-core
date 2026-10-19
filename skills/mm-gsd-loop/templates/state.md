# STATE.md 模板(全文 <100 行,整节覆写,是 DIGEST 不是档案)

```markdown
---
status: discussing
active_phase: 01
updated: 2026-10-19
---

<!-- status 合法值只有六个,一次只写一个:
     discussing / planning / executing / verifying / completed / shipped / paused
     写成 "discussing | planning | ..." 是错的 —— 那是选项说明,不是值,照抄即被判非法。
     真实值由检查器从工件存在性推导,你写声明,它比对。 -->


## Project Reference

- Goal: <一句话项目目标>
- Current focus: <当前里程碑/phase>

## Phases

<!-- depends_on 只指向更早的 phase,供 --phases 算波次;没写就当作无依赖。
     同一波次(depends_on 算出来的)之间,各 phase 的 files_modified 必须零重叠。 -->

- [ ] 01 — <名称>(walking skeleton)
- [ ] 02 — <名称>(depends_on: 01)
- [x] 03 — <名称>(depends_on: 01)

## Current Position

- Phase: <N — 名称>
- Plan: <N>
- Status: <一句话>
- Last activity: <最近完成的事>

## Decisions(只留 3-5 条近期,全量在 CONTEXT)

- [D-05] <决策内容,一句话>(2026-10-13)
- [D-04] <决策内容,一句话>(2026-10-12)

## Blockers / Concerns(只留活跃的)

- [B-1] <阻塞项 + 谁能解>(2026-10-13)

## Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | <fast 通道任务> | 2026-10-13 | abc1234 | - |

## Session Continuity

- Last session: <日期>
- Stopped at: <phase/plan/task>
- Resume file: <HANDOFF 或 .continue-here 路径>
```

维护规则:
- 每个循环第一步先读;执行/验证后更新 Current Position(整节覆写)。
- phase 完成 → 勾 ROADMAP + 推进 Current Position + 更新 status。
- 测试不过不标完成;决策超 5 条删最旧(历史在 git)。
- 开新 phase 时在条目上写 `(depends_on: NN)`,规划完跑一次
  `gsd-state-check.mjs --phases` 看波次与同波次零重叠——这是"哪些能并行"的唯一判据。
