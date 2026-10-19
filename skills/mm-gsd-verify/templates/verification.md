# VERIFICATION.md 模板(独立验证报告:只认证据,不认自述)

```markdown
---
status: passed
phase: 01
score: 4/6
---

<!-- status 封闭三态,一次只写一个:passed / gaps_found / human_needed。
     写成 "passed | gaps_found | human_needed" 是错的 —— 那是选项说明,不是值,照抄即被判非法。
     人工项非空时禁止 passed;score 是 VERIFIED truths 数 / 总数(含 override)。 -->

## Observable Truths

| # | Truth(用户视角) | 状态 | 证据 |
|---|---|---|---|
| T1 | 导出的 CSV 能被 Excel 正确打开 | ✓ VERIFIED | tests/export.test.ts:18 通过 |
| T2 | 大表导出不耗尽内存 | ⚠ PRESENT_BEHAVIOR_UNVERIFIED | 流式写入已接线(w:42),未实测 10w 行 |
| T3 | ... | ✗ FAILED | ... |
| T4 | ... | ? UNCERTAIN | 拿不到证据,如实标注 |

状态词表:✓ VERIFIED(有行为证据)/ ⚠ PRESENT_BEHAVIOR_UNVERIFIED / ✗ FAILED / ? UNCERTAIN

## Artifacts(三层:exists → substantive → wired)

| Artifact | exists | substantive | wired | 判定 |
|---|---|---|---|---|
| src/export/csv-writer.ts | ✓ | ✓ 212 行 | ✓ 被 handler import 且调用 | VERIFIED |
| src/export/formatter.ts | ✓ | ✗ "Only 8 lines" | ⚠ 未被引用 | STUB / ORPHANED |

## Data Flow

<输出值 → 数据源回溯;链终于硬编码/mock/静态数据 → 标 HOLLOW_PROP>

## Behavioral Spot-Checks

- 探针 1:`node -e "..."` → 实际输出 vs 期望(探针在自己的进程跑,不信 SUMMARY 的 PASS 标记)
- 探针缺失的条目 = 缺口,列下方 Gaps

## Requirements Coverage

| REQ | Verdict | 证据 |
|---|---|---|
| REQ-3 | VERIFIED | T1 |
| REQ-7 | ORPHANED | 映射到本 phase 但无任务认领——必须出现在报告里 |

## Gaps(编号 G-{phase}-{N},修复计划引用 gap_id)

- gap_id: G-01-1
  truth: T3
  reason: <为什么失败>
  artifacts: [{path: ..., issue: ...}]
  # 修完后:resolved_by: <plan/commit> + 证据,对账关闭,不重新诊断

## Deferred Follow-Ups(later/future 类反馈 ≠ 缺口,不生成修复计划)

- <test/idea/deferred_at>

## Human Verification Required(机器验不了,恒发不省略)

- [ ] 视觉:导出按钮 hover 态 —— 期望:<>;怎么算过:<>
- [ ] 端到端:真实浏览器下载流程 —— 期望:<>
```

生产纪律:
- 每条结论附 file:line 或命令输出;占位文本("TBD"/"待补")= 报告未完成。
- 债务标记(TBD/FIXME/XXX 且无 issue 引用)→ 阻断级发现进 Gaps。
- 写完自检:frontmatter status 与正文结论一致(人工区非空 → 只能 human_needed)。
