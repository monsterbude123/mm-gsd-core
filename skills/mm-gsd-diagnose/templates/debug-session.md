---
slug: 一句话症状转-kebab-case
trigger: 怎么发现的(门禁红了 / 测试挂了 / 行为不对)
status: diagnosing
updated: 2026-10-19
---

# 诊断会话 · 一句话症状

## 复现

<!-- 照着跑就能复现的命令或步骤。这段不能空 —— 复现不出来说明还没定位到现象,
     不是已经找到了原因。门禁判空即红。 -->

<照着跑就能复现的命令或步骤>

## Current Focus

- hypothesis: <可证伪的猜测:我认为是 X 导致的>
- test: <验证这个猜测的具体动作>
- expecting: <如果猜测成立会看到什么>
- next_action: <下一步做什么>

## Evidence

<!-- 每条带 ISO 时间戳,写「观察到什么 / 实测值是什么」。尖括号占位不算证据,
     门禁只认真填的时间戳行。 -->
- <ISO 时间戳> <观察到什么、实测值>

## Resolution

- root_cause: <一句话根因;写不出就说明还没诊断完>
- fix: <怎么修的;--diagnose 阶段留空>
- verification: <怎么验的;「看起来好了」不算>
- files_changed: <改了哪些文件>

<!-- status 只有五个合法值,一次只写一个:
     diagnosing 诊断中 / diagnosed 根因已定待修 / fixing 修复中 / resolved 已修复 / abandoned 放弃
     写成 "diagnosing | diagnosed" 是错的 —— 那是选项说明不是值,门禁会判非法。

     --diagnose 只填到 root_cause 为止,status 停在 diagnosed,不碰 fix 与 files_changed。
     要往下走必须先跑门禁确认复现与证据都在:
       node ~/.agents/skills/mm-gsd-diagnose/scripts/diagnose-check.mjs <slug>
     门禁转绿才允许调 mm-gsd-plan 出修复 PLAN —— 见 SKILL.md「诊断转修复」节。 -->
