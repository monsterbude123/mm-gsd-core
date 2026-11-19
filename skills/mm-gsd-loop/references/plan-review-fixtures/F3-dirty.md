---
phase: "99"
plan: "F3-01"
goal: 夹具：F3-01 的缺陷样本与干净孪生样本
rollback: git revert
files_modified:
  - skills/mm-gsd-loop/references/debt-panel.mjs
depends_on: []
batch_verify: node skills/mm-gsd-loop/scripts/gsd-state-check.mjs --selfcheck
wave: 1
---

# 99-F3-01 PLAN —— 夹具（不是真票）

## T1 F3-01 任务

- **files**: skills/mm-gsd-loop/references/debt-panel.mjs
- **read_first**: skills/mm-gsd-loop/references/debt-panel.mjs
- **现状对读点**：
  `skills/mm-gsd-loop/references/agent-routing.mjs:194` 是 pointerCard 的 description 正则所在行。
- **covers**: D-07
- **action**: 在 debt-panel 里补一处常量。
- **verify**: node --input-type=module -e "import('./skills/mm-gsd-loop/references/debt-panel.mjs').then(()=>process.exit(0))"
- **fails_when**: 退出码非 0
- **done**: 改动落地且验收脚本退出码为 0。
