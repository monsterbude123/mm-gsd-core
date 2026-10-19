# SUMMARY.md 模板(plan 完成的记忆沉淀:做了什么、偏了什么、学到什么)

```markdown
---
phase: 01
status: complete
commits: 3
requirements-completed: [REQ-3, REQ-4]
---

<!-- status 只有两个合法值:complete | halted。halted = 有阻碍目标的缺口,不算完成,
     如实写 halted 并在下方写清缺什么;不要写别的值,也不要不写。 -->

## One-liner
JWT 认证含刷新令牌轮换,用 jose 库 —— 禁止 "认证已实现" 这类空话

## Accomplishments
- <交付了什么,用户视角>

## Task Commits
- task1: abc1234 <type>(01-02): <做了什么>
- task2: def5678 ...

## Files
- created: <path...>
- modified: <path...>

## Deviations from Plan
- [R1 - bug] Found during / Issue / Fix / Files / Commit
- None — plan executed exactly as written.   ← 无偏差也要写这句

## Known Stubs
- src/x.ts:42 — <占位/硬编码的原因>(不阻碍目标才允许存在)

## Deferred Issues
- <修复预算用尽仍未解决的:单任务 3 次上限后剩下的、依赖外部的、越权的>
  - <问题一句话 + 为什么本轮没解决 + 下一步谁来做>

## Threat Flags
- <引入计划外的新端点/认证路径/信任边界才写;没有则省略本节>

## Issues Encountered
- <blocker/遗留问题;没有写 None>

## Next Phase Readiness
- <下个 phase 该知道什么:踩过的坑、学到的>

## Self-Check: PASSED
<!-- 核对 key-files 在盘 + 每个 commit hash 是当前分支祖先。PASSED/FAILED 二选一,写在文末。 -->
```

生产纪律:
- **frontmatter 的 status 写单个值**(complete 或 halted),不要写 "complete | halted";检查器只认单值。
- Write → commit 之间零叙述;写完立即提交(worktree/子代理场景下未提交即永久丢失)。
- commits=0 但有代码变更 = 非法,HALT。
- 占位文本("To be filled"/"TBD")会被判假完成。
- 验证方只认本文件 + git 双证;`## Self-Check: PASSED/FAILED` 必须写。
- 修复预算用尽时:**Deferred Issues 不可省**——那是"诚实记录没做完"的唯一出口。
