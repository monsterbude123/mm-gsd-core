---
phase: "99"
plan: "F1-01"
goal: 夹具：F1-01 的缺陷样本与干净孪生样本
rollback: git revert
files_modified:
  - skills/mm-gsd-loop/references/packs.mjs
depends_on: []
batch_verify: node skills/mm-gsd-loop/scripts/gsd-state-check.mjs --selfcheck
wave: 1
---

# 99-F1-01 PLAN —— 夹具（不是真票）

## T1 F1-01 任务

- **files**: skills/mm-gsd-loop/references/packs.mjs
- **read_first**: skills/mm-gsd-loop/references/packs.mjs
- **现状对读点**：
  `skills/mm-gsd-loop/references/agent-routing.mjs:194` 是 pointerCard 的 description 正则所在行。
- **covers**: 无
- **action**: 在 skills/mm-gsd-loop/references/packs.mjs 里落一处改动。
- **verify**: node -e "console.log('ok')"
- **fails_when**: 退出码非 0
- **done**: 改动落地且验收脚本退出码为 0。
