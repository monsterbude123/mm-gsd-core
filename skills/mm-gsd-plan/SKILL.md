---
name: mm-gsd-plan
description: "极简 GSD 规划:goal-backward 目标倒推、tracer-first 垂直切片、任务四件套(files/action/verify/done)+ fails_when 失败方向契约、D-NN 决策保真、多源覆盖审计。"
---

# MM-GSD 规划

输入:先读 `.planning/STATE.md` 与本 phase 的 `*-CONTEXT.md`(已定决策不重新发明;冲突标注)。产出:`.planning/<NN>-<MM>-PLAN.md`(任务数 ≤3 可精简,但**必须落盘**——闭环靠它逐条对 verdict)。

**PLAN 落盘后跑门禁,转绿才准进执行**:`node ~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs --plan .planning/<你的文件>`。它拦的是模型最容易自我放水的几条:四件套缺项、verify 缺 fails_when 方向、files_modified 模糊措辞(并行保护整个失效)、任务超预算、action 塞代码块、范围缩水措辞、red_windows 缺兑现票、CONTEXT 里无人认领的 D-NN。**门禁报什么就改什么,不要绕着写**——每一项在本文件都有对应条款。

⚠️ **门禁报错不要停在那里等人**:`--plan` 列的每项都是这份 PLAN 自己能改的,改完重跑。只有两类情况才停下:要推翻 CONTEXT 已锁定的 D-NN(需求变更),或报错要动别的 phase 的工件。其余自己修掉继续走。自修**写入范围 = 这份 PLAN 自己**(.planning/ 工件与模板),不触碰项目源码;**规划期不跑命令**(构建/测试归执行端),实测改为引用仓库既有事实并注明出处。phase 清单刚定过 → 先 `--phases` 看波次(同波并行,files_modified 必须零重叠,现在发现冲突比合并时便宜)。工件落点:流程记忆进 `.planning/`(不入库),业务票面进 `.scratch/<主题>-<日期>/`(入库共享)。

## 用户批注消化(开头必做)

拆票前读 `.planning/annotations.json`;`.planning/annotations.json` 不存在 = 没有待消化批注，直接继续。**status=open 的批注按 type 消化**,消化后改 digested(不消化,检查器一直黄提醒)。分流按 mm-gsd-discuss 的「批注分流表」执行;plan 阶段额外做两件事 —— action=requirement 补出来的 REQ 要在本 phase 拆票里认领,action=diagnose 的结论若落在本批范围内就并进本批票。需求遗漏 → 回 discuss 草拟 REQ 走确认门;方向不对 → 回 discuss 重开决策;备注 → 摘进相关票 action;验收不过 → 不在本批修,走 mm-gsd-loop「点修」分流(R 票)。

## codebase-map(入口级)

拆票前生成 `.planning/codebase-map.md`,四节**一屏内**:目录入口;关键入口符号(名字即可);禁区清单(.worktrees/node_modules/dist/vendor);工具优先级(codegraph_explore 类 > 定向读文件 > ripgrep 定向 glob > 全目录 grep 禁)。靠索引类工具汇总,不逐文件读,不存签名/调用图;入口级轻量 → 过期丢掉重做;预审/verify/exec 消费它,不重建。

## 拆票(两层)

**Phase 票 = 可独立验证的目标切片**:phase 做完用户能做一件之前做不了的事;**垂直切不水平切**(功能贯穿到底,不"先做完后端再做前端"——水平切的 phase 验证不了就要靠猜)。预估超一个执行上下文(~50%)→ 拆两个 phase。新项目 phase 01 固定 walking skeleton。

**Plan 票 = 一个执行上下文一次跑完的量**:2-3 任务/plan,>3 或跨子系统 → 拆;每张票可独立提交独立验证(有自己的 fails_when),单张票失败不传染;依赖只指向更早的票;并行票**零文件重叠**(files_modified 就是并行的安全契约)。**一张 PLAN 就是一批**:批内 `wave` 标同批,同批零文件重叠,撞了拆批;批级检查写 frontmatter `batch_verify`(**有界**:具名文件或子目录树,全量归 push 阶段),一批跑一次,失败一次修完再跑(≤2 轮);一票 = 一个子代理 20 分钟的量(≤5 文件、≤1 条 verify);≤3 任务的小 phase 可内联进执行 prompt,但仍落精简 PLAN 文件。

## 预授权决策清单

PLAN 单列 `<auto_decisions>` 节:执行期可能要问用户的点,**规划时**查清项目事实定夺,标 `[AUTO]` + 一句依据;执行期照做不再问。只覆盖拍板权五类**之外**的点;预授权前先查对应 REQ 有没有漏落(没有就先补落 REQUIREMENTS.md);用户推翻 `[AUTO]` 算需求变更,走下一轮讨论。

## 目标倒推(goal-backward)与 tracer-first

从 phase 目标反推,不从功能列表正推:goal(结果形)→ 可观察 truths(3-7 条,用户视角:"密码是安全的"✓ / "bcrypt 已安装"✗)→ artifacts → 连线;记一句回退方案。首任务 = 贯穿所有层的**最薄端到端路径**,生产质量非原型(功能可缺,架构不可缺);"只打地基"是伪装的水平切分。

## 任务四件套(每个任务必填)

`<files>` 精确路径禁模糊语;`<read_first>` 要改的文件必读 + 真理来源文件是**核对点**(确认图纸与现状一致,不是从头理解项目)——**规划期把要核对的东西摘进 action**,摘得越清楚执行端要开的文件越少;**read_first 预打包(可选,兑现 R-21)**:对真理来源文件跑 `mm-gsd context-pack <files>`(bin 转发 skills/mm-gsd-loop/references/context-pack.mjs),把输出的紧凑 `<interfaces>` 块贴进 PLAN,执行端按行号锚点直取签名,不为找接口通读整文件;`<action>` 做什么 + 避免什么及为什么,不含代码块;`<verify>` 自动化验证命令;`<done>` 可度量判据。任务数 ≤3 也要落精简 PLAN(每任务一行四件套),不落盘 = 闭环断裂。

**fails_when 契约**:每条 verify 后紧跟失败方向(退出码/输出串/缺失行);TBD/N-A/none 视为没写。可选 `<precondition>`:一行可检验的前置事实,不满足即停。**验证命令复用**:上一 phase 跑通过的命令逐字复制,不重新推导路径。每个 plan 另列 `files_modified` 全清单与 `depends_on`。跨 worktree 时 files_modified 是安全契约不是元数据,必须机器可解析(见 mm-gsd-loop「多 worktree」)。**事实仲裁**:计划与仓库事实冲突,事实为准(注明出处);引用的事实错了 → 打回改计划;判不了 → 报差异。

## 验收反模式(出现即打回)

三条普适禁令:禁主观语("looks correct"/"完成该功能");`|| true`/`2>/dev/null || echo 0` 喂比较 = 假验证;**判据在零数据输入下会绿**(写完每条 verify 自问:空台账/零匹配下退出几)。断言必须落在真命令上,注释与自造 echo 不算。**先在旧码上跑一遍**:写完 verify 立刻对改动前的代码跑它 —— 应当失败;旧码就能过的断言证明不了任何变更(E2E 实测:拼音断言零依赖不可达、期望值笔误,都是实跑才暴露)。**判据与可直接抄的命令形态库(go/cargo 正反面/过滤器形态/grep 卫生/$? 捕获邻接性/量错树)在 `references/verification-forms.md`**,写 verify 前按需读;规划者失效模式自查表同在该文件。

## 决策保真(D-NN)

CONTEXT 每条 D-NN 必须被本 phase **至少一张票认领**并精确实现;矛盾 → 停下问人;deferred 条目不进计划。**一张票的 covers 只写它真做的决策** —— 核销是 phase 级 union:全部票的 covers 并集覆盖 CONTEXT 全部决策,少一条 phase 级门指名报红;判据只扫 covers 字段,正文提到不算认领。covers 同时支持 REQ-N:每条 REQ 至少一票认领(checkReqCoverage 判「REQ 无人认领」)。不让每票写全 phase 决策——那会逼着只做三分之一的票填不相关决策,与「记账不全」同一类病。

## 缩水禁令

计划出现 v1 / simplified / for now / placeholder / basic version / minimal implementation / skip for now / will be wired later = 范围缩水,重写。规划者无权判定"太难"——只有三个正当拆分理由:上下文装不下、信息缺失、依赖冲突。技术选型按项目既有模式自己定标 `[AUTO]`;只有 mm-gsd-loop「拍板权」五类才停下问用户。

## 多源覆盖审计(定稿前必做)

四源对照:GOAL / REQ / RESEARCH(有条件必经)/ CONTEXT。任一 MISSING → 显式报告并决定(补任务/移下一 phase),**绝不带缺口静默定稿**。需求缺口回 `mm-gsd-discuss` —— 用户拍板是讨论期的活,你替用户拍板 = 把本该被问的问题悄悄定成技术默认。

**RESEARCH 不是「如做了」**:满足任一触发条件必须研究 —— files_modified 跨 ≥3 顶层目录 / 触及 git 历史从未改过的目录 / goal 明写「深入了解」。成立 → 写 `.planning/<NN>-RESEARCH.md`(读到了什么、决定了什么,至少一条 file:line 引用,`## 摘要` 节 ≤15 行);不成立 → 审计表写「不适用:<理由>」(检查器按同一套条件判红)。**研究派只读子代理做**,主上下文只拿摘要 + 落盘路径;研究写完把用到的结论摘进票的 action 并在 read_first/action **点名**研究文件(不点名 = 落盘了没人读,执行端重查一遍)。

## 执行前预审与显式校验

机械合规(`--plan` 退出码 0)不等于计划成立 —— L3 重型计划或跨模块变动执行前由编排层派**全新上下文只读子代理**(Judge 冷隔离)预审,L2 常规迭代可走增量核对(照 mm-gsd-verify「执行前预审」节;预审只报不处方),产出 `<NN-MM>-PLAN-CHECK.md`;BLOCKER 不清零不许进执行。改了 PLAN → **机器判据重跑 + 增量销号复核**(计数不降即停,R-26);phase 收敛工件在场时票级预审被取代。用户随时问「这份计划能开工吗」→ **直接调用 `mm-gsd-plan-check` 技能**(或跑 `node ~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs --plan-check <PLAN>`)。

## 完成后

- 判据:PLAN 落盘 + `--plan-check` 退出码 0 + 预审结论 `status: passed` —— 票级工件
  `.planning/<NN-MM>-PLAN-CHECK.md`,或本 phase 走了 phase 一次预审时的收敛工件
  `<NN>-REVIEW-CONVERGENCE*.md`(同一 phase 目录;R-26:收敛工件在场票级预审被取代)。
- **下一步:调用 `mm-gsd-exec`**,按四件套动手,别临场重解需求;预审没过不许进这一步。`--plan` 没转绿就进执行 = 拿执行者猜不出的契约开工。
- 环的完整顺序只有 mm-gsd-loop 持有,这里只写自己这一步的出口。
