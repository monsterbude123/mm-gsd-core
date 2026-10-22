# mm-gsd-core

> 从 GSD 蒸馏出的极简核心：**把"散文约定"换成"机器门禁"**。

GSD Core 的设计我很喜欢——五步成环、fresh-context 子代理、规划期预授权、验证独立于执行。
但它太重了：单是规划环节的提示词就有上万字，主上下文很快被吃掉，执行一轮 phase 要 17–25 分钟。

这个仓库是把它**砍到只剩骨架、再给每条纪律配一个能跑的检查器**的结果。

核心信条一句话：**每步收尾的动作是"跑检查器转绿"，不是"更新 STATE"。**
后者是散文约定——模型自觉的时候有用，不自觉的时候等于没有。门禁不是。

---

## 目录

- [它是什么 / 不是什么](#它是什么--不是什么)
- [安装](#安装)
- [五步成环](#五步成环)
- [检查器](#检查器)
- [遥测](#遥测)
- [仓库结构](#仓库结构)
- [设计上的几个硬决定](#设计上的几个硬决定)
- [发布部署](#发布部署)
- [自我维护:它自己怎么变好](#自我维护它自己怎么变好)
- [已知局限](#已知局限)

---

## 它是什么 / 不是什么

| | GSD Core | mm-gsd-core |
|---|---|---|
| 定位 | 全流程 spec 驱动开发系统 | 极简核心，五步循环不变，配套全砍 |
| 纪律的表达方式 | 提示词散文 | 散文 + **机器门禁**（检查器） |
| 上下文成本 | 高（规划提示词上万字） | 低（每个 skill 几十行） |
| 并发 | worktree / orchestrator 能力协商 | `files_modified` + `--phases` 波次校验 |
| 依赖 | npm 包 + Node | 零依赖（只有一个 node 脚本） |

**没保留的**：多源研究审计（研究工件本身留了：跨目录或陌生领域的改动必须先有
`.planning/<NN>-RESEARCH.md`，且带 `file:line` 引用）、上下文工程分档、模型路由与降级、完整 CLI 工具链。
这些不是不好，是**在提示词里写它们会让每一步都变慢**，而收益要用很多轮才能兑现。

**保留并强化的**：五步成环、拍板权五类白名单、规划期预授权、任务四件套 + fails_when 契约、
决策保真 D-NN（核销按 phase 级并集）、缩水禁令、多 worktree 并发契约，
以及一条 GSD 没有的**终态门禁**（见下）。

---

## 安装

### 一条命令(npm / npx)

```bash
npx mm-gsd-core                 # 装到 ~/.agents/skills/
npx mm-gsd-core install --local # 装到当前项目的 ./.agents/skills/
npx mm-gsd-core install --hooks # 顺带装宿主 hook(危险 git 拦截)
npx mm-gsd-core doctor          # 体检宿主环境与已装状态(只读)
npx mm-gsd-core check --plan    # 直接跑状态检查器
```

零依赖，Node ≥ 18，跨 Windows / macOS / Linux。装完 6 个技能就位：
`mm-gsd-discuss` / `mm-gsd-plan` / `mm-gsd-exec` / `mm-gsd-verify` / `mm-gsd-diagnose` / `mm-gsd-loop`。

**npx 只需要一个 bin** —— 多个 bin 时 npx 会报 `could not determine executable to run`，
所以本包只暴露 `mm-gsd` 一个入口，检查器通过 `mm-gsd check` 转发。

### 手动安装

```bash
git clone <this-repo>
cp -r skills/mm-gsd-* ~/.agents/skills/

# 危险 git 拦截(host hook,环境级,agent 无法绕过)
node ~/.agents/skills/mm-gsd-loop/scripts/mm-gsd-install.mjs --check   # 只体检
node ~/.agents/skills/mm-gsd-loop/scripts/mm-gsd-install.mjs           # 装
```

安装器覆盖 ZCode / Claude Code / Codex / Trae / Cursor，按各家格式写入；
hooks 机制没验证过的宿主只装技能、不装 hook（fail-closed，宁可不装也不写坏配置）。

**这个仓库是真理源，`~/.agents/skills/` 是派生产物。** 改了逻辑先改这里，再同步过去。
npm 包同样是从这里打的：`npm run pack:check` 会模拟一次真实安装，
确认包里该有的文件一个不少、检查器七种模式在包内路径真能跑。

---

## 五步成环

```
discuss ──→ plan ──→ execute ──→ verify ──→ ship
                                                 ↑__________|
                                          (修不好就回 execute,预算 2 轮)
```

| 环节 | 做什么 | 落盘物 | 关键纪律 |
|---|---|---|---|
| **discuss** | 捕获灰区决策，锁 D-NN | `<NN>-CONTEXT.md` | 思考伙伴不是访谈员；没有灰区也要写最小 CONTEXT |
| **plan** | 拆票、目标倒推、tracer-first | `<NN-MM>-PLAN.md` | 任务四件套 + fails_when + files_modified + D-NN 全引用 |
| **execute** | 逐任务施工、原子提交 | `<NN-MM>-SUMMARY.md` | 偏差规则 R1–R4；技术决策自己定，只记 `[AUTO]` |
| **verify** | 独立验证，证据驱动 | `<NN>-VERIFICATION.md` | 假设"任务完成了但目标落空"，逐条推翻 |
| **ship** | 交付物**被消费** | `<NN-MM>-SHIP.md` | 写 `delivered` 前先核对 PR/合并/发布是真的 |

每个技能还带一条「完成后」小节：跑完这一步，先确认什么、敲哪个 mm-gsd 技能、什么情况下不敲。
环的完整顺序只有 `mm-gsd-loop` 一处持有，别处不复制那张表——`--routes` 门禁盯着这件事。

**最后一环是本仓库相对 GSD 的一个增量**：GSD 的工件链止于 VERIFICATION，
验证一通过就等于宣布 phase 完成，而合并/发布/文档同步没有任何工件管它。
这里 VERIFICATION 通过只推出 `completed`，**只有 SHIP 落盘才推出 `shipped`**。

---

## 检查器

整个仓库只有一个可执行文件，七种模式。它是"门禁"的实现。

```bash
CK=~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs

node $CK --init "<项目目标>"   # 冷启动:建 .planning/STATE.md
node $CK                      # 每步收尾:工件契约 + 状态推导 + 交付缺口
node $CK --plan               # PLAN 落盘后:四件套/失败方向/文件清单/任务预算
node $CK --phases             # 规划前:算波次 + 同波次零重叠 + 环依赖
node $CK --worktrees          # 并行前:跨 worktree 文件与 REQ 冲突
node $CK --routes             # 技能门禁:每个技能都写清了自己的下一步
node $CK --stats              # 诊断:读遥测,不用手工记
```

退出码 `0` = 转绿，`1` = 有违规。可以直接接 CI 或 host hook。

### 检查器拦什么

**默认模式**

- 从工件存在性推导真实状态，与 STATE 声明比对——**STATE 不能说谎**
- 工件字段契约：SUMMARY 的 `status`/`commits`（必须 `git rev-list` 实测）、
  VERIFICATION 的三值 status、SHIP 的 `status` + `delivered` 证据
- 交付缺口：验证过了却没有 SHIP → 警告"停在验证没走到交付"
- 假完成信号：占位文本、`STATE.md` 超 100 行、paused 却没有 HANDOFF
- **记账完整性**：SUMMARY 声称 `status: complete` 却 `commits: 0` → 判红"说做完了，
  却拿不出一个 commit"。存量项目的老工件会当场变红，豁免台账 `.planning/artifact-ledger.md`
  是随包件：记一行指向一个真实存在的 commit，原件不动（原件是审计痕迹）

**`--plan`**

- 五件套（`files`/`read_first`/`action`/`verify`/`done`）缺一不可
- `verify` 必须带 `fails_when` 失败方向——**没有失败方向的验证是假验证**
- `files_modified` 不许出现模糊措辞（会让并行保护整个失效）
- `verify` 里不许 `|| true` 之类的"永远为真"写法
- 任务数 ≤3、单任务文件 ≤5，超了是拆票不是缩内容
- **决策核销按 phase 算**：本 phase 所有票的 `covers` 并集要覆盖 CONTEXT 的全部决策，
  少一条指名报错。票只写自己真做的决策（正文里提到 D-NN 不算认领）
- **反向核销**：票认领的决策已不在 CONTEXT 里 → 报"这张票实现的是已被推翻的决策"，
  并给出 `stale_note` 批注格式；批注点名的接替票必须真实存在，否则免单不成立
- **研究有条件必经**：改动跨 3 个顶层目录、碰到 git 历史里没改过的目录、或目标明写
  "深入了解" → 必须有 `.planning/<NN>-RESEARCH.md`，且带 `file:line` 引用
  （落在对话里的研究下一轮看不见，等于没做）
- **过程健康三数**：顺带打印本 phase 的票数 / 受阻票数 / 缺口数（量取自工件，不是遥测）——
  这是**过程健康**，不是质量分，别拿它当评分卡

**`--phases`**

- `depends_on` 成环 → 直接报错（没有合法执行顺序）
- 同一波次内各 phase 的 `files_modified` 必须零重叠

**`--worktrees`**

- 跨 worktree 的 `files_modified` 交集 → 冲突
- REQ 编号只有**共用同一份 `REQUIREMENTS.md`** 时才谈得上冲突；
  否则只是各自局部编号撞车，降级为提示不阻塞

**`--routes`**

- 每个 mm-gsd 技能都要有「完成后」小节——跑完这个技能，人不知道下一步该敲什么
- 小节点名的 mm-gsd 技能必须真实存在（点错名字当场判红）
- 每条问题自带改法：缺小节要**补一段**，点错名字要**改名字或把技能补上**——
  改法与问题对不上，等于没给下一步

---

## 遥测

检查器每跑一次自动往 `~/.agents/mm-gsd-runs.jsonl` 追加一行（ts / 项目 / 模式 /
推导状态 / 报错 / 警告 / 退出码），**不需要任何人记得写**。

```bash
node ~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs --stats        # 当前项目
node ~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs --stats --all  # 全部项目
```

`--stats` 报三样最有用的东西：**门禁失败率**、**同一项目反复失败次数**（≥3 次 = 死锁嫌疑，
不是内容质量差）、**高频报错类型排行**。

不想被记录：`GSD_TELEMETRY=0`。遥测写失败也绝不阻断流程。

> 这套机制第一版是"agent 每个 phase 手工追加一行 JSONL"，跑完一个真实项目后一个文件都没有。
> **需要自觉的探子等于没有探子。** 检查器是每步必跑的机器门禁，它手里已经有全部字段。

---

## 仓库结构

```
mm-gsd-core/
├── README.md
├── skills/
│   ├── mm-gsd-discuss/   SKILL.md
│   ├── mm-gsd-plan/      SKILL.md + templates/{context,plan}.md
│   ├── mm-gsd-exec/      SKILL.md + templates/summary.md
│   ├── mm-gsd-verify/    SKILL.md + templates/verification.md
│   ├── mm-gsd-diagnose/  SKILL.md + templates/debug-session.md
│   └── mm-gsd-loop/      SKILL.md
│                         + scripts/{gsd-state-check,mm-gsd-install}.mjs
│                         + hooks/{guard-dangerous-git.mjs,pre-commit}
│                         + templates/{state,ship}.md
│                         + references/*.mjs   各门禁的判定内核(按需加载,不占主脚本)
│                           decision-gates / ticket-alive   决策核销·可逆性·漂移
│                           artifact-ledger                 历史工件三态 + 记账门
│                           research-gates / verification-gates
│                           skill-routing-gates             「完成后」路由门
│                           template-gates / selftest-suite 模板契约 + 门禁自测
└── workflows/
    └── mm-gsd-phase.dwf.ts    ZCode 动态工作流(7 阶段 + 模型路由)
```

**三层门禁各管一段，互不替代：**

| 层 | 时点 | 强度 |
|---|---|---|
| 宿主 hook（PreToolUse/Bash） | 命令执行前 | 环境级，agent 无法绕过——真正不可替代的是这层 |
| 检查器 | 工件写完 | 流程级 |
| git pre-commit | 提交那一刻 | 可选，与项目现有 hooks 体系冲突时不要装 |

---

## 设计上的几个硬决定

**拍板权只有五类要问用户。** 产品取舍 / 不可逆破坏性 / 花钱或外部副作用 / 法律合规 /
只有用户知道的输入。其余（选库、文件组织、命名、测试写法、重构边界）一律自己定、标 `[AUTO]` + 依据。
拿不准就去查项目事实，查不到就选一个合理默认并标明——**不要因为"拿不准"而上浮**。

**提问成本从执行期挪到规划期。** PLAN 里单列 `<auto_decisions>` 节，把执行期可能要问的点
在规划时就查清并定夺。这不是"预先替用户做主"，是把它挪到信息最全的时候决定。

**门禁必须自带解法。** 门禁要的东西如果执行方这一步做不到，它就不是门禁是墙。
`--init` 就是为此存在的：任何步骤都能一条命令把 STATE 建起来，不会卡死。

**工件链的最后一环不能省。** 省掉 SHIP，循环就在"验证过了"这个半成品状态上宣布结束。

---

## 发布部署

仓库是真理源,`~/.agents/skills/` 是派生产物。**两者之间只走发布部署,不再手工 cp。**

```bash
node tools/mmc.mjs release --patch    # 完整流程
```

六步,顺序是有讲究的:

| 步 | 做什么 | 为什么是这个顺序 |
|---|---|---|
| 1 | 跑 `mmc health` 全部门禁 | 门禁不绿就不该发出去 |
| 2 | 递增版本号(改 `package.json`) | 版本是发布的标识 |
| 3 | 提交 + 打 `vX.Y.Z` 标签 | 代码与版本一一对应,可回溯 |
| 4 | `npm publish` | 发出去了就收不回来 |
| 5 | `git push main --follow-tags` | GitHub 上有对应的 tag 与 release |
| 6 | **从 npm 装回本机** | 装回的是"发出去的那一份",不是仓库里那份 |

第 6 步是这个流程的关键:如果最后一步是从仓库直接装,就会出现"本地改了没发出去"的错觉。
从 npm 装回来,装的就是别人会拿到的那一份。

**开发期用 `mmc sync`**:从仓库装到本机,走的是和 npm 包完全相同的安装路径,
同样写版本清单(`source` 标成 `repo:...` 以示区别)。区别只是发布没走 npm。

## 版本可追溯

装一次就写一份清单,记下版本、来源、时间、每个技能的指纹:

```
~/.agents/skills/.mm-gsd-install.json
```

`mmc doctor`(或 `npx mm-gsd-core doctor`)会拿它和当前包比对,
不一致就报「装的是旧版,跑一次 install 更新」。

手工 cp 装的东西没有这份清单 —— doctor 会直接说
「没有版本清单 —— 这份是手工拷进去的,版本不可追溯」。

## npm 账号的前置条件

npm 现在要求发布必须带 **2FA 绕过**,两条路:

- **开 2FA**(验证器 App),发布时带一次性验证码:`npm publish --otp=123456`
- **细粒度 token**,在 <https://www.npmjs.com/settings/access-tokens/create> 创建,
  勾上 **Bypass 2FA** + **Packages 选 Read & write**,
  然后 `npm config set //registry.npmjs.org/:_authToken <token>`

没配好会报 `403 Forbidden - Two-factor authentication or granular access
token with bypass 2fa enabled is required to publish packages`。


---

## 自我维护:它自己怎么变好

这个仓库用 mm-gsd 的标准要求 mm-gsd 自己。改它的时候走这条环:

```bash
node tools/mmc.mjs observe    # 读 ~/.agents/mm-gsd-runs.jsonl,找重复失败
node tools/mmc.mjs inbox      # 把使用方报修拉成本地 issue
node tools/mmc.mjs issue      # 带证据转 issue(没证据不给建)
node tools/mmc.mjs fix        # 标记解决并跑全部门禁
node tools/mmc.mjs close      # 关掉已修的 GitHub issue
node tools/mmc.mjs distill    # 复盘 → 规则 / 理论条目
node tools/mmc.mjs health     # 每次提交必跑,CI 也会跑
```

闭环是 `inbox → fix → release → close`。使用方 agent 那边报修走随包分发的入口:

```bash
npx mm-gsd-core report "<标题>" --evidence "<复现命令或报错>"
```

`close` 只作用于已 `fixed` 且带 `github:` 行的 issue。两边状态不同步是常态,
所以门禁不假设它同步,每次都去 GitHub 读回真实状态。

`observe` 读的就是检查器自己写的遥测。跑起来的当场效果:
它会把你真实项目里的重复失败聚成几类,并标出哪些值得转 issue。

**防肥胖靠两条硬约束,不是靠自觉:**

1. `budget.json` 定死总行数与单文件上限,超了就红。**变胖必须有等量删除。**
2. `.agents/rules/ledger.json` 里**每条 active 规则必须挂一个可跑的门禁**。
   挂不上检查的纪律只能进 `candidates`——因为这个仓库自己的历史已经证明,
   写了没门禁的纪律在真实项目里会原形毕露。

**造门禁的判据:上线前必须先造一个违规输入,证明它真的会红。**

假绿门禁比没有门禁更危险:没有门禁你知道没检查,假绿门禁你以为有检查。
所以门禁自己带自测(匹配器用例、台账完整性、模式可运行性),台账坏掉会硬失败而不是显示"全通过"。

详见 `AGENTS.md`(开发规则)与 `docs/theory.md`(跨实现通用的规律沉淀)。

## 已知局限

写得很直白，因为这个仓库还年轻：

1. **真实项目只跑过一轮**。六个 skill 里 discuss 在真项目上产出过一份 252 行、
   带行号级代码引用的 CONTEXT（质量已验证）；plan/exec/verify/ship 的真实使用**尚未在第三方项目验证**
   ——本仓自己已跑完 3 个 phase（02/05/06）的完整五步环，但那是自举，不等于外部项目的使用。
   检查器在合成夹具上全模式通过，但那不等于在真实循环里能转绿。
2. **还没接上 GSD 的研究成果沉淀**。原版有 `.learnings/`、intake 扫描、跨 phase 的学习回路，
   这里没有。
3. **没有多源覆盖审计**。CONTEXT/REQ/GOAL 的四源对照只在 plan skill 里留了一条纪律，没有程序化检查。
4. **`--stats` 的死锁检测目前是启发式的**（同项目失败 ≥3 次），没有区分"内容不合格"和"门禁要的东西做不到"。
5. **ZCode workflow 未与检查器深度集成**，目前是独立的 7 阶段流水线，没有复用这里的门禁模式。

前三条是我知道该做还没做的，后两条需要更多真实数据才能判断是否值得做。

> 第 4 条(`check-templates-self-validate` 覆盖不全)**已于 2026-10-19 解决**:新增 `--templates` 模式与
> `references/template-gates.mjs`,6 份模板全有结构门禁,CONTEXT 补上了实例门禁。
