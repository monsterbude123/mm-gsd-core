---
name: "mm-gsd-board"
description: "过程看板:需求与 phase 的运营管理界面(可选包,核心五步环不依赖它)"
entry: scripts/mm-gsd-web.mjs
optional: true
display: 看板
aliases: [web]
---

# 过程看板(可选包)

**它是什么**:需求与 phase 的运营管理界面 —— 看板总览、REQ 依赖网、批注落盘。它服务于「看与管」,不是核心五步环的一环。

**它是可选包**:核心五步环不依赖它 —— 删掉这个目录,核心照常跑(discuss/plan/exec/verify/ship 一字不差)。核心与看板之间只留 `annotations.json` 这一个纯数据契约:看板写批注,discuss/plan 开头消化。

**怎么起**:`mm-gsd board` 或 `mm-gsd web`(两个命令名都落到本包入口),只绑 127.0.0.1 回环地址,`--port` 可换端口。

## 完成后

回到 mm-gsd-discuss 消化批注 —— 看板落盘的批注(status=open)由 discuss/plan 开头按 type 消化,消化后回填 digested;看板自己不消化批注,也不产生交付物。
