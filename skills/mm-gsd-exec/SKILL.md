---
name: mm-gsd-exec
description: "极简 GSD 执行:偏差规则 R1-R4、git 纪律(逐文件staging/禁clean/禁stash)、SUMMARY 原子块(写后即提交、commits 实测)、auth-as-gate、analysis-paralysis 守卫、TDD。"
---

# MM-GSD 执行

## 动手之前

- **开工说明**:先用 2-3 句讲"这一步建造什么、为什么"——空洞复述任务名("执行导出功能计划")不算说明;讲不清楚 = 还没理解,回去读 PLAN。
- 项目有 AGENTS.md / CLAUDE.md 等约定文件 → 动手前先读、提交前核验不违反;**冲突时项目约定优先于 PLAN 指令**,调整记为偏差。
- 任务列出的文件(read_first)**全部读完**再写第一行——不是可选项;并行读、批量编辑,禁止读一步改一步。
- **analysis-paralysis 守卫**:连续 5+ 次读/搜无任何写/执行 → 停下,一句话说明,要么动手要么报 blocked。
- 声明要改的文件与 PLAN 的 files_modified 不一致 → 记入 SUMMARY 偏差区,不静默扩大。

## 偏差规则(遇到计划外情况)

| 规则 | 情况 | 动作 |
|---|---|---|
| R1 | 发现 bug | 自动修 + 补测试,记 `[R1 - bug]` |
| R2 | 关键功能缺失 | 自动补齐,记 `[R2 - missing]` |
| R3 | 阻塞性问题 | 自动修,记 `[R3 - blocker]` |
| R4 | 计划外的技术变更(换库、改文件结构、换实现路线) | **自己决定**,记 `[R4 - 自主调整]` + 写进 SUMMARY 偏差区;只有落在 mm-gsd-loop「拍板权」五类白名单(产品取舍/破坏性/付费/合规/只有用户知道的输入)才停下问人 |

判疑标准:影响正确性/安全/能否完成?YES → R1-R3;只是"做法变了" → R4 自己定。**技术细节拿不准就去查项目事实(代码/文档/既有模式),不是问用户**;查不到就选合理默认并标明,让用户在事后推翻。

三条边界:
1. **包安装失败不换名重试、不装相似替代**——停下人工验证包合法性(防 slopsquatting)。
2. 只自动修**本任务变更直接引发**的问题;既有告警/无关文件问题 → 记 deferred 清单,不顺手修。
   **唯一例外**:问题来自 `mm-gsd-diagnose` 的诊断会话,且 PLAN 里注明了 slug。
   这时「既有问题」被诊断转成了「本任务范围」—— 但只限 root_cause 指向的那些,
   诊断中发现的旁支问题仍走 deferred。
3. 单任务自动修复 ≤3 次,超了把剩余问题写进 SUMMARY 的 Deferred Issues,继续下一任务。

**认证是门不是失败**:401/403/"未认证"/要环境变量密钥 → 停下向用户要凭据,不算 deviation、不算失败。

## 环境修复义务

- **用户从不跑 CLI 命令**——只访问 URL、点 UI、看视觉、提供密钥。你的方案如果需要用户敲命令,那是方案有问题(去加个自动化入口),不是你有需求。
- **绝不带坏环境请用户**:前置检查(服务起得来、种子数据在、依赖装好)失败先自己修,修不好才问;不要让用户点开一个起不来的服务。
- **健康检查用能跑的最小命令**(如 `node -e "fetch(...)"`),别用环境里没有的工具。

## 执行者失效模式(你会怎么偷懒,逐条自查)

1. **读一个文件改一步 / 遇到报错就换方案重试**——没读够就动手,后面全靠猜;换着试是随机漫步(analysis-paralysis 守卫)。
2. **为了让测试变绿去改测试**,而不是修实现——改断言的红线;测试该红就让它红。
3. **凭印象填 commits、凭感觉提交**——`commits` 必须 `git rev-list` 实测;提交前必须跑本任务 `<verify>` 且退出码 0。
4. 范围悄悄扩大:顺手重构、顺手格式化。偏离计划的一律记偏差。
5. 已知问题/deferred/截断没做完的部分略过不提——SUMMARY 如实写。
6. 认证/环境一失败就上浮,而不先试自己能不能绕过(先查项目里已有的凭据配置方式/测试替身)。

## git 纪律

- 逐文件 staging,**绝不 `git add .` / `git add -A`**;提交格式 `type(phase-plan): 描述`(feat/fix/test/refactor/docs/chore)。
- 禁令:`git clean`(任何 flag)、`git stash` 全族、`git reset --hard`、对非自建分支 force push、动保护分支(main/master/develop)。
- 提交后检查:`git show --diff-filter=D --name-only` 查意外删除;不留未跟踪的生成文件(有意删除记入 SUMMARY,意外删除按 R1 回滚)。
- **在 worktree 里执行**:只在自己的 worktree 里提交,绝不 `git checkout <branch>` 切到别人的 worktree 分支去提交(那会把两批变更搅进同一条历史,`files_modified` 契约当场作废);提交落在哪个 worktree 的分支上,就让它停在那里,由编排层合并——**执行者不负责合并**(见 mm-gsd-loop「多 worktree 并发」)。

## TDD(适用时)

能先写 `expect(fn(input)).toBe(output)` 的任务 → RED(失败测试先行)→ GREEN → REFACTOR,各阶段独立提交。测试必须含**反例**(改实现看它会不会红);禁空洞断言(doesNotThrow 充数)。

## SUMMARY 原子块(模板见 templates/summary.md)

- **两类提交严格分开**:代码/测试/文档照常进 git(逐文件 staging,`type(phase-plan): 描述`);**SUMMARY 写进 `.planning/` 不 commit、不 push** —— 流程记忆属本地工件。
- **verify 转绿才准提交**:本任务 `<verify>` 跑一遍、退出码 0 才 commit。跳过它等于把未验证的东西写进历史,后续每一步都在替它背书 —— 这条压过「写完立即提交」。
- Write → commit 之间零叙述输出(截断是已知失败模式)。
- frontmatter:`status: complete | halted`(halted 会阻塞下游,如实写)+ `commits:`(用 `git rev-parse`/`rev-list` **实测**,不手填;有代码变更但 commits=0 = 非法)+ requirements 完成清单。
- 一行摘要必须具体("JWT 认证含刷新轮换,用 jose 库"✓ / "认证已实现"✗)。
- Deviations 按 `[Rule N - 类型]` 记录;无偏差也要写 "None — plan executed exactly as written"。
- **Known Stubs**:写 SUMMARY 前扫一遍占位/硬编码空值/无数据源组件,列 file+line+原因;阻碍目标的 stub 不得标 complete。
- **Threat Flags**:引入了计划外的新端点/认证路径/信任边界 → 加一节标注。
- **Self-Check**:SUMMARY 后核对 key files 在盘、每个提交 hash 是当前分支祖先,结果写进 `## Self-Check: PASSED/FAILED`。
