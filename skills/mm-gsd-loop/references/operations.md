# mm-gsd-loop 运行细节(正文外迁的知识,按需读;正文留指针)

> 本文件是 SKILL.md 的知识层:只在对应分支才需要的内容。判据语义与 SKILL.md 正文同源,改这里必须同步改正文指针。

## 门禁分层采样(贵的门禁别放在每一步)

| 层 | 什么时候跑 | 跑什么 |
|---|---|---|
| 票级 | 每张票做完 | **本票的便宜检查**(具名测试 / 单文件 / 单入口)—— 票级 verify **不许**是全量套件 |
| 批级 | 一批票全做完 | 批级检查**跑一次**;失败**一次修完**,再跑一次(≤2 轮) |
| 全量 | phase 收尾 | 全量套件 + 全量 health(仓库自己的 `mmc health`) |

**批量收尾**:一批实施完 → 跑一次批级检查 → 失败按票归还(本票失败由该票 exec 修;非本票失败由编排层开修复票派单 —— phase 11 D-03,别让单票 exec 决定别的票怎么修)→ 再跑一次(≤2 轮)。
**不做**「改一处 → 修一次 → 测一次 → 提交一次」:逐次循环里的重复检查没有新证据,只吃上下文。逐次提交可以(提交很便宜),但**贵的门禁不在票里跑**。

## 运行日志与工具遥测

**检查器每跑一次就自动记一行**到 `~/.agents/mm-gsd-runs.jsonl`(用户目录,跨项目可比)—— 之前让 agent 手工追加,实测跑完整个项目一个文件都没有:需要自觉的探子等于没有探子。遥测写失败也绝不阻断流程。每条记录带 mm-gsd 的版本号(`ver`)—— observe 靠它把「当前版本还活的失败」与「更早版本的历史累计」分开排行。不想被记录就设 `GSD_TELEMETRY=0`。

聚合视图(诊断入口,加 `--all` 看全部项目):`node ~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs --stats`。
它报三样:**门禁失败率**、**同一项目反复失败的次数**(≥3 次 = 死锁嫌疑)、**高频报错类型排行**。字段含义跑 `--help` 看。

**每次安装 mm-gsd 后手动清一次这个日志文件**:它记的是上次安装前的使用历史,旧语义混进 `--stats` 会误导;自动清不可追溯,所以程序里刻意没这个开关 —— 要清就手动删。

工具遥测是纯观测面:记录器只 append 一行 JSON 就 exit 0,永不阻断、永不进模型上下文;聚合看 `node ~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs --stats --tools`(grep 次数 / 派发角色 / 近似时长 —— 时长是近似值,窗口 = Task 行到该项目下一个 Task 行,末次标「进行中」)。隐私:只记工具名与命令头(截 140),不记文件内容全文;`GSD_TOOL_TELEMETRY=0` 全停。

## 报修(卡住时把坑报回去,不要自己将就)

**什么时候该报**(这三条不是你的项目的问题,是 mm-gsd 自己的 bug,别绕过去):
- 门禁红了,但你确认输入没错
- 两处指令自相矛盾,你要自己挑一个执行
- 模板照抄不改动,却判非法

```bash
npx mm-gsd-core report "<一句话说清什么坏了>" --evidence "<你跑了什么 + 它报了什么>"
```

**批量:同类问题合成一条**,多个 `--evidence`;**不同类问题分开报** —— 合成一条反而看不出哪个先修(维护方按 issue 排队修)。没有证据的抱怨不算 issue,`--evidence` 必填。**报完记下 URL** —— 命令打印的 issue 地址才是闭环凭据;没装 `gh` 或没登录时它会**非零退出**让你手动贴,那是真的没发出去。展开用法(`--evidence-file`、dry-run)跑 `mm-gsd-report.mjs --help`。

## 多 worktree 并发(默认不做)

**默认不做多 worktree。** 一个项目一个 worktree、串行走完五步环,是绝大多数项目的正解;多开换来的是合并冲突和 STATE 基线过期,不是速度。只在 phase 之间真能零重叠、或同一 phase 内有大片可并行的独立任务时才开。

确要开,五件事:①每个 worktree 独占一个 phase(同一 phase 内一组 `files_modified` 零重叠的任务);②动手前先跑 `--worktrees` 冲突检查(在**任意** worktree 里跑,它读全局列表),有冲突就回去改 phase 切分边界 —— PLAN 没落盘就等于没检查,顺序是"plan 落盘 → 跑检查 → 才建 worktree 并派活";③`files_modified` 是跨 worktree 的唯一安全契约,必须精确到路径:共享入口(路由表、schema、类型索引、公共 util)被两个 phase 碰到,并行必冲突,这个成本要在 plan 阶段暴露,不是合并时才发现;④`files_modified` 管不到的资源(端口、数据库/迁移、共享构建产物、单例服务、测试固定端口)自己分配,写进 plan 的前置条件;⑤合并一个 worktree 后**立刻**在剩余 worktree 里重跑检查器并重读 STATE —— 合并是唯一会全局改变并行安全性的事件。

`.planning/` 是每个 worktree 各自的工作记忆,不跨 worktree 同步;跨 worktree 的事实来源只有一个——git commit history。

### 跨波红窗(守卫跨波变红,计划期承载)

红窗写进票面 frontmatter 的 `red_windows` 列表(`- <守卫或测试路径> | wave <N> | ticket <NN-MM> | close <判据>`,缺兑现票计划门判红,防永久豁免)。放行通道唯一:`mm-gsd commit --ticket` —— 先正常提交,失败项全落该票清单才 `--no-verify` 重试并标注受控放行,清单外失败 exit 2 停下(细节 `node skills/mm-gsd-exec/scripts/mm-gsd-commit.mjs --help`)。phase 收尾逐条核对清单里 `close` 判据是否兑现 —— 计划期声明的红窗机器可读,收尾对账不再人工整理。

## 三层门禁(各管一段,互不替代)

| 层 | 时点 | 管什么 | 强度 |
|---|---|---|---|
| **宿主 hook**(PreToolUse) | 命令执行前 | 守卫:破坏性 git(reset --hard / clean -f / stash drop / force push / 删分支 / 全量 checkout);工具遥测:纯记录每次工具调用(零上下文污染) | 环境级,agent 无法绕过 |
| **gsd-state-check**(每步收尾) | 工件写完 | 工件契约 + 状态一致性 + 假完成信号 + **交付缺口** | 流程级 |
| **gsd-state-check `--plan`** | PLAN 落盘 | 四件套 + read_first 完整性 / fails_when 失败方向 / files_modified 可解析 / 任务预算 / 决策保真 | 流程级 |
| **gsd-state-check `--phases` / `--worktrees`** | 并行开工前 | depends_on 环与波次 / 同波次零重叠 / 跨 worktree 文件与 REQ 冲突 | 流程级 |
| **git pre-commit** | 提交那一刻 | 入库前的工件 | 环境级,但有冲突风险 |

**真正不可替代的是第一层**:那些危险命令不是"提交了错东西",是根本不该执行——后面几层都拦不住(没有 commit 发生)。文本纪律里那串 git 禁令,只有它能机器化。阻断时给出理由和更安全的替代(丢工作用 stash / 要存 WIP 用分支 / 强推用 --force-with-lease)。真需要执行时:改写命令避开匹配,或临时禁用该条 hook。

安装(可选,影响该宿主的全部项目;先确认你接受"不能再随手 reset --hard"):

```bash
node ~/.agents/skills/mm-gsd-loop/scripts/mm-gsd-install.mjs   # 自动探测宿主并按各家格式安装
```

安装器已适配的宿主与 hooks 落点:

| 宿主 | 技能 | 宿主 hook(守卫 + 工具遥测) |
|---|---|---|
| ZCode | 主仓原生(`~/.agents/skills/`) | ✅ `~/.zcode/cli/config.json` → `hooks.events.PreToolUse`(需 `hooks.enabled: true`) |
| Claude Code | ✅ → `~/.claude/skills/` | ✅ `~/.claude/settings.json` → `hooks.PreToolUse` |
| Codex | ✅ → `~/.codex/skills/` | ❌ 跳过(hooks 由插件托管,直装会与插件冲突) |
| Trae / Cursor | ✅ → 各自 `skills/` | ❌ 跳过(未验证 hooks 机制) |
| MiniMax | — | ❌ 跳过(未发现 skills 目录约定) |

用别的宿主?只要它读 `SKILL.md`,把 `~/.agents/skills/mm-gsd-*` 链到它的技能目录即可;hooks 那层对照它的文档手动加 PreToolUse 条目即可(守卫/遥测脚本本身是宿主无关的 node)。

## pre-commit 门禁(可选,多数项目**不建议装**,先查再装)

它的阻断项(status 契约 / commits 纯数字 / 占位文本)已被 **gsd-state-check 完全覆盖且更强**(检查器读全量工件并推导状态,pre-commit 只看 staged 的那几个文件),所以它**只剩一个独特价值:防止坏工件进入 git 历史**。若你不需要这层保险,只装检查器就够——文件流不进 git,工件污染不进历史。

⚠️ **装之前必须先查 `git config --get core.hooksPath`。** 若项目已指向 `.husky`(或任何现有目录),**本门禁不可安装**:它靠 `git config core.hooksPath .githooks` 生效,而 `core.hooksPath` 只能指向一个目录,改了等于**整体顶掉项目现有门禁**(husky 的 commit-msg / pre-commit / pre-merge-commit / pre-push 全部失效)。部分项目还在 `package.json` 的 `prepare` 脚本里自动重设该值,改完会被下一次 install 打回。

确认目标项目**没有**任何现有 hooks 体系时,才可用下面两条(不装也能用,纯文本纪律):

```bash
mkdir -p .githooks && cp ~/.agents/skills/mm-gsd-loop/hooks/pre-commit .githooks/pre-commit
chmod +x .githooks/pre-commit && git config core.hooksPath .githooks
```

阻断:SUMMARY 缺 `status: complete|halted` 或 `commits` 非纯数字;VERIFICATION 的 status 非法;警告:工件含占位文本。跳过单次用 `--no-verify`(想清楚为什么)。已有门禁体系的项目**不要叠加**——要加只能**追加到现有 hook 文件内**,不换 hooksPath。

## 编排层失效模式(你会怎么偷懒,逐条自查)

1. 把"跑完了"当"完成了"——verify 没 PASS 就 ship。
2. 每步产出留在对话里不落盘,下次会话全丢(STATE/CONTEXT/SUMMARY 才是记忆)。
3. STATE 越写越长,最后没人读(它是 <100 行的 digest)。
4. 中断时不写 HANDOFF,下次从零猜。
5. fast 通道做到一半发现是大事,硬着头皮降级做完(应该停下转完整循环)。
6. 修复回路超预算还继续盲修(2 轮不成就该找根因)。
7. 派活时替子代理把活想一遍 —— 那是它的工作,不是你的。你只给路径与目标。
8. 把流程记忆 commit 进业务目录、或对被 exclude 的 `.planning/` 硬 `git add -f` —— 越权污染共享契约。
9. 逐次循环:改一处 → 修一次 → 测一次 → 提交一次,贵的门禁插在每次改动里 —— 那是重复检查、没有新证据、只吃上下文。

## 时效三层(自包含定义)

工件按时效分三层 —— append-only 审计工件(REQUIREMENTS / 双 LEDGER / artifact-ledger)是**冻结层,永不焚毁**;STATE 是**活跃层**,可整节改写;临时产物**从一开始就不落 .planning**(工程标准已禁项目根临时文件)。"焚毁"指清掉临时产物这回事,**只作用于临时层,不删任何审计工件** —— 与审计文化不冲突,别误读成"删历史"。

## deferred 卫生(自包含)

写 deferred 条目必须带三列——分类(可做/挂条件/关闭)+ 触发条件或关闭理由 + 归属;未分类条目是没回答过「什么时候做、谁做」的欠账,看板会计数并黄条提醒(未分类超阈)。存量归位走 .planning/deferred-LEDGER.md 处置台账(原件零改动,同键追加行即修正);dismissed 必须引证据(实现它的 phase / 推翻它的决策),无证据销账是假销账。
