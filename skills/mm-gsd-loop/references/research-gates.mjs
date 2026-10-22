// 研究触发与研究产物合规(D-03)。
//
// 为什么独立成文件:decision-gates.mjs 已经 183/200 行,塞不下;而且「研究」是另一种
// 关注面 —— 那边管「决策有没有被执行」,这边管「动手之前有没有先搞懂」。
//
// 为什么要有这道门:D-03 之前的流程里,研究是**可选**的 —— 六个 skill 里没有一处有
// 主动研究动作,plan 模板的四源表甚至连 RESEARCH 这一格都没有(只写「如做了」)。
// 「可以不做」的后果由别人承担:内容做浅、完成度 60%。
//
// 触发条件必须**机器可判**:恒真即恒红(T-13),而恒红的门要么被绕过,要么被忽略。
// 不合格的触发条件还有两个:「agent 觉得不熟悉」(主观、每次都成立)与
// 「全文字段里出现研究二字」(每个提到研究的 PLAN 都触发)。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ticketsCovered, readSummaries } from "./ticket-alive.mjs";

/** files_modified 跨这么多顶层目录就要求研究 */
export const CROSS_DIRS = 3;

/** 用户明说「先搞懂」的措辞 */
const ASK = /深入了解|研究清楚|先研究|摸清|吃透/;

/** file:line 引用。扩展名限死 —— 否则 https://host:8080 会被当成引用 */
const CITE = /[\w./\\-]*\.(?:mjs|cjs|cts|ts|tsx|js|jsx|md|json|ya?ml|py|sh|html|css):\d+/g;

/**
 * 判这个 PLAN 是否触发研究要求。
 *
 * @param files      PLAN 的 files_modified
 * @param unseenDirs git 历史里从未出现过的目录(不熟悉的领域)
 * @param goal       PLAN 的 goal 字段 —— **只认这一句**:全文字段匹配会让每个提到
 *                   「研究」的 PLAN 都触发,恒真即恒红
 */
export function researchRequired({ files = [], unseenDirs = [], goal = "" }) {
  const norm = (f) => String(f).replace(/\\/g, "/");
  const dirs = new Set(files.map((f) => norm(f).split("/")[0]));
  const novel = files.filter((f) => unseenDirs.includes(norm(f).split("/").slice(0, -1).join("/")));
  const asked = ASK.test(String(goal));
  const reasons = [];
  if (dirs.size >= CROSS_DIRS) reasons.push(`files_modified 跨 ${dirs.size} 个顶层目录(${[...dirs].join("、")})`);
  if (novel.length) reasons.push(`触及 git 历史里从未改过的目录(${novel.join("、")})`);
  if (asked) reasons.push("goal 里明写「深入了解/研究清楚」");
  return { required: reasons.length > 0, reasons, dirs: [...dirs], novel, asked };
}

/** 研究产物里的具体引用(file:line) */
export function researchRefs(text) {
  return [...String(text ?? "").matchAll(new RegExp(CITE.source, "g"))].map((m) => m[0]);
}

/**
 * 研究产物合不合规:D-03 的补充要求「至少一条指向具体结论的引用」——
 * 「读了 12 个文件」不能自证读对了,那是工作量记录不是理解。
 */
export function researchCompliant(text) {
  const refs = researchRefs(text);
  return { ok: refs.length > 0, refs };
}

/**
 * 哪些目录在 git 历史里从未被改过 —— 不熟悉的领域。
 * 不是 git 仓库 → null(判不了,不猜)
 */
export function unfamiliarDirs(root, files) {
  const dirs = [...new Set(files.map((f) => String(f).replace(/\\/g, "/").split("/").slice(0, -1).join("/")).filter(Boolean))];
  const out = [];
  for (const d of dirs) {
    try {
      const log = execFileSync("git", ["log", "--oneline", "--", d], { cwd: root, stdio: "pipe", encoding: "utf8" });
      if (!log.trim()) out.push(d);
    } catch { return null; }
  }
  return out;
}

/** 找研究产物:.planning/<phase>-RESEARCH.md,或与 PLAN 同目录的同名文件 */
export function findResearch(root, phase, planDir) {
  const cands = [join(root, ".planning", `${phase}-RESEARCH.md`)];
  if (planDir) cands.push(join(planDir, `${phase}-RESEARCH.md`));
  return cands.find((p) => existsSync(p)) ?? null;
}

/**
 * 研究触发门 —— 触发条件成立却没有合规研究产物就判红。
 *
 * 只在**还活着的票**上判:已完成的票没有研究产物是历史事实,不是当前缺陷,
 * 判红就是恒红(T-13)。判活的判据与漂移门同一套(ticketsCovered)。
 */
export function checkResearch({ name, goal = "", files = [], phase, root, planDir, e, w }) {
  const ticket = name.match(/^(\d+-\d+)/)?.[1];
  if (ticket && ticketsCovered(readSummaries(root), ticket)) return;
  const unseen = unfamiliarDirs(root, files);
  if (unseen === null) { w(`${name}: 不在 git 仓库里,判不了「是否陌生领域」—— 只按其余条件判`, "确认项目根是 git 仓库;否则这条触发条件形同虚设"); }
  const req = researchRequired({ files, unseenDirs: unseen ?? [], goal });
  if (!req.required) return;
  const artifact = findResearch(root, phase, planDir);
  if (!artifact) {
    e(`${name}: 触发研究条件(${req.reasons.join(";")}),但没有研究产物`, `先写 .planning/${phase}-RESEARCH.md —— 读到么、因此决定了什么,并至少给出一条 file:line 引用;落在对话里的研究下一轮看不见,等于没做`);
    return;
  }
  const c = researchCompliant(readFileSync(artifact, "utf8"));
  if (!c.ok)
    e(`${name}: 研究产物 ${artifact} 没有指向具体结论的引用 —— 「读了很多文件」不能自证读对了`, "补一条 file:line 引用(形如 skills/mm-gsd-loop/scripts/gsd-state-check.mjs:120),并说明这条引用支持哪个结论");
}
