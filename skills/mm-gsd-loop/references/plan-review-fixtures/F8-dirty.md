---
phase: "99"
plan: "F8-01"
goal: 夹具：F8-01 的缺陷样本与干净孪生样本
rollback: git revert
files_modified:
  - skills/mm-gsd-loop/references/verification-gates.mjs
depends_on: []
batch_verify: node skills/mm-gsd-loop/scripts/gsd-state-check.mjs --selfcheck
wave: 1
---

# 99-F8-01 PLAN —— 夹具（不是真票）

## T1 F8-01 任务

- **files**: skills/mm-gsd-loop/references/verification-gates.mjs
- **read_first**: skills/mm-gsd-loop/references/verification-gates.mjs
- **现状对读点**：
  `skills/mm-gsd-loop/references/agent-routing.mjs:194` 是 pointerCard 的 description 正则所在行。
- **covers**: 无
- **action**: 把 skills/mm-gsd-loop/selftests/debt-panel.selftest.mjs:97 里的命令名改成 mm-gsd-batch。
- **verify**: node --input-type=module -e "import('./skills/mm-gsd-loop/references/verification-gates.mjs').then(()=>process.exit(0))"
- **fails_when**: 退出码非 0
- **done**: 改动落地且验收脚本退出码为 0。
