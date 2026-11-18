// plan-review-gate —— 14 族机器门(判据权威;--plan 的接线段只做注入与转发,改判据来这里)。
// 来源:研究台 src/gate.mjs 逐函数移植(phase 28-10),每个 detector 都溯源到 phase 28 预审里
// 人报的一条 BLOCKER;F16 溯源 GitHub #24;F6 字节上限溯源总纲 §9.1(行数门对单行巨串失明)。
// 纯函数:除调用方注入的基线快照外无仓库 I/O。ctx = { contextText, reqText, baseline: Map, planId }。
// 口径三件事必须与冻结基准一致(28-REMEDIATION §2.4):
//   1) per-ticket 基线由调用方按 git 票号锚点解析(锚点缺失 ⇒ 空 Map ⇒ 基线族跳过,绝不回落 HEAD);
//   2) verify/action 是多行取值(标签行 + 懒续行);
//   3) 票面写明「本 PLAN 写于实现之后」时,F2/F5 整体跳过(票据形态的必然,不是 tautology)。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const CODE_PATH = /\.(?:mjs|cjs|js|ts|mts|json|md|ya?ml|html|css|txt)$/;
// A repo-level command already covers every deliverable, so it is not evidence of a blind verify.
// selftest 同理:跑 selftest 的 verify 传递性读了它覆盖的交付文件(F9 同享此豁免)。
const RUNNER = /--selfcheck|gsd-state-check|mmc(\.mjs)?\s+(?:health|check)|mm-gsd(?=\s)|npm\s+(?:test|run)|gate-cases|tools\/mmc\.mjs|[\w./-]*selftest\.mjs/i;
const GENERIC = new Set([
  "function", "process", "console", "require", "string", "number", "object", "return",
  "const", "true", "false", "utf8", "reversible", "frontmatter",
  "references", "scripts", "skills", "templates", "planning", "description",
]);
// a path token inside the text (with an optional :line or :a-b suffix)
const PATH_TOKEN = /[\w./-]+\.(?:mjs|md|json|html|ya?ml|css|txt)(?::\d+(?:-\d+)?)?/g;

export function parsePlan(text) {
  const lines = text.split(/\r?\n/);
  const tasks = [];
  let cur = null;
  let label = null;
  // A verify/action block is a MULTI-LINE value: `node --input-type=module -e '` continues on
  // the next lines with no indentation. Taking only the label line would read the verify as
  // one word and miss every file it imports (26-07's verify imports its deliverable on line 2).
  const MULTILINE = new Set(["verify", "action"]);
  for (const line of lines) {
    const head = line.match(/^##\s+(T\d+)\b(.*)$/);
    if (head) {
      cur = { id: head[1], title: head[2].trim(), labels: {}, raw: [], order: tasks.length + 1 };
      tasks.push(cur);
      label = null;
      continue;
    }
    if (!cur) continue;
    cur.raw.push(line);
    const lab = line.match(/^-\s+\*\*([a-z_]+)\*\*:\s*(.*)$/);
    if (lab) {
      label = lab[1];
      cur.labels[label] = lab[2].trim();
      continue;
    }
    if (label && MULTILINE.has(label)) {
      cur.labels[label] += "\n" + line;
      continue;
    }
    if (label && /^\s{2,}\S/.test(line)) {
      cur.labels[label] += "\n" + line.trim();
      continue;
    }
    label = null;
  }
  return { lines, tasks };
}

const splitList = (s) =>
  String(s ?? "")
    .split(/[,，、]/)
    .map((x) => x.trim())
    .filter(Boolean);

// ---- F1: verify never touches the deliverable --------------------------------
function checkVerifyBlind(tasks, problems) {
  for (const t of tasks) {
    const files = splitList(t.labels.files);
    const verify = String(t.labels.verify ?? "");
    if (!files.length || !verify) continue;
    if (RUNNER.test(verify)) continue;
    const hit = files.some((f) => {
      const base = f.split("/").pop();
      // 词干匹配:本仓 verify 的规范写法是拼接构造路径("README" + MD),全文匹配必然失明 ——
      // 交付文件按不含扩展名的词干认(词干 ≥3 字符防 "x.mjs" 一类单字母误配);
      // 拼接跨引号的("gsd-state-" + "check")用去引号/加号/空白的归一化文本再认一遍
      const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
      const nVerify = verify.replace(/['"\s+]/g, "");
      return (
        verify.includes(f) ||
        (base && verify.includes(base)) ||
        (stem.length >= 3 && (verify.includes(stem) || nVerify.includes(stem)))
      );
    });
    if (!hit) {
      problems.push({
        family: "F1-verify-blind",
        severity: "blocker",
        msg: `${t.id}: verify 不引用本任务的任何交付文件(${files.join(", ")}) → 漏做也判绿`,
      });
    }
  }
}

// ---- F2/F5: literals that are already true (or already forbidden) in the baseline ----
function collectLiterals(verify) {
  const out = [];
  const push = (lit, direction) => {
    const v = String(lit ?? "").trim();
    if (v.length < 2 || v.length > 80) return;
    if (/[(){};=$,\\]/.test(v)) return;
    if (GENERIC.has(v.toLowerCase())) return;
    if (v.includes("/") && CODE_PATH.test(v)) return;
    out.push({ literal: v, direction });
  };
  // includes('X') — a leading ! means "must contain", otherwise "must not contain"
  for (const m of verify.matchAll(/(!?)\s*[\w.]*\.includes\(\s*['"]([^'"]{2,80})['"]\s*\)/g)) {
    push(m[2], m[1] === "!" ? "assert" : "ban");
  }
  // /X/.test(...) — a regex literal that must not match
  for (const m of verify.matchAll(/\/([^\/\n]{2,60})\/\.test\(/g)) push(m[1], "ban");
  for (const m of verify.matchAll(/\.match\(\s*\/([^\/\n]{2,60})\//g)) push(m[1], "assert");
  // === "X" / == "X" — must equal
  for (const m of verify.matchAll(/={2,3}\s*['"]([^'"]{2,80})['"]/g)) push(m[1], "assert");
  return out;
}

// The files a verify actually reads. A literal can only be "already true" relative to the
// file the assertion compares against — not to every file the ticket touches.
function filesReadByVerify(verify) {
  const out = new Set();
  for (const m of verify.matchAll(/readFileSync\(\s*['"]([^'"]+)['"]/g)) out.add(m[1]);
  for (const m of verify.matchAll(/readFileSync\([^)]*?['"]([^'"]+)['"]/g)) out.add(m[1]);
  for (const m of verify.matchAll(/import\(\s*['"]\.\/([^'"]+)['"]/g)) out.add(m[1]);
  for (const m of verify.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) out.add(m[1]);
  for (const m of verify.matchAll(/openSync\(\s*['"]([^'"]+)['"]/g)) out.add(m[1]);
  return out;
}

function checkBaselineLiterals(tasks, ctx, problems) {
  // A ticket may declare that it was written AFTER the implementation existed ("本 PLAN 写于
  // 实现之后"). For such a ticket "the asserted literal already exists" is the expected state,
  // not a tautology: judge those tickets on shape, not on baseline content.
  const retroactive = /写于实现之后|实现已存在|retroactive/i.test(ctx.planText ?? "");
  if (retroactive) return;
  for (const t of tasks) {
    const verify = String(t.labels.verify ?? "");
    if (!verify) continue;
    const scope = filesReadByVerify(verify);
    if (!scope.size) continue; // the verify compares against something we cannot see — do not guess
    for (const { literal, direction } of collectLiterals(verify)) {
      for (const rel of scope) {
        const text = ctx.baseline.get(rel);
        if (!text) continue;
        if (!text.includes(literal)) continue;
        if (direction === "assert") {
          problems.push({
            family: "F2-tautology",
            severity: "blocker",
            msg: `${t.id}: verify 断言的字面量 «${literal}» 在它读取的基线 ${rel} 里已经存在 → 改动没发生也判绿`,
          });
        } else {
          problems.push({
            family: "F5-baseline-conflict",
            severity: "blocker",
            msg: `${t.id}: verify 禁止的字面量 «${literal}» 在它读取的基线 ${rel} 里已经存在 → 照做也永远红`,
          });
        }
        break;
      }
    }
  }
}

// ---- F3: a covered decision/requirement has no landing in this ticket (advisory) ----
function harvest(text) {
  const paths = new Set();
  for (const m of text.matchAll(PATH_TOKEN)) paths.add(m[0].replace(/:\d+(?:-\d+)?$/, ""));
  const stripped = text.replace(PATH_TOKEN, " ");
  const ids = new Set();
  for (const m of stripped.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{7,})\b/g)) ids.add(m[1]);
  const scalars = new Set();
  for (const m of stripped.matchAll(/`([^`\n]{2,60})`/g)) {
    const v = m[1].trim();
    if (/[(){};=]/.test(v)) continue;
    scalars.add(v);
  }
  return {
    paths: [...paths],
    ids: [...ids].filter((k) => !GENERIC.has(k.toLowerCase())),
    scalars: [...scalars],
  };
}

function decisionKeywords(ctx, id) {
  const text = ctx.contextText ?? "";
  const idx = text.search(new RegExp(`^###\\s*\\[${id}\\]`, "m"));
  if (idx < 0) return null;
  const rest = text.slice(idx);
  const end = rest.slice(1).search(/^###\s/m);
  const block = end < 0 ? rest : rest.slice(0, end + 1);
  return harvest(block);
}

function requirementKeywords(ctx, id) {
  const text = ctx.reqText ?? "";
  const idx = text.search(new RegExp(`^-\\s*${id}\\b`, "m"));
  if (idx < 0) return null;
  const end = text.slice(idx).slice(1).search(/^-\s*REQ-/m);
  const block = end < 0 ? text.slice(idx) : text.slice(idx, idx + end + 1);
  return harvest(block);
}

function hasLanding(delivery, kw) {
  if (!kw) return true;
  for (const p of kw.paths) {
    const base = p.split("/").pop();
    if (delivery.includes(p) || (base && delivery.includes(base))) return true;
  }
  for (const s of kw.scalars) if (delivery.includes(s)) return true;
  for (const i of kw.ids) if (delivery.includes(i)) return true;
  return false;
}

// "Does this ticket really deliver the decision it claims?" is a judgement question, not a
// text-match question. Measured on the 41 tickets humans accepted, a keyword-overlap rule
// misfires on ~35 of them — a gate that is always red is not a gate. Advisory (reported, never blocking).
function checkCoversOrphan(tasks, ctx, problems) {
  for (const t of tasks) {
    const covers = String(t.labels.covers ?? "");
    if (!covers || /无|none/i.test(covers)) continue;
    const delivery = [t.labels.files ?? "", t.labels.action ?? "", t.labels.done ?? ""].join(" ");
    for (const m of covers.matchAll(/\b(D-\d+)\b/g)) {
      const kw = decisionKeywords(ctx, m[1]);
      if (!kw) continue;
      if (!hasLanding(delivery, kw)) {
        problems.push({
          family: "F3-covers-orphan",
          severity: "advisory",
          msg: `${t.id}: covers 认领的 ${m[1]} 在本票没有关键词落点（决策可能是散文表达 → 需人判断）`,
        });
      }
    }
    for (const m of covers.matchAll(/\b(REQ-\d+)\b/g)) {
      const kw = requirementKeywords(ctx, m[1]);
      if (!kw) continue;
      if (!hasLanding(delivery, kw)) {
        problems.push({
          family: "F3-covers-orphan",
          severity: "advisory",
          msg: `${t.id}: covers 认领的 ${m[1]} 在本票没有关键词落点（需求可能是散文表达 → 需人判断）`,
        });
      }
    }
  }
}

// ---- F4: cited line:anchor drifted away from the symbol the text names ----
function checkAnchorDrift(text, ctx, problems) {
  const citeRe = /([\w./-]+\.(?:mjs|md|json|html|ya?ml|css|txt)):(\d+)/g;
  for (const line of text.split(/\r?\n/)) {
    for (const m of line.matchAll(citeRe)) {
      const rel = m[1];
      const no = Number(m[2]);
      const base = ctx.baseline.get(rel);
      if (!base) continue;
      const baseLines = base.split(/\r?\n/);
      if (no > baseLines.length) {
        problems.push({
          family: "F4-anchor-drift",
          severity: "blocker",
          msg: `引用 ${rel}:${no} 超出文件行数(${baseLines.length})`,
        });
        continue;
      }
      // The identifiers that belong to THIS citation are the ones next to it, not the ones
      // further down the same (often very long) sentence.
      const at = m.index ?? 0;
      const around = line
        .slice(Math.max(0, at - 30), at + m[0].length + 80)
        .replace(/[\w./-]+\.(?:mjs|md|json|html|ya?ml|css|txt)/g, " ");
      const ids = [...around.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{3,})\b/g)]
        .map((x) => x[1])
        .filter((x) => !GENERIC.has(x.toLowerCase()));
      if (!ids.length) continue;
      const window = baseLines.slice(Math.max(0, no - 4), no + 3).join("\n");
      if (!ids.some((id) => window.includes(id))) {
        problems.push({
          family: "F4-anchor-drift",
          severity: "blocker",
          msg: `引用 ${rel}:${no} 附近找不到 ${ids.slice(0, 3).join("/")} → 行号漂移`,
        });
      }
    }
  }
}

// ---- F6: ticket volume budget (行数 + 字节;字节门对单行巨串 verify 才有牙,§9.1) ----
export const BUDGET = { planLines: 120, verifyLines: 30, verifyBytes: 4000 };
// 决定 #1:门上线即拦新票;写于门落地前的存量票豁免(28-01..09),28-10 自身 verify 超字节是
// 实现夹具的必然,同样豁免 —— 收口后门不再看它们,豁免自动失效。不放宽阈值,只豁免票。
export const SIZE_EXEMPT = new Set([
  "28-01", "28-02", "28-03", "28-04", "28-05", "28-06", "28-07", "28-08", "28-09", "28-10",
]);

function checkBudget(text, tasks, problems, ctx = {}) {
  if (ctx.planId && SIZE_EXEMPT.has(ctx.planId)) return; // 决定 #1:票级豁免,阈值不动
  const bodyLines = text.split(/\r?\n/).filter((l) => l.trim()).length;
  if (bodyLines > BUDGET.planLines) {
    problems.push({
      family: "F6-budget",
      severity: "blocker",
      msg: `[TICKET-SIZE] 票据正文 ${bodyLines} 行 > 预算 ${BUDGET.planLines} 行`,
    });
  }
  for (const t of tasks) {
    const v = String(t.labels.verify ?? "");
    const n = v.split(/\r?\n/).filter((l) => l.trim()).length;
    if (n > BUDGET.verifyLines) {
      problems.push({
        family: "F6-budget",
        severity: "blocker",
        msg: `[TICKET-SIZE] ${t.id}: 验收脚本 ${n} 行 > 预算 ${BUDGET.verifyLines} 行`,
      });
    }
    const bytes = Buffer.byteLength(v, "utf8");
    if (bytes > BUDGET.verifyBytes) {
      problems.push({
        family: "F6-budget",
        severity: "blocker",
        msg: `[TICKET-SIZE] ${t.id}: 验收脚本 ${bytes} 字节 > 预算 ${BUDGET.verifyBytes} 字节(单行巨串也在射程内,§9.1)`,
      });
    }
  }
}

// ---- F8: the promise lands outside this ticket's own scope ---------------------
const PROMISE_VERBS = /(改成|改为|重写|替换|删掉|删除|修好|修改)/;
const COORDINATION = /^(\.planning\/|.*-CONTEXT\.md$|.*-RESEARCH\.md$|.*-SUMMARY\.md$|.*-SHIP\.md$|.*-VERIFICATION\.md$|.*-PLAN\.md$|.*-PLAN-CHECK\.md$|REQUIREMENTS\.md$|.*LEDGER\.md$|.*\.planning\/)/i;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function checkPromiseOutOfScope(tasks, problems) {
  for (const t of tasks) {
    const files = splitList(t.labels.files);
    const readFirst = splitList(t.labels.read_first);
    const scope = new Set([...files, ...readFirst].map((f) => f.replace(/:\d+(?:-\d+)?$/, "")));
    const bases = new Set([...scope].map((f) => f.split("/").pop()));
    const action = String(t.labels.action ?? "");
    if (!action) continue;
    for (const m of action.matchAll(PATH_TOKEN)) {
      const rel = m[0].replace(/:\d+(?:-\d+)?$/, "");
      const base = rel.split("/").pop();
      if (scope.has(rel) || bases.has(base)) continue;
      if (COORDINATION.test(rel)) continue;
      const asObject = new RegExp("(?:把|将|对)\\s*" + esc(rel)).test(action);
      const verbAdjacent = new RegExp(esc(rel) + "\\s*(?:改成|改为|重写|替换|删掉|删除|修好|修改)").test(action);
      if (!asObject && !verbAdjacent) continue;
      const at = action.indexOf(m[0]);
      const after = action.slice(at, at + m[0].length + 30);
      if (/新建|新增一个/.test(after)) continue;
      problems.push({
        family: "F8-promise-out-of-scope",
        severity: "blocker",
        msg: `${t.id}: action 承诺改 ${rel},但它不在本票 <files>/read_first 里 → 这条承诺落不了地`,
      });
    }
  }
}

// ---- F9: a fact asserted about the repo that no verification ever reads -------
const EXEC_CLAIM = /(会|跑到|会到|跑的是|跑过|由[^，。；]{0,24}(?:跑|执行)|由[^，。；]{0,24}产出)/;
const LOCATION_POINTER = /(所在行|所在处|那行|这一行|见文件|详见)/;
function checkClaimUnverified(tasks, problems) {
  for (const t of tasks) {
    const verify = String(t.labels.verify ?? "");
    if (!verify) continue;
    // RUNNER 豁免与 F1 同法理:verify 跑检查器/自测时,被点名文件被传递性地读了 ——
    // 「现状断言没人核」的前提不成立(存量票实测:8 条误报全部来自这一处)。
    if (RUNNER.test(verify)) continue;
    const scope = new Set(
      [...splitList(t.labels.files), ...splitList(t.labels.read_first)].map((f) => f.replace(/:\d+(?:-\d+)?$/, "")),
    );
    const bases = new Set([...scope].map((f) => f.split("/").pop()));
    const claimLines = [];
    let inClaim = false;
    for (const line of t.raw ?? []) {
      if (/^\-\s+\*\*现状对读点\*\*/.test(line)) {
        inClaim = true;
        continue;
      }
      if (/^\-\s+\*\*/.test(line)) {
        inClaim = false;
        continue;
      }
      if (inClaim && line.trim()) claimLines.push(line);
    }
    for (const line of claimLines) {
      if (LOCATION_POINTER.test(line)) continue;
      for (const m of line.matchAll(PATH_TOKEN)) {
        const rel = m[0].replace(/:\d+(?:-\d+)?$/, "");
        const base = rel.split("/").pop();
        if (verify.includes(rel) || verify.includes(base)) continue;
        // 本票 files/read_first 里的文件是定位器(执行者必读/必改),不是没人核的事实
        if (scope.has(rel) || bases.has(base)) continue;
        if (COORDINATION.test(rel)) continue;
        const at = line.indexOf(m[0]);
        const around = line.slice(Math.max(0, at - 40), at + m[0].length + 40);
        if (!EXEC_CLAIM.test(around)) continue;
        problems.push({
          family: "F9-claim-unverified",
          severity: "blocker",
          msg: `${t.id}: 现状断言提到 ${rel},但 verify 从不读它 → 这条事实没人核`,
        });
      }
    }
  }
}

// ---- F10: the verify is stricter than the source it cites ----------------------
const LIST_CONST = /\b(?:BANNED|SUBJECT|PATTERN|FORBIDDEN|RE)\b\s*=\s*\/([^\/\n]{4,140})\//g;
const branches = (lit) =>
  lit
    .split("|")
    .map((s) => s.replace(/\\[bdswW]/g, "").replace(/\\\\/g, "").replace(/[{}]/g, "").trim())
    .filter((s) => s.length >= 2 && /[A-Za-z一-鿿]/.test(s));
function checkVerifyVsCitedSource(tasks, ctx, problems) {
  for (const t of tasks) {
    const verify = String(t.labels.verify ?? "");
    const action = String(t.labels.action ?? "");
    const vRegex = [...verify.matchAll(/\/([^\/\n]{4,80})\/\.test\(/g)].map((m) => m[1]);
    if (!vRegex.length) continue;
    const vTokens = vRegex.flatMap(branches);
    if (!vTokens.length) continue;
    const cited = [...new Set([...action.matchAll(PATH_TOKEN)].map((m) => m[0].replace(/:\d+(?:-\d+)?$/, "")))];
    for (const rel of cited) {
      const src = ctx.baseline.get(rel);
      if (!src) continue;
      const sTokens = new Set([...src.matchAll(LIST_CONST)].flatMap((m) => branches(m[1])));
      if (!sTokens.size) continue;
      const extra = vTokens.filter((x) => !sTokens.has(x));
      if (!extra.length) continue;
      problems.push({
        family: "F10-verify-vs-cited-source",
        severity: "blocker",
        msg: `${t.id}: verify 的判据比它引用的 ${rel} 更严(${extra.slice(0, 3).join(", ")} 不在源里) → 照做也红`,
      });
      break;
    }
  }
}

// ---- F11: the red fixture lives inside the scope the ticket excludes ----------
function checkFixtureSelfcheck(tasks, problems) {
  for (const t of tasks) {
    const action = String(t.labels.action ?? "");
    const verify = String(t.labels.verify ?? "");
    const clauses = [...action.matchAll(/(?:排除|不扫|不包含|不含|不查|不涉及)[^。；;\n]{0,100}/g)].map((m) => m[0]);
    if (!clauses.length) continue;
    const vPaths = [...verify.matchAll(PATH_TOKEN)].map((m) => m[0].replace(/:\d+(?:-\d+)?$/, ""));
    for (const c of clauses) {
      const scopes = [...c.matchAll(/([\w.-]+(?:\/[\w.-]+)*)/g)]
        .map((m) => m[1])
        .filter((s) => s.includes("/") && !/^node\b/.test(s));
      for (const vp of vPaths) {
        if (scopes.some((s) => vp === s || vp.startsWith(s.replace(/\/$/, "") + "/"))) {
          problems.push({
            family: "F11-fixture-selfcheck",
            severity: "blocker",
            msg: `${t.id}: verify 的样例 ${vp} 落在 action 明确排除的范围(${c.slice(0, 40)}) → 红灯样例永远不触发`,
          });
          break;
        }
      }
    }
  }
}

// ---- F12: the verify hunts a name with the wrong case → the check can never fire --
function checkCaseMismatch(tasks, ctx, problems) {
  for (const t of tasks) {
    const verify = String(t.labels.verify ?? "");
    if (!verify) continue;
    const scope = filesReadByVerify(verify);
    if (!scope.size) continue;
    for (const m of verify.matchAll(/\/([^\/\n]{2,60})\/([a-z]*)\.test\(/g)) {
      if (m[2].includes("i")) continue;
      const lit = m[1];
      if (!/[A-Za-z]/.test(lit)) continue;
      if (/[.*+?()[\]{}^$|\\]/.test(lit)) continue;
      const ci = new RegExp("\\b" + lit + "\\b", "i");
      for (const rel of scope) {
        const text = ctx.baseline.get(rel);
        if (!text) continue;
        if (text.includes(lit)) continue;
        const hit = text.match(ci);
        if (!hit) continue;
        problems.push({
          family: "F12-case-mismatch",
          severity: "blocker",
          msg: `${t.id}: verify 用 ${lit} 去查 ${rel},但代码里写的是 ${hit[0]} → 这条检查永远不会命中(恒绿)`,
        });
        break;
      }
    }
  }
}

// ---- F13: the action and the verify declare different shapes for one symbol ----
function checkApiShapeConflict(tasks, problems) {
  for (const t of tasks) {
    const action = String(t.labels.action ?? "");
    const verify = String(t.labels.verify ?? "");
    if (!action || !verify) continue;
    const syms = new Set(
      [...action.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{4,})\b/g)]
        .map((m) => m[1])
        .filter((s) => /[A-Z]/.test(s)),
    );
    for (const sym of syms) {
      if (!verify.includes(sym)) continue;
      const at = action.indexOf(sym);
      const seg = action.slice(at, at + 200);
      const head = seg.slice(0, 90);
      const objectShaped = /\{[^}]{2,}\}/.test(seg) && /(返回|契约|字段|签名|产出)/.test(head);
      if (!objectShaped) continue;
      const vi = verify.indexOf(sym);
      const use = verify.slice(vi, vi + 90);
      if (!/\.length|\.join\(|\[0\]/.test(use)) continue;
      problems.push({
        family: "F13-api-shape-conflict",
        severity: "blocker",
        msg: `${t.id}: action 声明 ${sym} 返回对象,verify 却按数组/字符串用它 → 契约冲突`,
      });
    }
  }
}

// ---- F14: a cited count does not reproduce in the repo ------------------------
function checkCitedNumber(tasks, ctx, problems) {
  for (const t of tasks) {
    for (const line of t.raw ?? []) {
      const num = line.match(/(\d+)\s*(?:条|个|行|次|命中)/);
      if (!num) continue;
      const re = line.match(/`\/([^`\n]{3,80})\/`/);
      const path = line.match(PATH_TOKEN);
      if (!re || !path) continue;
      const rel = path[0].replace(/:\d+(?:-\d+)?$/, "");
      const base = ctx.baseline.get(rel);
      if (!base) continue;
      let hits = 0;
      try {
        hits = (base.match(new RegExp(re[1], "g")) || []).length;
      } catch {
        continue;
      }
      if (hits === Number(num[1])) continue;
      problems.push({
        family: "F14-cited-number-not-reproducible",
        severity: "blocker",
        msg: `${t.id}: 引用的数字 ${num[1]} 在 ${rel} 里复现不出(实际 ${hits})`,
      });
    }
  }
}

// ---- F15: the trigger field has no producer -----------------------------------
const PRODUCER_VERBS = /(写|补|加|新增|落|产出|引入|增加|改成|带|声明)/;
const FIELD_ALLOW = new Set([
  "http", "https", "file", "node", "npm", "git", "bash", "sh", "js", "mjs", "md", "json", "utf8",
  "exit", "status", "plan", "phase", "frontmatter", "warning", "blocker", "advisory", "verdict",
  "reason", "fix", "msg", "id", "level", "kind", "text", "target", "type", "action", "note", "state",
  "code", "name", "value", "count", "total", "ok", "err", "args", "opts", "url", "jsonl", "cwd",
  "dir", "path", "line", "lines", "roundtrip",
]);
function checkDeadTrigger(tasks, ctx, problems) {
  for (const t of tasks) {
    const action = String(t.labels.action ?? "");
    const TRIGGER = /(触发|trigger|门禁|gate|判据|判定条件)/i;
    for (const line of t.raw ?? []) {
      if (!TRIGGER.test(line)) continue;
      for (const span of line.matchAll(/`([^`\n]{1,60})`/g)) {
        for (const m of span[1].matchAll(/^([a-z][a-z0-9_]{2,20})\s*:/g)) {
          const field = m[1];
          if (FIELD_ALLOW.has(field)) continue;
          if (new RegExp(PRODUCER_VERBS.source + "[^\\n]{0,24}" + field).test(action)) continue;
          if (new RegExp(field + "[^\\n]{0,24}" + PRODUCER_VERBS.source).test(action)) continue;
          let produced = false;
          for (const body of ctx.baseline.values()) {
            const writes = new RegExp(
              "(^|[\\s`'\"{,])" + field + "\\s*:|(?:^|[^\\w.])\\." + field + "\\s*=",
              "m",
            ).test(body);
            const declares = new RegExp("(?:let|const|var)\\s+" + field + "\\s*=").test(body);
            if (writes && !declares) {
              produced = true;
              break;
            }
          }
          // 兄弟票生产者:触发字段由同 phase 的兄弟票写(如 28-01 声明 entry:,28-02 消费它)——
          // 单票视角看不到的生产者不算死触发。兄弟票文本由接线注入(ctx.siblings)。
          if (!produced) {
            for (const s of ctx.siblings ?? []) {
              if (new RegExp(PRODUCER_VERBS.source + "[^\\n]{0,24}" + field).test(s)) { produced = true; break; }
              if (new RegExp(field + "[^\\n]{0,24}" + PRODUCER_VERBS.source).test(s)) { produced = true; break; }
            }
          }
          if (produced) continue;
          problems.push({
            family: "F15-dead-trigger",
            severity: "blocker",
            msg: `${t.id}: 触发字段 ${field} 没有任何生产者写 → 永不触发(假绿门禁)`,
          });
        }
      }
    }
  }
}

// ---- F16: an intervening command between the tested command and the $? capture ----
// Source: GitHub #24 — `cmd; local code; code=$?` → $? is the exit code of `local` itself (0);
// 25 preflight checks reported all-green while 6 were true red. The capture must be ADJACENT:
// `code=$?` immediately after the tested command, or `if cmd; then …; else code=$?; fi`.
function checkExitCodeAdjacency(tasks, problems) {
  for (const t of tasks) {
    const verify = String(t.labels.verify ?? "");
    if (!verify.includes("$?")) continue;
    // Form 1 (measured in #24): `local <name>` declared, then `<name>=$?` in the same command.
    if (/local\s+(\w+)[^;\n]{0,60};\s*\1\s*=\s*\$\?/.test(verify)) {
      problems.push({
        family: "F16-exit-code-capture-adjacency",
        severity: "blocker",
        msg: `${t.id}: 捕获 $? 前插入了 local 声明 —— local 本身是成功命令,把退出码重置为 0;写成 code=$? 紧跟被测命令,或 if cmd; then …; else code=$?; fi`,
      });
      continue;
    }
    // Form 2 (generic): the statement right before a `$?` capture is itself a state-changing
    // builtin (echo/printf/cd) — it resets the code the capture is about to read.
    const stmts = verify.split(/(?:;|\r?\n)/).map((s) => s.trim()).filter(Boolean);
    for (let i = 1; i < stmts.length; i++) {
      if (!/\$\?/.test(stmts[i])) continue;
      const prev = stmts[i - 1];
      if (/^(?:local|echo|printf|cd)\b/.test(prev) && !/=\s*\$\?\s*$/.test(prev)) {
        problems.push({
          family: "F16-exit-code-capture-adjacency",
          severity: "blocker",
          msg: `${t.id}: 捕获 $? 与被测命令之间隔了「${prev.slice(0, 24)}」 —— 退出码被它重置;捕获必须紧邻被测命令`,
        });
      }
    }
  }
}

export function checkPlanQuality(planText, ctx = {}) {
  const { lines, tasks } = parsePlan(planText);
  ctx = { ...ctx, planText };
  const problems = [];
  const trace = (n, fn) => { process.stderr.write("gate:" + n + "\n"); fn(); };
  trace("F1", () => checkVerifyBlind(tasks, problems));
  trace("F2F5", () => checkBaselineLiterals(tasks, ctx, problems));
  trace("F3", () => checkCoversOrphan(tasks, ctx, problems));
  trace("F4", () => checkAnchorDrift(planText, ctx, problems));
  trace("F6", () => checkBudget(planText, tasks, problems, ctx));
  trace("F8", () => checkPromiseOutOfScope(tasks, problems));
  trace("F9", () => checkClaimUnverified(tasks, problems));
  trace("F10", () => checkVerifyVsCitedSource(tasks, ctx, problems));
  trace("F11", () => checkFixtureSelfcheck(tasks, problems));
  trace("F12", () => checkCaseMismatch(tasks, ctx, problems));
  trace("F13", () => checkApiShapeConflict(tasks, problems));
  trace("F14", () => checkCitedNumber(tasks, ctx, problems));
  trace("F15", () => checkDeadTrigger(tasks, ctx, problems));
  trace("F16", () => checkExitCodeAdjacency(tasks, problems));
  return { problems, tasks: tasks.length };
}

// ---- --selfcheck:28 份 dirty/clean 孪生自证门有牙且不假红 ----
// dirty 必须出现本族发现(任何 severity;F3 按设计是 advisory);clean 必须零 blocker。
// 孪生对着 baseline/ 子树判(研究台语料基线的仓库内子集,11 文件);ctx 与研究台 measure 同形状。
function selfcheck() {
  const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "plan-review-fixtures");
  if (!existsSync(fixtureDir)) {
    console.error("FAIL plan-review-gate: 夹具目录缺失 " + fixtureDir);
    process.exit(1);
  }
  const baseDir = join(fixtureDir, "baseline");
  const baseline = new Map();
  const walk = (rel = "") => {
    const abs = join(baseDir, rel);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const child = rel ? rel + "/" + entry.name : entry.name;
      if (entry.isDirectory()) walk(child);
      // 基线快照的 .mjs 存成 .mjs.baseline:躲开零依赖/模块完整性扫描(快照是冻结数据不是活模块),键名剥后缀还原真实路径
      else baseline.set(child.replace(/\.baseline$/, ""), readFileSync(join(baseDir, child), "utf8"));
    }
  };
  walk("");
  const ctx = {
    baseline,
    reqText: readFileSync(join(baseDir, ".planning", "REQUIREMENTS.md"), "utf8"),
    contextText: readFileSync(join(baseDir, ".planning", "28-CONTEXT.md"), "utf8"),
  };
  const files = readdirSync(fixtureDir).filter((f) => f.endsWith(".md")).sort();
  let dirtyCaught = 0, dirtyTotal = 0, cleanFails = 0, cleanTotal = 0;
  for (const f of files) {
    const text = readFileSync(join(fixtureDir, f), "utf8");
    const r = checkPlanQuality(text, ctx);
    const m = f.match(/^(F\d+)-(dirty|clean)\.md$/);
    if (!m) continue;
    const [, fam, kind] = m;
    if (kind === "dirty") {
      dirtyTotal++;
      const hit = r.problems.some((p) => p.family.startsWith(fam + "-"));
      if (hit) dirtyCaught++;
      else console.error(`✗ ${f}: 本族发现没出现(门没牙)`);
    } else {
      cleanTotal++;
      const blockers = r.problems.filter((p) => p.severity === "blocker");
      if (blockers.length) {
        cleanFails++;
        console.error(`✗ ${f}: clean 孪生出现 blocker —— ${blockers[0].family}: ${blockers[0].msg.slice(0, 80)}`);
      }
    }
  }
  console.log(`dirty 吸收 ${dirtyCaught}/${dirtyTotal} · clean 假红 ${cleanFails}/${cleanTotal}`);
  if (dirtyCaught !== dirtyTotal || cleanFails !== 0) process.exit(1);
  console.log("clean 假红 0/14");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes("--selfcheck")) selfcheck();
