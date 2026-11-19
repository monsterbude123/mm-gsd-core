---
phase: "99"
plan: "F12-01"
goal: 夹具：F12-01 的缺陷样本与干净孪生样本
rollback: git revert
files_modified:
  - skills/mm-gsd-loop/references/phase-topo.mjs
depends_on: []
batch_verify: node skills/mm-gsd-loop/scripts/gsd-state-check.mjs --selfcheck
wave: 1
---

# 99-F12-01 PLAN —— 夹具（不是真票）

## T1 F12-01 任务

- **files**: skills/mm-gsd-loop/references/phase-topo.mjs
- **read_first**: skills/mm-gsd-loop/references/phase-topo.mjs
- **现状对读点**：
  `skills/mm-gsd-loop/references/agent-routing.mjs:194` 是 pointerCard 的 description 正则所在行。
- **covers**: 无
- **action**: 在 skills/mm-gsd-loop/references/phase-topo.mjs 里落一处改动。
- **verify**: node -e "const s=require('fs').readFileSync('skills/mm-gsd-loop/references/phase-topo.mjs','utf8');if(/parsedepends/.test(s))process.exit(1)"
- **fails_when**: 退出码非 0
- **done**: 改动落地且验收脚本退出码为 0。
