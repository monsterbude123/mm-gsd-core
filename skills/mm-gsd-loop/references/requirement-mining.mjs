// 深挖需求机器门(28-07,D-13/REQ-63):discuss 落 REQ 前必须先答四问,答案进 CONTEXT 的 <mining> 节。
// 判据对象是 28-CONTEXT <mining> 节的既有形状:### REQ-N 块 + 四个固定标签行。
// 豁免两套口径照 checkReqCoverage(:214/:233):REQUIREMENTS.md 标 (baseline 的行、req-ledger 已处置的 REQ。
// 返回问题数组(不靠回调报错),契约同 template-gates 的 validateInstance 一族。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseReqLedger, reqState } from "./req-ledger.mjs";

const QUESTIONS = ["真实需求", "谁消费", "什么时候会废", "做完长什么样"];

function miningBlocks(ctxText) {
  const a = ctxText.indexOf("<mining>");
  const b = ctxText.indexOf("</mining>");
  if (a < 0 || b < 0 || b < a) return null;
  const lines = ctxText.slice(a + 8, b).split(/\r?\n/);
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const h = line.match(/^###\s+(REQ-[\w.-]+)\s*(.*)$/);
    if (h) { cur = { id: h[1], lines: [] }; blocks.push(cur); continue; }
    if (cur) cur.lines.push(line);
  }
  return blocks;
}

/** 四问核对:ctxText 的 <mining> 节里,reqs 每条 REQ 都要有一块且四问各有一行非空答案 */
export function checkRequirementMining({ ctxText, reqs }) {
  const problems = [];
  const blocks = miningBlocks(ctxText);
  if (blocks === null) return problems; // 没有 <mining> 节 = 老项目,豁免(调用方只在有节时调用,这里再兜一层)
  const byId = new Map(blocks.map((b) => [b.id, b]));
  for (const req of reqs) {
    const id = typeof req === "string" ? req : req.id;
    const block = byId.get(id);
    if (!block) {
      problems.push({
        message: `${id} 在 <mining> 节里没有深挖块(### ${id} <短标题>)—— 落 REQ 前先答四问`,
        fix: `在 CONTEXT 的 <mining> 节补一块:### ${id} <短标题>,四个标签行各写一行答案`,
      });
      continue;
    }
    for (const q of QUESTIONS) {
      const re = new RegExp("^\\s*-\\s*\\*\\*" + q + "\\*\\*:\\s*(.*)$", "m");
      const m = block.lines.map((l) => l.match(re)).find(Boolean);
      if (!m || !m[1] || !m[1].trim()) {
        problems.push({
          message: `${id} 缺 ${q} —— 深挖四问必须逐条有非空答案`,
          fix: `在 <mining> 节的 ### ${id} 块里补一行 - **${q}**: <答案>`,
        });
      }
    }
  }
  return problems;
}

/** 本 phase 票 covers 的 REQ 号并集,剔两类:REQUIREMENTS.md 标 (baseline 的、req-ledger 已处置的(照 checkReqCoverage 的两套豁免) */
export function phaseReqs(root, phase) {
  const pdir = join(root, ".planning");
  const reqs = new Set();
  let files = [];
  try { files = readdirSync(pdir).filter((f) => f.startsWith(phase + "-") && f.endsWith("-PLAN.md")); } catch { return []; }
  for (const f of files) {
    const txt = readFileSync(join(pdir, f), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^-\s+\*\*covers\*\*:\s*(.*)$/);
      if (m) for (const rq of m[1].match(/REQ-[\w.-]+/g) ?? []) reqs.add(rq);
    }
  }
  // 豁免一:REQUIREMENTS.md 里标 (baseline 的行(全角括号与半角同权,G-35-1)
  const reqFile = join(pdir, "REQUIREMENTS.md");
  if (existsSync(reqFile)) {
    for (const line of readFileSync(reqFile, "utf8").split(/\r?\n/)) {
      if (/(?:\(|（)baseline/.test(line)) {
        const m = line.match(/REQ-[\w.-]+/);
        if (m) reqs.delete(m[0]);
      }
    }
  }
  // 豁免二:req-ledger 里已处置(非 active)的 REQ
  const ledgerFile = join(pdir, "req-ledger.md");
  if (existsSync(ledgerFile)) {
    const parsed = parseReqLedger(readFileSync(ledgerFile, "utf8"));
    for (const rq of [...reqs]) {
      if (reqState(parsed, rq) !== "active") reqs.delete(rq);
    }
  }
  return [...reqs];
}

/** mmc health 的接线入口:只对含 <mining> 节的 CONTEXT 判(老项目豁免),每条问题 report.fail 一行 */
export function checkRequirementMiningAll({ root, report }) {
  const pdir = join(root, ".planning");
  let ctxFiles = [];
  try { ctxFiles = readdirSync(pdir).filter((f) => f.endsWith("-CONTEXT.md")); } catch { ctxFiles = []; }
  let pass = true;
  for (const f of ctxFiles) {
    const ctxText = readFileSync(join(pdir, f), "utf8");
    if (!ctxText.includes("<mining>")) continue; // 老项目豁免
    const phase = f.split("-")[0];
    const reqs = phaseReqs(root, phase);
    const problems = checkRequirementMining({ ctxText, reqs: reqs.map((id) => ({ id })) });
    for (const p of problems) {
      report.fail(f + ": " + p.message + " —— " + p.fix);
      pass = false;
    }
  }
  if (pass) report.pass("有 <mining> 节的 CONTEXT 四问齐全,无 <mining> 节的老 CONTEXT 已豁免");
  return pass;
}
