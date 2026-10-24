// 门禁模块登记表 + 台账基线演进检查。
//
// 为什么从 mmc.mjs 抽出来:mmc.mjs 顶过 700 上限两次(实测 git 历史峰值 714),
// 修 G-03 时又超了 11 行。本仓的先例是 gh-issues.mjs 与 rule-baseline.mjs ——
// 同样是顶破才抽。按 budget.json 自己的规矩办。
//
// 这里放的是**登记类核对**:它们要读别的文件的导出、要比对两份记录,
// 而这三件事共同点是「判定依据在别的文件里」,所以天然住在一起。

import { readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * 门禁↔台账↔用例登记表的三向核对(R-16)。
 *
 * 三条方向各堵一种腐化路径,缺一条就有一整族绕过:
 *   1. 门禁 → 用例登记   「新增门禁没登记会红用例」→ 门禁坏了没人知道
 *   2. 用例登记 → 门禁   「删了门禁忘了删登记」   → 本仓最常见的腐化路径
 *   3. 门禁 → active 规则「既没规则引用也没登记」→ 门禁安静地永远不执行
 * 单向会漏,所以必须三向一起看。
 *
 * `_` 是台账的元数据约定(`_why`/重开条件),门禁名用它就成了逃生舱:三处协同
 * 改名成 `_check-x` 后两侧的 startsWith("_") 都跳过,门禁从此不必登记会红用例。
 *
 * @returns null 表示全过;否则返回可读的错误串数组
 */
export function registryGaps(checkNames, reg, driven) {
  const gaps = [];
  if (checkNames.some((k) => k.startsWith("_")))
    gaps.push(`门禁名不许以 _ 开头:${checkNames.filter((k) => k.startsWith("_")).join("、")}`);
  for (const k of checkNames)
    if (typeof reg[k] !== "string" || !reg[k].trim()) gaps.push(`门禁 ${k} 没登记会红用例`);
  for (const k of Object.keys(reg)) {
    if (k.startsWith("_")) continue;                    // `_modules` 是嵌套对象,不是门禁名
    if (!checkNames.includes(k)) gaps.push(`台账登记了 ${k},但 mmc.mjs 里没有这个门禁 —— 可能删了门禁忘了删台账`);
  }
  for (const k of checkNames)
    if (!driven.has(k)) gaps.push(`门禁 ${k} 没有 active 规则引用 —— 它永远不会被执行`);
  return gaps;
}

/**
 * references/ 下的门禁模块必须在 gate-cases.json 的 _modules 登记。
 *
 * **真导入模块枚举它的导出**,不靠正则去猜源码里怎么写的声明(G-03)。
 * 此前用 `/export function (check|validate)/` 匹配,于是 `export async function
 * checkNewThing` 一个词就绕过 —— 同一份未登记的门禁模块,写普通 function 被抓到、
 * 写 async 放行。声明怎么写是实现细节,导出**叫什么**才是契约;按实现细节做判定
 * 就会有一整族绕过:正则同时漏 `export const check = () => {}`、`export default
 * function`、`function x(){} export { x }`、双空格、大小写变体。
 *
 * @returns 未登记的模块名数组;空数组表示齐全
 */
export async function unregisteredModules(refDir, registered) {
  const out = [];
  for (const f of readdirSync(refDir).filter((f) => f.endsWith(".mjs"))) {
    let names;
    try { names = Object.keys(await import(pathToFileURL(join(refDir, f)).href)); }
    // 读不懂模块就当它是门禁模块 —— fail-closed,与 T-08 同向
    catch { out.push(f); continue; }
    if (!names.some((n) => /^(check|validate)/.test(n))) continue;
    if (!registered.includes(f)) out.push(f);
  }
  return out;
}

/**
 * 门禁**活着吗** —— 每个门禁都得有失败路径。
 *
 * 挖出来的洞(2026-10-23,phase 07):把任意门禁的体换成 `return true;`,
 * `mmc health` 照常全绿 —— 门禁被静默掏空了,而 R-16 那条
 * 「每个门禁都登记了会红用例」只查**登记**,不查**实现还有没有红的能力**。
 * 自测也抓不到:自测直接调 references 里的函数,不经 mmc 的接线。
 *
 * 判据(结构事实,可机判):门禁的实现里必须出现「会判红」的痕迹 ——
 * `report.fail`、`return false`,或调用一个会判红的下游(委托型门禁)。
 * 掏空后的体里三样都没有,当场判红。
 *
 * 为什么用结构判据而不是真跑一遍:真跑一遍要造每条门禁的违规输入,
 * 那是 gate-cases.json 登记的内容(人写的散文),不是可执行的东西。
 * 结构判据抓的是「整个体被掏空」这一族 —— 实测能抓住记账门与研究消费门两个实例。
 *
 * @param src       mmc.mjs 的源码
 * @param checkNames CHECKS 里的门禁名
 * @returns 没有失败路径的门禁名数组;空数组表示全都活着
 */
export function deadGates(src, checkNames) {
  const dead = [];
  for (const name of checkNames) {
    const at = src.indexOf(`"${name}"(report)`);
    if (at < 0) { dead.push(name); continue; }              // 找不到体 → 当死
    // 体到下一个顶层 "check- 为止
    const end = src.indexOf('\n  },', at);
    const body = src.slice(at, end < 0 ? at + 4000 : end);
    // 三种「会红」的痕迹:直接判红 / 返回 false / 委托给会判红的下游
    const alive = /report\.fail/.test(body) || /return false/.test(body)
      || /\b(check|run|validate)[A-Z]\w*\(/.test(body);
    if (!alive) dead.push(name);
  }
  return dead;
}

/**
 * 基线与台账必须**双向**一致。
 *
 * 单向(`基线 ⊆ 台账`)能把「删台账」堵住,但把洞挪到了基线那一层(G-02):
 * 只从 rule-baseline.mjs 删掉 R-16 而台账不动,health 照样 exit 0 ——
 * 原始失败形状原样复现,只是删除点从一处变成两处。
 *
 * 更硬的一条:基线是冻结快照,`missingRules` 只查基线⊆台账,反向不查。
 * 实测在台账加 R-17(不写基线)→ 再从台账删掉 → exit 0。
 * **任何基线之后新增的规则永久不受保护,且无人会发现。**
 *
 * 双向查则两条都堵:台账多出基线没有的规则 → 红(新增规则忘了登记基线);
 * 基线多出台账没有的规则 → 红(退役规则忘了从基线删)。前者正是新增规则的入口。
 *
 * @returns {extraInLedger: [...], missingInLedger: [...]} 两个数组都空表示一致
 */
export function baselineDrift(baseline, ledger) {
  const active = new Set((ledger?.rules ?? []).filter((r) => r.status === "active").map((r) => r.id));
  return {
    extraInLedger: [...active].filter((id) => !baseline.includes(id)).sort(),
    missingInLedger: baseline.filter((id) => !active.has(id)),
  };
}

/**
 * 角色卡的描述只许写正文里真有的机制。
 *
 * 挖出来的洞(2026-10-23,phase 07 收尾):实派 mm-gsd-exec 子代理时核对卡面,
 * 发现 exec 的描述写着「SUMMARY 原子块(写后即提交)」和「auth-as-gate」——
 * 前者与正文「SUMMARY 不 commit」**正好相反**,后者在本仓任何文件里都不存在。
 * 卡是路由器和子代理读到的第一手描述:卡错了,子代理就按错的规则开工,
 * 而正文是对的,所以没有任何东西会报红(T-08 的老形状,只是长在散文里)。
 *
 * 判据(结构事实,可机判):描述里每一个**带连字符的拉丁词**
 * (`R1-R4`、`goal-backward`、`auth-as-gate`)都必须在该技能正文里出现过 ——
 * 卡能点名的机制,正文得真写。
 *
 * 为什么只查带连字符的词:描述是摘要,不是引用 —— 中文措辞与正文不同是正常的,
 * 逐词对齐会天天误报。带连字符的拉丁词是**机制的专名**,摘要里出现它就是在
 * 指认一个具体机制,那个机制要么在正文里,要么不在。
 *
 * 放宽一格:整词在正文里出现算过;整词不在,但每一段(连字符切开)都在,
 * 也算过 —— `R1-R4` 在正文里是 `R1`…`R4` 两行,不是连写的。
 */
export function cardClaimGaps(cards) {
  const gaps = [];
  for (const { skill, description, body } of cards) {
    const tokens = description.match(/[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+/g) ?? [];
    const low = body.toLowerCase();
    for (const t of tokens) {
      if (low.includes(t.toLowerCase())) continue;
      const parts = t.split("-");
      if (parts.every((p) => low.includes(p.toLowerCase()))) continue;
      gaps.push(`${skill}: 描述里写了「${t}」,但正文里没有这个机制 —— 卡面在宣传一个不存在的东西`);
    }
  }
  return gaps;
}

/**
 * 扫 skills/ 下的角色卡,产出「卡面 ↔ 正文」的不一致。
 *
 * @returns {skill, description, body}[] 供 cardClaimGaps 判
 */
export function readSkillCards(skillsDir) {
  const cards = [];
  let dirs = [];
  try { dirs = readdirSync(skillsDir, { withFileTypes: true }); } catch { return cards; }
  for (const d of dirs) {
    if (!d.isDirectory() || !d.name.startsWith("mm-gsd-") || d.name.endsWith(".bak-mmgsd")) continue;
    const p = join(skillsDir, d.name, "SKILL.md");
    let text;
    try { text = readFileSync(p, "utf8"); } catch { continue; }
    const desc = text.match(/^description:\s*"([^"]*)"/m)?.[1] ?? "";
    if (!desc) continue;
    // 正文 = 去掉 frontmatter 那一行(description 自己不算证据)
    const body = text.replace(/^description:.*$/m, "");
    cards.push({ skill: d.name, description: desc, body });
  }
  return cards;
}

/**
 * R-22 门禁:卡面描述不得宣传正文没有的机制。
 *
 * 自证:先用两个内存里的假卡跑一遍 —— 一张诚实的(描述里的机制正文有)、
 * 一张撒谎的(描述里的机制正文没有)—— 断言**只有撒谎那张被判红**。
 * 不自证的门禁等于没跑:一个恒绿的实现照样能让 health 绿(见 deadGates)。
 */
export function checkCardClaims(report, root) {
  const honest = cardClaimGaps([{ skill: "fake-ok", description: "机制 alpha-beta", body: "正文写了 alpha-beta" }]);
  const liar = cardClaimGaps([{ skill: "fake-bad", description: "机制 ghost-mech", body: "正文什么都没写" }]);
  if (honest.length !== 0 || liar.length !== 1) {
    report.fail(`卡面核对自证失败:诚实的假卡判了 ${honest.length} 条(应 0),撒谎的假卡判了 ${liar.length} 条(应 1)—— 这条门禁现在不可信`);
    return false;
  }
  const gaps = cardClaimGaps(readSkillCards(join(root, "skills")));
  if (gaps.length) {
    for (const g of gaps) report.fail(g);
    return false;
  }
  report.pass("每张角色卡的描述都只写正文里真有的机制");
  return true;
}

/**
 * R-23 门禁:指针卡必须跟着技能走 —— 技能改了而卡没改,卡就在撒谎。
 *
 * 挖出来的洞(2026-10-23,phase 07 收尾):安装器对已存在的卡一律跳过
 * (「不接管用户的卡」)。但 mm-gsd **自己发的**卡也在跳过之列:
 * exec 的 SKILL.md 修好了,~/.zcode/agents/mm-gsd-exec.md 还写着
 * 「写后即提交」与正文相反的话,还宣传了一个本仓没有的机制。
 * 卡正是路由器与子代理读到的第一手描述 —— 卡错了,派发就错,
 * 而正文是对的,所以没有任何门禁会红。
 *
 * 这条门禁跑一个真沙盒证明三件事(不是看代码,是真的装一遍):
 *   1. 装完 mm-gsd 的卡确实在宿主卡目录里;
 *   2. 改技能描述 → 再装 → 卡跟着改(刷新);
 *   3. 用户自己写的同名卡 → 再装 → 一个字都不动(不接管用户已有的卡)。
 * 三件都成立才算过。沙箱装在临时目录里,cwd 也指沙箱 ——
 * 免得体检顺手改掉真仓库的 git hooksPath。
 */
export function checkCardRefresh(report, root) {
  const sb = join(tmpdir(), "mmc-cardrefresh");
  const run = (args) => execFileSync(process.execPath, args, { stdio: "pipe", timeout: 60000, cwd: sb });
  const cardDir = join(sb, ".zcode", "agents");
  const card = join(cardDir, "mm-gsd-exec.md");
  const skill = join(sb, ".agents", "skills", "mm-gsd-exec", "SKILL.md");
  const inst = join(sb, ".agents", "skills", "mm-gsd-loop", "scripts", "mm-gsd-install.mjs");
  rmSync(sb, { recursive: true, force: true });
  try {
    mkdirSync(cardDir, { recursive: true });
    run([join(root, "bin", "mm-gsd.mjs"), "install", "--home", sb]);
    run([inst, "--yes", "--home", sb]);
    if (!existsSync(card)) { report.fail("装完没有 mm-gsd-exec 指针卡 —— 派发器看不到这个技能"); return false; }
    // 用户自己的卡:同名,但没有 mm-gsd 的指纹 —— 装完必须一个字都不动
    const mine = join(cardDir, "mm-gsd-plan.md");
    writeFileSync(mine, "---\nname: \"mm-gsd-plan\"\n---\n\n我自己写的卡\n");
    // 改技能描述 → 再装 → 卡必须跟着改
    const before = readFileSync(card, "utf8");
    writeFileSync(skill, readFileSync(skill, "utf8").replace(/^description:.*$/m, 'description: "变了。"'));
    run([inst, "--yes", "--home", sb]);
    const after = readFileSync(card, "utf8");
    if (after === before) { report.fail("技能描述改了,指针卡没跟着改 —— 卡面在宣传旧规则"); return false; }
    if (!after.includes("变了。")) { report.fail("指针卡刷新了但没带上新描述 —— 刷新逻辑本身坏了"); return false; }
    if (readFileSync(mine, "utf8") !== "---\nname: \"mm-gsd-plan\"\n---\n\n我自己写的卡\n") {
      report.fail("安装器覆盖了用户自己写的同名卡 —— 违反「不接管用户已有的卡」");
      return false;
    }
    report.pass("指针卡跟着技能刷新,且用户自己的卡一个字不动");
    return true;
  } catch (e) {
    report.fail("指针卡刷新自证失败:" + String(e.stderr || e.message).split("\n")[0]);
    return false;
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
}


