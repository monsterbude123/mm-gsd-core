---
phase: "99"
plan: "F13-01"
goal: 夹具：F13-01 的缺陷样本与干净孪生样本
rollback: git revert
files_modified:
  - skills/mm-gsd-loop/references/plan-ready.mjs
depends_on: []
batch_verify: node skills/mm-gsd-loop/scripts/gsd-state-check.mjs --selfcheck
wave: 1
---

# 99-F13-01 PLAN —— 夹具（不是真票）

## T1 F13-01 任务

- **files**: skills/mm-gsd-loop/references/plan-ready.mjs
- **read_first**: skills/mm-gsd-loop/references/plan-ready.mjs
- **现状对读点**：
  `skills/mm-gsd-loop/references/agent-routing.mjs:194` 是 pointerCard 的 description 正则所在行。
- **covers**: 无
- **action**: checkPlanReady 的契约统一成返回问题列表。
- **verify**: node --input-type=module -e "import('./skills/mm-gsd-loop/references/plan-ready.mjs').then(m=>{const p=m.checkPlanReady({});if(p.length!==1)process.exit(1)})"
- **fails_when**: 退出码非 0
- **done**: 改动落地且验收脚本退出码为 0。
