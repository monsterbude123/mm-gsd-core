# 参考系对照表 —— 概念模糊时去 GSD Core 查

> **为什么有这张表**:mm-gsd 是 GSD Core 的极简蒸馏版(284 源文件 → 25 文件)。
> 蒸馏必然丢东西,而**丢掉的往往是「为什么这么设计」**——
> mm-gsd 的 `docs/theory.md` 记了规律(T-01..T-14),但没有记「哪些做法被否掉了、代价是什么」。
>
> 后果是:遇到模糊概念时,agent 只能凭印象造一个做法,而 GSD 那边可能早就踩过这个坑。
> 这张表把「mm-gsd 的某个概念」映射到「GSD Core 里对应的实现与决策记录」,
> 让「去参考」从一个需要判断力的动作变成一次查表。
>
> **怎么用**:概念模糊 → 在下面的表里查 mm-gsd 的概念 → 打开对应的 GSD 文件读 →
> 结论落进本次的 CONTEXT 或 PR 描述。**不要凭印象填。**
>
> **GSD Core 路径**:`D:\workspace\gsd-monster\gsd-core`(本机参考系,不在本仓内)

---

## 一、决策显性化(核销 / 可逆性 / 覆盖)

| mm-gsd 概念 | GSD Core 对应 | 看什么 |
|---|---|---|
| `checkCoverage` 核销(决策必须被 PLAN 引用) | `src/gate-decision-coverage-plan.cts` | 门禁怎么判「决策被覆盖」 |
| 核销的**三态**:parsed / none-present / could-not-parse | `src/decision-coverage-support.cjs` + `gate-decision-coverage-plan.cts:115-140` | **partial-parse 必须独立阻断**;`could-not-parse` 时 `total`/`covered` 置 `null`(不装作 0)、`uncovered` 整个省略、单独带出解析失败的 ID |
| 决策的解析与编号 | `src/decisions.cts`(713 行) | D-NN 的完整语法与边界情况 |
| 决策覆盖的 verify 侧 | `src/gate-decision-coverage-verify.cts` | 验收侧也要覆盖决策 |

**已知差距**:mm-gsd 的 `checkCoverage` 只做 `ctxIds ⊆ planDecisions` 单向,
**不查反向**(PLAN 引用的决策是否还在 CONTEXT 里),也不区分「没提到」与「提到但格式坏」。

---

## 二、状态与判定(owner 唯一性)

| mm-gsd 概念 | GSD Core 对应 | 看什么 |
|---|---|---|
| 状态推导(STATE 声明 vs 工件推导) | `src/state-contract.cts` + `src/verification.cts` | 状态词表在哪一处定义;`isPhaseComplete` / `readVerificationStatus` 各自负责什么 |
| **一个判定只能有一个 owner** | `docs/adr/5057-one-owner-per-workflow-verdict.md`(289 行) | **本表最该读的一份**。它记录了同一个判定在 4 处被推导、词表互不一致的完整事故 |
| 判定词表(封闭枚举) | `src/gate-verdict.cts` | verdict 类型与退出码的推导 |
| 证据三态(found / none / could-not-read) | `src/gate-evidence.cts` | **空文件 ≠ 文件不存在 ≠ 读不到** —— 三者必须分开 |

**已知差距**:mm-gsd 没有「一个 owner」的概念,状态词表在检查器里散落多处。

---

## 三、漂移与陈旧

| mm-gsd 概念 | GSD Core 对应 | 看什么 |
|---|---|---|
| `checkDrift` 上下文漂移 | `src/gate-context-drift.cts` + `src/drift.cts` | 漂移的判定方向、`<` 与 `>` 的严格性约定 |
| 代码漂移(工件与代码不同步) | `src/gate-codebase-drift.cts` | 与上下文漂移的分工 |
| 结构漂移 | `src/gate-schema-drift.cts` | |
| 验收报告陈旧(绑代码指纹) | GSD 的 `covered_digest` 机制 | **mm-gsd 明确不做**,理由见 `docs/theory.md`「明确排除的做法」 |

---

## 四、禁止项与失败方向

| mm-gsd 概念 | GSD Core 对应 | 看什么 |
|---|---|---|
| 「明确不做」怎么强制 | `src/gate-prohibition-enforcement.cts` | 禁止项怎么从声明变成可判的门 |
| 谓词式判定(`check.predicate`) | `src/gate-predicate.cts` + `src/gate-predicate-evaluator.cts` | 声明式谓词怎么被真正求值 |
| 验证必须有失败方向 | `src/gate-verify-failure-directions.cts` | 「永远为真」的判定怎么被拦 |
| 验证命令的路径可解析 | `src/gate-verify-command-paths.cts` | |

---

## 五、研究与深化(D-03 的上游)

| mm-gsd 概念 | GSD Core 对应 | 看什么 |
|---|---|---|
| 研究阶段的产物与存储 | `src/research-provider.cts` + `src/research-store.cts` | 研究怎么落盘、怎么被后续阶段引用 |
| 研究者角色卡 | `agents/gsd-advisor-researcher.md`、`agents/gsd-ai-researcher.md`、`agents/gsd-domain-researcher.md`、`agents/gsd-assumptions-analyzer.md` | 研究的分工与产出形态 |
| 假设分析 | `agents/gsd-assumptions-analyzer.md` | **mm-gsd 完全缺这一类** —— 显式列出「我假设了什么」 |

---

## 六、评估范围(哪些文件被门禁覆盖)

| mm-gsd 概念 | GSD Core 对应 | 看什么 |
|---|---|---|
| 门禁的评估范围 | `src/gate-evaluation-scope.cts`(609 行) | **「这次门禁看的是哪些 commit、哪些文件」的单一答案**。GSD 之前每个消费方自己推导(`HEAD~1..HEAD`、`DIFF_BASE..HEAD`、`git log --all --grep`),互相不一致 |
| TDD 红阶段证据 | `src/gate-tdd-red-evidence.cts` | 红阶段的记录怎么持久化才算数 |

---

## 七、治理与决策记录

| mm-gsd 概念 | GSD Core 对应 | 看什么 |
|---|---|---|
| ADR(架构决策记录) | `docs/adr/`(100 份) | mm-gsd 的 `docs/theory.md` 记规律,GSD 的 ADR 记**决策及其被否掉的替代方案** |
| 「明确排除的做法」怎么写 | `docs/adr/5057-*.md` 的 Context 段 | 记录一个决定时,要把「哪些做法被否掉了、为什么」一起写 |
| 门禁的架构锁定 | `docs/adr/5057-*.md` | 一个 owner、一个封闭词表、一个 positive control |

---

## 八、TDD 与门禁自证

| mm-gsd 概念 | GSD Core 对应 | 看什么 |
|---|---|---|
| 门禁自己必须先证明会红 | `src/gate-tdd-red-evidence.cts` + `docs/eslint-rules/` | GSD 用 ESLint 规则强制「没有红用例的门禁模块不许合并」 |
| 变异测试 | `TESTING-STANDARDS.md` | GSD 对「门禁自己的质量」的测试标准 |
| 测试样例 | `TEST-EXAMPLES.md` | |

---

## 使用纪律

1. **查表,不要凭印象**。表里没有的概念才去 GSD 那边翻目录,翻到之后**补进这张表**。
2. **参考的结论要落盘**,进 CONTEXT 的决策或 PR 描述。没落盘的参考等于没参考。
3. **不是照抄**。GSD 的规模是 mm-gsd 的十倍以上,它的很多机制(多 phase 状态机、UI 门禁、
   多 provider 集成)在 mm-gsd 里没有对应场景。参考的是**判据与理由**,不是实现。
4. **发现差距要记**。上表的「已知差距」是活的,每发现一条新的就补进去 ——
   这张表的价值一半在于它记着 mm-gsd 缺什么。
5. **GSD Core 不在版本库里**。这张表是本机参考系,换机器要重新核路径。
   `tools/mmc.mjs` 有一条门禁核对表里引用的文件是否还在(见 `check-reference-map`)。
