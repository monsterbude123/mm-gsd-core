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

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
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
  // 列**目录**,不列文件:novel 里装的是文件路径,而判据是「这个目录 git 历史里没有」——
  // 报错写成「目录(docs/b.md、tools/c.mjs)」会让读的人以为那是两个目录。
  if (novel.length) reasons.push(`触及 git 历史里从未改过的目录(${[...new Set(novel.map((f) => norm(f).split("/").slice(0, -1).join("/")))].join("、")})`);
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

/**
 * 研究消费门 —— 研究落盘了,却没有票引用它,等于没人读。
 *
 * 为什么要有这条(phase 07 D-02):`RESEARCH` 在 mm-gsd-exec/SKILL.md 里出现 0 次 ——
 * 研究产物落盘了,却没有任何角色被要求读它。于是执行端不知道「哪些结论已经查过」,
 * 只得自己重查一遍:调研的时间被花两遍,而且第二遍还没人监督。
 *
 * 判据:phase 有研究产物 + 该 phase 的**活票**没在任何 read_first / action 里点名它 → 判红。
 * 只对活票判(与上面的研究触发门同一套判活判据)—— 存量工件恒红就是墙(T-13)。
 *
 * 为什么认「点名」而不是「读完」:读完是执行期的行为,门禁看不到;
 * 「票里引用了它」是规划期就能判的事实 —— 引用了,执行端就有义务去读。
 */
export function checkResearchConsumed({ name, phase, root, planDir, text = "", e, w }) {
  const ticket = name.match(/^(\d+-\d+)/)?.[1];
  if (ticket && ticketsCovered(readSummaries(root), ticket)) return true;
  const artifact = findResearch(root, phase, planDir);
  if (!artifact) return true;                       // 没有研究产物 → 无从消费,不判
  const base = artifact.split(/[\\/]/).pop();       // 认文件名就够:同名文件只此一份
  if (text.includes(base)) return true;             // 票里点名了 → 有义务去读
  e(`${name}: 本 phase 有研究产物 ${base},但这张票没引用它 —— 研究落盘了没人读,执行端会自己重查一遍`,
    `在 <read_first> 或 <action> 里点名 ${base}(并把用到的结论摘进 action,让执行端不必再翻研究文件)`);
  return false;
}

/**
 * 全仓版:扫 .planning 下所有活票,逐张判研究有没有被消费。
 * 给 mmc 的 R-21 门禁用(判据是工件事实,不是散文)。
 *
 * **自证会红**(照 checkTags 的形状):门禁自己造一个假场景(有研究产物 + 票没引用它),
 * 跑一遍**整条判定路径**,确认它真的给出判红。门禁自己不会红,就没有人知道它坏了 ——
 * check-report-fails-loud 的先例。实测过的洞:把判定改成「永远通过」,
 * 自测能抓住;但把门禁**接线**整个掏空,自测抓不到(自测直接调函数,不经接线)——
 * 那个洞是本仓所有门禁共有的,记在 phase 07 的 deferred 里。
 */
export function checkResearchConsumedAll({ root, report }) {
  const dir = join(root, ".planning");
  // 自证:造一个假 phase —— 有研究产物 + 一张没引用它的活票 → 必须判红
  const fake = { pass: () => {}, fail: (m) => fake.fails.push(m), info: () => {}, fails: [] };
  const tmp = mkdtempSync(join(tmpdir(), "mm-gsd-rcons-self-"));
  try {
    mkdirSync(join(tmp, ".planning"), { recursive: true });
    writeFileSync(join(tmp, ".planning", "99-RESEARCH.md"), "见 src/a.cts:3 的结论\n");
    writeFileSync(join(tmp, ".planning", "99-01-PLAN.md"), "### T1 x\n- **read_first**: src/a.mjs\n");
    const errs = [];
    checkResearchConsumed({ name: "99-01-PLAN.md", phase: "99", root: tmp, planDir: join(tmp, ".planning"), text: readFileSync(join(tmp, ".planning", "99-01-PLAN.md"), "utf8"), e: (m) => errs.push(m), w: () => {} });
    if (!errs.length) {
      report.fail("研究消费门自证失败:喂「有研究产物 + 票没引用它」竟没判红 —— 判定逻辑坏了");
      return false;
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  if (!existsSync(dir)) { report.info("没有 .planning/ —— 还没有工件,研究消费门无事可判"); return true; }
  let names = [];
  try { names = readdirSync(dir).filter((f) => f.endsWith("-PLAN.md")); } catch {}
  let pass = true, checked = 0;
  for (const f of names) {
    const p = join(dir, f);
    const phase = f.slice(0, 2);
    const errs = [];
    checkResearchConsumed({
      name: f, phase, root, planDir: dir, text: readFileSync(p, "utf8"),
      e: (m) => errs.push(m), w: () => {},
    });
    if (errs.length) { for (const m of errs) report.fail(m); pass = false; }
    else checked++;
  }
  if (pass) report.pass(`研究产物都有票消费(${checked} 张活票;自证会红)`);
  return pass;
}
