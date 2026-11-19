---
phase: "99"
plan: "F2-01"
goal: 夹具：F2-01 的缺陷样本与干净孪生样本
rollback: git revert
files_modified:
  - skills/mm-gsd-loop/templates/web.html
depends_on: []
batch_verify: node skills/mm-gsd-loop/scripts/gsd-state-check.mjs --selfcheck
wave: 1
---

# 99-F2-01 PLAN —— 夹具（不是真票）

## T1 F2-01 任务

- **files**: skills/mm-gsd-loop/templates/web.html
- **read_first**: skills/mm-gsd-loop/templates/web.html
- **现状对读点**：
  `skills/mm-gsd-loop/references/agent-routing.mjs:194` 是 pointerCard 的 description 正则所在行。
- **covers**: 无
- **action**: 在 skills/mm-gsd-loop/templates/web.html 里落一处改动。
- **verify**: node -e "const s=require('fs').readFileSync('skills/mm-gsd-loop/templates/web.html','utf8');if(!s.includes('无人认领'))process.exit(1)"
- **fails_when**: 退出码非 0
- **done**: 改动落地且验收脚本退出码为 0。
