// 验收结论对账 —— 从 template-gates.mjs 里拆出来的第二个契约模块。
//
// 为什么拆:template-gates.mjs 的头注释写着「模板契约规则会越长越多」,而它是 200 行硬闸。
// 模板契约(结构/枚举/占位)和验收语义(正文判定 vs frontmatter status)是两回事:
//   template-gates  —— 工件长什么样
//   verification-gates —— 工件说的话可不可信
// 混在一起第一个就会顶破上限,所以拆。
//
// 为什么必须有:模板把「人工项非空时禁止 passed」写成了散文纪律,而机器只查 status 合法性。
// 实测过的假绿灯:正文 6 条 truth 里 4 条 ✗ FAILED、1 条 ? UNCERTAIN、人工区非空,
// frontmatter 写 status: passed / score: 6/6 —— gsd-state-check.mjs EXIT=0,phase 判完成。
//
// 本模块第一版有个更隐蔽的洞(2026-10-20 修):判定词表是封闭的,**认不出的写法整行丢弃**,
// 而 T-08 兜底只在「一行都没解析出来」时生效 —— 于是「一行能解析、其余全部漏掉」
// 反而静默放行。实测 ❌ FAILED / ✖ FAILED / 裸 FAILED 全部漏过。更糟的是人工区小节正则
// 要求裸标题,而模板写的是 `## Human Verification Required(机器验不了,恒发不省略)` ——
// **模板与闸互不兼容,这条纪律在任何照模板写的报告上都不生效。**
// 教训:验证闸的输入必须来自闸作者自己的模板之外。用自己产出的文档验证自己写的解析器,
// 等于没验证 —— 模板和闸会一起错,谁也发现不了。

// 符号集放宽到 emoji —— agent 输出里 emoji 判定极其常见,模板不该是唯一合法写法。
const VERDICT_RE = [
  ["VERIFIED", /^[✓✔✅]\s*VERIFIED/i],
  ["FAILED", /^[✗✘❌❎]\s*FAILED/i],
  ["UNVERIFIED", /^⚠️?\s*PRESENT_BEHAVIOR_UNVERIFIED/i],
  ["UNCERTAIN", /^[?？❓❔]\s*UNCERTAIN/i],
];
// 指纹:这一格在谈「验证 / 失败」这件事,却没被精确 token 认下 → 写法跑偏,算 UNKNOWN。
// 比精确 token 松、比任意散文紧:Artifacts 表第 3 格的 `✓` 或 `212 行` 不含这些词,不会误伤。
const VERDICT_FINGERPRINT = /\b(VERIFIED|FAILED|UNCERTAIN|UNVERIFIED)\b/i;

/** 统计 Observable Truths 表的判定列。取第 3 格而非全行正则 —— 证据列里可能合法出现 FAILED 字样 */
function truthVerdicts(text) {
  const c = { VERIFIED: 0, FAILED: 0, UNVERIFIED: 0, UNCERTAIN: 0, UNKNOWN: 0 };
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cell = t.split("|").slice(1, -1).map((s) => s.trim())[2] ?? "";
    if (/^(状态|status|verdict)$/i.test(cell) || /^:?-{2,}:?$/.test(cell)) continue;
    let hit = false;
    for (const [k, re] of VERDICT_RE) if (re.test(cell)) { c[k]++; hit = true; break; }
    if (!hit && VERDICT_FINGERPRINT.test(cell)) c.UNKNOWN++;
  }
  return c;
}

/**
 * 人工验证小节里有几条真实条目(剔掉 <> 占位后仍有实质内容)。
 * 标题正则必须容得下模板自己写的括号后缀,否则这条纪律等于不存在。
 *
 * `(?!\*\*)` 是为了把**粗体段落**排除在清单之外:`*` 既是列表标记也是粗体标记,
 * 于是 `**结论**:……` 会被当成一条人工项 —— 而任何以粗体结论收尾的 passed 报告
 * 都会被误判成「有人工项」,被迫降级成 human_needed。只排除 `**` 开头的那种,
 * `* 条目` / `- [ ] 条目` 照旧认(松手就会把真人工项漏成假绿,T-03)。
 */
function humanItems(text) {
  const m = text.match(/^#{2,4}\s*[^\n]*\b(Human\s+Verification|人工验证|人工确认)\b[^\n]*$/im);
  if (!m) return 0;
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/\n#{2,4}\s/);
  return (next < 0 ? rest : rest.slice(0, next))
    .split(/\r?\n/)
    .filter((l) => /^\s*(?!\*\*)[-*]\s*(?:\[[ xX]?\])?\s*\S/.test(l) && l.replace(/<[^>]*>/g, "").replace(/[\s:：—。，,]/g, "").length >= 4)
    .length;
}

const scoreOf = (text) => {
  const m = text.match(/^score:\s*(\d+)\s*\/\s*(\d+)/m);
  return m ? { n: +m[1], d: +m[2] } : null;
};

/**
 * 验收结论一致性闸。只在 status 是 passed 时逐条对账 —— gaps_found / human_needed
 * 本来就承认有没验过的部分,拿它们去要求「全绿」是逼人把缺口藏起来。
 * 返回 [{message, fix, level}] —— level 为 "warn" 的不拦人。
 */
export function validateVerification(text, status) {
  const out = [];
  const add = (m, fix, level = "err") => out.push({ message: m, fix, level });
  const c = truthVerdicts(text);
  const parsed = c.VERIFIED + c.FAILED + c.UNVERIFIED + c.UNCERTAIN;
  const total = parsed + c.UNKNOWN;

  if (status !== "passed") {
    if (status === "gaps_found" && !c.FAILED)
      add("声明 gaps_found 但正文找不到 ✗ FAILED 条目", "缺口要落到具体 truth;缺口只在工件层就在 Artifacts 表里标出来", "warn");
    return out;
  }
  // 一条判定都读不出来 = 格式跑偏或解析器失效。T-08:门禁读不到输入却放行,比误红危险得多。
  if (!total)
    return [{ message: "status=passed 但一条 truth 判定都解析不出", fix: "按模板写 Observable Truths 表,判定列用 ✓ VERIFIED / ✗ FAILED / ⚠ PRESENT_BEHAVIOR_UNVERIFIED / ? UNCERTAIN", level: "err" }];
  // 有行却认不出写法 —— 上一版把这种行整行丢弃,导致「一行能解析、其余全漏」反而静默放行。
  // 写法跑偏等于这条 truth 根本没被验过,不能算进 VERIFIED,更不能被 passed 盖过去。
  if (c.UNKNOWN)
    add(`判定列有 ${c.UNKNOWN} 行写法不认,却写 status: passed`, "判定列只用 ✓/✗/⚠/? 四种写法(emoji 变体也认);认不出的写法等于这条 truth 没被验过");
  if (c.FAILED)
    add(`正文有 ${c.FAILED} 条 ✗ FAILED,却写 status: passed`, "有 FAILED 就是 gaps_found —— passed 要求每条 truth 都有行为证据");
  if (c.UNVERIFIED)
    add(`正文有 ${c.UNVERIFIED} 条 ⚠ PRESENT_BEHAVIOR_UNVERIFIED,却写 status: passed`, "这类没被任何测试真的触发过状态转移/清理/顺序,不算 verified 分数,只能 human_needed");
  if (c.UNCERTAIN)
    add(`正文有 ${c.UNCERTAIN} 条 ? UNCERTAIN,却写 status: passed`, "拿不到证据就如实 human_needed,别用 passed 盖过去");
  if (humanItems(text))
    add("Human Verification Required 里有真实条目,却写 status: passed", "人工项非空时只能 human_needed;确实没有人工项就写 None 并说明全部由程序验证");
  const s = scoreOf(text);
  if (s && c.VERIFIED < s.n)
    add(`score 写 ${s.n}/${s.d},正文只有 ${c.VERIFIED} 条 ✓ VERIFIED`, "score 是 VERIFIED 条数 / 总数,按正文实测写,不手填", "warn");
  // 分母对账:真通过报告的 score 分母应等于正文判定行数。不对账等于「少写几条 truth」零成本。
  if (s && total && s.d !== total)
    add(`score 分母写 ${s.d},正文只有 ${total} 行判定`, "score 是 VERIFIED 数 / 总数,总数就是正文的判定行数 —— 少写几条 truth 不会让验收更真", "warn");
  return out;
}

/* ================= 计划的可信度:票站在什么前提上(phase 09 D-07) =================
 *
 * 为什么放这里:本模块管「工件说的话可不可信」—— 验收结论件说「做到了」,要问可不可信;
 * 计划说「要改这个文件、这条验证跑得起来」,同样要问可不可信。票站在假前提上,
 * 执行端要么卡住反复找,要么自己编 —— 那就是「任务有幻觉,agent 在空转」。
 *
 * 只取工件事实(路径在不在、条数多少、REQ 认不认得),不猜作者是不是故意的。
 * 判不出就判不出:REQUIREMENTS.md 不存在 → 需求反核销跳过,不猜。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { splitCommands } from "./worktree-view.mjs";

/**
 * 前提存在性:票里引用的路径,要么真实存在,要么是这张票自己要产出的。
 *
 * 例外(原版 `verify-command-path-resolvability.md:38` 的 pending_creation):票的 `files`
 * 里列着的路径是**它自己会产出的**,不判 —— 判了就等于逼人先造文件再写票。
 */
export function checkTicketPremises(tickets, root) {
  const problems = [];
  const PATHY = /[\w./\-]+\.(?:mjs|cjs|js|ts|mts|cts|jsx|tsx|json|md|ya?ml|py|sh|html|css)\b/g;
  for (const t of tickets) {
    const own = new Set((t.files ?? []).map((f) => String(f).replace(/^\.\//, "")));
    const seen = new Set();
    const missing = (p) => {
      const rel = String(p).replace(/^\.\//, "");
      if (own.has(rel) || seen.has(rel)) return;      // 这票自己产出 / 重复引用
      seen.add(rel);
      if (!existsSync(join(root, rel))) problems.push(`${t.id}: 引用的 "${rel}" 不存在 —— 票站在一个假前提上,执行者会照着编或反复找`);
    };
    for (const p of t.readFirst ?? []) missing(p);
    for (const c of splitCommands(String(t.verify ?? ""))) for (const m of c.matchAll(PATHY)) missing(m[0]);
  }
  return problems;
}

/**
 * 载量:一张票的 `read_first` 不得超过 8 条。
 *
 * `read_first` 是执行前**要全部读完**的文件(exec 的纪律:任务列出的文件全部读完再写第一行)。
 * 8 个已经是全读完的量;再多,执行者要么读不完就动手(后面全靠猜),要么上下文被吃光。
 * 原版的对应阈值是「单任务 >10 文件 → 阻断」(`gsd-plan-checker.md:326-330`);
 * mm-gsd 这里按 read_first 单独计,因为它是执行端的**必读**清单。
 */
export function checkTicketLoad(tickets) {
  const problems = [];
  for (const t of tickets) {
    const n = (t.readFirst ?? []).length;
    if (n > 8) problems.push(`${t.id}: read_first 有 ${n} 条(>8) —— 一个子代理读不完这一张票;砍掉真理来源文件或拆票`);
  }
  return problems;
}

/**
 * 需求反核销:票 `covers` 里认领的 REQ 必须在 REQUIREMENTS.md 里真实存在。
 *
 * 只判**反**方向(凭空认领)。正方向(每条需求都要有票)要先给 REQUIREMENTS.md 定格式
 * —— 它现在没有模板也没有格式约定,那是另一件事。文件不存在 → 判不了,不猜。
 */
export function checkReqClaims(tickets, root) {
  const reqFile = join(root, ".planning", "REQUIREMENTS.md");
  if (!existsSync(reqFile)) return [];
  const known = new Set([...readFileSync(reqFile, "utf8").matchAll(/REQ-\d+/gi)].map((m) => m[0].toUpperCase()));
  const problems = [];
  for (const t of tickets) {
    for (const r of t.covers ?? []) {
      if (!/^REQ-/i.test(r)) continue;
      if (!known.has(r.toUpperCase())) problems.push(`${t.id}: covers 认领了 "${r}",但 REQUIREMENTS.md 里没有这条需求 —— 凭空认领`);
    }
  }
  return problems;
}
