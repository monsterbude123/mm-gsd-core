# AGENTS.md — mm-gsd-core 的开发规则

> 本仓库用 mm-gsd 的标准要求 mm-gsd 自己。所以这份文件很短——
> 每条纪律都在 `.agents/rules/ledger.json` 里有台账条目并挂了可跑的门禁。

---

## 核心循环(改动 mm-gsd 时走这个)

```
observe ──→ issue ──→ fix ──→ distill ──→ health ──→(回到 observe)
```

| 步 | 命令 | 干什么 |
|---|---|---|
| observe | `node tools/mmc.mjs observe` | 读遥测找重复失败 |
| inbox | `node tools/mmc.mjs inbox` | 把使用方报修拉成本地 issue（接进同一条修复流）|
| issue | `node tools/mmc.mjs issue "<标题>" --evidence "<证据>" [--push]` | 带证据转 issue（**没证据不给建**）|
| fix | `node tools/mmc.mjs fix <id>` | 标记解决并跑全部门禁 |
| close | `node tools/mmc.mjs close <id>` | 关掉已修的 GitHub issue |
| distill | `node tools/mmc.mjs distill` | 复盘 → 规则 / 理论条目 |
| health | `node tools/mmc.mjs health` | **每次提交前必跑** |

### 闭环两端

**使用方报修**（随包分发，agent 在任何项目里都能跑）：

```bash
npx mm-gsd-core report "<标题>" --evidence "<复现命令或报错>"
```

多个 `--evidence` 合成一条 issue —— 同类问题一次报清楚，别拆成三条让维护方做三次上下文切换。

**维护方闭环**：`inbox` → `fix` → `release` → `close`。

`close` 只作用于已 `fixed` 且带 `github:` 行的 issue。本地 fixed 而 GitHub 没关，
`inbox` 会再拉一遍，`close` 会明确说"别当成已闭环"。两边状态不同步是常态，
所以门禁不假设它同步，而是每次都去 GitHub 读回真实状态。

---

## 不可协商的三条

**1. `mmc health` 必须绿才能进 main。** 它逐条执行台账里每条 active 规则挂的检查。
不绿就是没门禁了,不是"门禁坏了可以绕过"。

**2. 变胖必须有等量删除。** `budget.json` 有总行数上限和单文件上限,`health` 会拦。
想抬上限,先在 `docs/theory.md` 写清楚**为什么可以放宽、放宽换来了什么可度量的收益**——
"需要更多空间"不算理由。这是本仓库防肥胖的唯一硬约束。

**3. 挂不上门禁的规则,只能进 `candidates`,不能进 `active`。**
这是台账的元规则（R-02）。写成散文但没检查的纪律,和没写一样——
本仓库的历史已经证明:写了没门禁的纪律会在真实项目里原形毕露。

---

## 发布部署(改完 mm-gsd 之后)

```bash
node tools/mmc.mjs sync            # 开发期:仓库 → ~/.agents/skills/
node tools/mmc.mjs release --patch  # 发布:门禁 → 版本 → 提交/标签 → npm → 推 GitHub → 装回本机
node tools/mmc.mjs doctor          # 看装的是哪一版、有没有漂移
```

**`~/.agents/skills/` 只能通过这条流程更新,不许手工 cp。** 手工拷的东西没有版本清单,
出了问题说不清是哪一版。安装会写 `~/.agents/skills/.mm-gsd-install.json`
(版本 / 来源 / 时间 / 每个技能的指纹),doctor 拿它和当前包比对,漂移会报出来。

`release` 的最后一步是**从 npm 装回本机**,不是从仓库装 —— 这样装回来的就是别人会拿到的那一份,
不会出现「本地改了没发出去」的错觉。

---

## 造门禁的判据(照着做,别自己发明)

> **任何新门禁上线时,必须先造一个违规输入,证明它真的会红。**

这不是形式主义。本仓库历史上最险的一次事故就是这个:
glob 匹配器坏掉时**不抛异常**,只是永远不匹配,于是单文件上限检查一路显示绿色对勾、静默空过。
**比没有门禁更坏**——没有门禁你知道没检查,假绿门禁你以为有。

所以:

- 匹配器 / 解析器 / 过滤器这类基础设施,**自带自测用例**(见 `check-budget` 里的 `MATCHER_SELFTEST`)
- 改门禁之后,造一个违规输入跑一遍,确认它红;再恢复,确认它绿
- 门禁自身出错时,要**明确报错**,不能 `catch {}` 吞掉后返回通过

---

## 加东西之前先问

- 这条纪律**能被机器检查吗**？能 → 写 check 挂台账。不能 → 说明为什么不能,进 `candidates`。
- 这会让系统变大吗？会 → **删掉等量的东西**。净增量为负,或者保持持平。
- 这是"这次的实现细节"还是"通用规律"？实现细节留在 git history 就够了,别写进 skill。

---

## 仓库结构与真理源

```
skills/       ← 分发给用户的产物(装进 ~/.agents/skills/)
tools/mmc.mjs ← 维护这个仓库自身的 CLI
docs/         ← 理论沉淀与复盘
.planning/    ← 本地 issue(运行期,gitignore)
```

**`skills/` 里的东西必须自洽**:模板要能通过自己的门禁(`R-05`)、
脚本要零依赖且六个模式都真能跑(`R-04`/`R-06`/`R-07`)。

---

## 已知局限(改了记得更新)

见 `README.md` 的「已知局限」。**这一节是承诺**:真跑过一轮就删一条,
发现新的坑就加一条。不要让它变成一句套话。
