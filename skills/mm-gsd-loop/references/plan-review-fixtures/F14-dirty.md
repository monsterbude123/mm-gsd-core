---
phase: "99"
plan: "F14-01"
goal: 夹具：F14-01 的缺陷样本与干净孪生样本
rollback: git revert
files_modified:
  - docs/product/board.md
depends_on: []
batch_verify: node skills/mm-gsd-loop/scripts/gsd-state-check.mjs --selfcheck
wave: 1
---

# 99-F14-01 PLAN —— 夹具（不是真票）

## T1 F14-01 任务

- **files**: docs/product/board.md
- **read_first**: docs/product/board.md
- **现状对读点**：
  `/### \[D-\d+\]/` 在 `docs/product/board.md` 里命中 3 行。
- **covers**: 无
- **action**: 在 docs/product/board.md 里落一处改动。
- **verify**: node --input-type=module -e "import('./docs/product/board.md').then(()=>process.exit(0))"
- **fails_when**: 退出码非 0
- **done**: 改动落地且验收脚本退出码为 0。
