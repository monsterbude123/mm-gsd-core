---
phase: "99"
plan: "F15-01"
goal: 夹具：F15-01 的缺陷样本与干净孪生样本
rollback: git revert
files_modified:
  - skills/mm-gsd-loop/references/plan-ready.mjs
depends_on: []
batch_verify: node skills/mm-gsd-loop/scripts/gsd-state-check.mjs --selfcheck
wave: 1
---

# 99-F15-01 PLAN —— 夹具（不是真票）

## T1 F15-01 任务

- **files**: skills/mm-gsd-loop/references/plan-ready.mjs
- **read_first**: skills/mm-gsd-loop/references/plan-ready.mjs
- **现状对读点**：
  `skills/mm-gsd-loop/references/agent-routing.mjs:194` 是 pointerCard 的 description 正则所在行。
- **covers**: 无
- **action**: 把复审工件的触发字段 `round:` 交给门禁判。
- **verify**: node --input-type=module -e "import('./skills/mm-gsd-loop/references/plan-ready.mjs').then(()=>process.exit(0))"
- **fails_when**: 退出码非 0
- **done**: 改动落地且验收脚本退出码为 0。
