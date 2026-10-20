# CONTEXT.md 模板(phase 的决策真相源,写一次,后续只追加不重写)

```markdown
**Gathered:** <日期>
**Status:** Ready for planning

<domain>
本 phase 的领域边界:做什么、不做什么。类别从本 phase 实际讨论中涌现
(CLI phase 有 CLI 节、UI phase 有 UI 节),不用预定义模板。
</domain>

<decisions>
锁定的实现决策,每条编号 D-NN,phase 内唯一。规则:
- 只放用户在意且有多个合理答案的决策(灰区);技术路线由 agent 定,不进这里
- 好决策 = 具体("卡片式布局,不用时间线");坏决策 = 模糊词("现代简洁")
- 下游 plan 每条 D-NN 必须被任务引用;矛盾 → 停下问人
- **每条必须标可逆性**:`reversible` / `costly` / `one-way`。没说清可逆性的决策不算被决策过
- 标 `one-way` 的必须举证:指名 migration、已发布契约或外部依赖系统。「这个很难改」不算举证

- [D-01] reversible — 认证用 JWT + 刷新令牌轮换,不用 session
- [D-02] one-way — 列表用卡片式布局,不用时间线。撤销需要 migration 03-02 把既有时间线页改写
</decisions>

<specifics>
具体引用:文档/spec/ADR 链接(canonical refs)。用户在讨论中引用的任何文档立即记入。
无外部 spec 时显式写 "No external specs",不许静默省略。
</specifics>

<deferred>
范围蔓延与"以后再说":不丢失、不实施。规划时禁止实现这里的条目。
- 记录:导出 CSV 功能(用户 2026-10-13 提出,独立 phase 处理)
</deferred>
```

维护规则:
- discuss 阶段产出;planning 前冻结;执行中只读。
- 每 phase 一个新的 CONTEXT(决策编号 phase 内唯一);跨 phase 通用的决策升进项目级文档。
