---
name: mm-gsd-diagnose
description: "极简 GSD 诊断:异常 → 假设 → 证据 → 根因 → 修复 PLAN。诊断与修复分离,--diagnose 只出根因报告不改动代码,会话落盘支持跨上下文续做,没复现没证据不许转修复。"
argument-hint: "[--diagnose] [list | status <slug> | continue <slug>] <症状一句话>"
---

# MM-GSD 诊断

**什么时候调它**:门禁红了但你确认输入没错 / 测试挂了但不知道从哪挂 / 行为和文档说的不一样 /
指令自相矛盾要你自己挑一个执行 / 模板照抄不改动却判非法。
这些**不是你的项目的问题,是待定位的异常** —— 走这条,别绕过去也别直接开修。

**为什么不直接让 exec 修**:exec 的边界写着「只自动修本任务变更直接引发的问题,
既有问题记 deferred 不顺手修」。这条本身是对的(防执行期范围蔓延),但它合起来让
**接手时就已经坏的**问题没有任何合法出口。本技能就是那个出口。

## 诊断与修复分离

| 模式 | 命令 | 做什么 |
|---|---|---|
| **只诊断** | `mm-gsd-diagnose --diagnose "<症状>"` | 产出根因报告,**不改一行代码** |
| 诊断并修 | `mm-gsd-diagnose "<症状>"` | 诊断完直接进修复回路 |

先跑 `--diagnose`。理由不是流程仪式:**改代码会污染现象**。你在怀疑正则判错的时候
顺手改了那个正则,证据就没了 —— 而「我以为是这里的问题」本身是不可靠的。

## 会话落盘(跨上下文续做)

诊断经常跨好几次会话。落在 `.planning/debug/<slug>.md`,不 commit(属本地工件)。

```bash
node ~/.agents/skills/mm-gsd-diagnose/scripts/diagnose-check.mjs --list           # 列活跃会话
node ~/.agents/skills/mm-gsd-diagnose/scripts/diagnose-check.mjs --status <slug>  # 看进度,不恢复
node ~/.agents/skills/mm-gsd-diagnose/scripts/diagnose-check.mjs <slug>          # 校验能不能往下走
```

slug 由症状转 kebab-case,≤30 字符,只含 `a-z0-9-` —— 它会变成文件名,不消毒就是路径穿越入口。
模板:`skills/mm-gsd-diagnose/templates/debug-session.md`。

## 假设环(不是"想到什么改什么")

每次只推进**一个**假设,记下三件事:

- **hypothesis** —— 可证伪的猜测(「我认为是 X 导致的」)
- **test** —— 验证它的一个具体动作
- **expecting** —— 猜对了会看到什么

**expecting 是关键**。先写下「猜对了会看到什么」,再去跑 —— 否则看到结果之后你总能
为它编出解释。「蒙对和正确在观测上无法区分」(T-07)。

Evidence 每条带 ISO 时间戳,写**观察到什么 + 实测值**。「感觉是这样」不算证据。
假设被推翻也**记一条 evidence** —— 排除了什么和找到了什么一样值钱。

## 诊断转修复

1. `status` 改 `diagnosed`,`root_cause` 填一句话
2. **跑门禁**,它拦的是「没定位到现象就开修」:

   ```bash
   node ~/.agents/skills/mm-gsd-diagnose/scripts/diagnose-check.mjs <slug>
   ```

   报红就照它每条后面的 `→` 改 —— 复现段空、假设环缺字段、证据为零条,任一都会红。
3. 门禁转绿才调 `mm-gsd-plan` 出修复 PLAN。PLAN 的 `files_modified` 就是 root_cause
   指向的地方;`verify` 写成能证伪 root_cause 的命令。
4. **PLAN 里要写明它来自哪个诊断会话**(`depends_on` 或任务里注明 slug)。
   这条同时解开 exec 的边界:有了它,「既有问题」在本次执行里就变成
   「本任务变更直接引发」,exec 才认这笔修复。

## 执行者失效模式(你会怎么偷懒,逐条自查)

1. **跳过假设环直接改** —— 改完发现不对,再改,连打三轮,根因从没被确认过。
2. **expecting 事后补** —— 先看结果再编解释。顺序反了这条环就白设了。
3. **证据写成结论** —— 「确实是正则的问题」不是证据,「admin.css 实测返回 true」才是。
4. **根因写得太宽** —— 「正则有问题」不可修;「VAGUE_FILE 的 N/A 缺左右断言」可修。
5. **诊断期间改代码** —— 现象被污染,证据作废,只能从头来。
6. **拿到根因就散会** —— 门禁没跑就进 plan,复现和证据其实还缺着。

## 与其他技能的关系

诊断产出的根因进 `mm-gsd-plan`;PLAN 转 `mm-gsd-exec`;`mm-gsd-verify` 验的是
「PLAN 说修好了」与「root_cause 真的消失了」两件事。**诊断不产出交付物** ——
它的交付物是根因,根因被修掉后由正常的 plan→exec→verify→ship 承接交付。
