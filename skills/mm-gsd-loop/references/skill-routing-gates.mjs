// 技能路由门禁 —— 每个 mm-gsd 技能都要说清「跑完之后下一步是什么、调哪个技能」。
//
// 为什么要有门:D-05 的那句提示写在各技能的 SKILL.md 里,那正是 agent 真读的文档;
// 但散文会烂 —— 新增技能忘了写、小节里点名的技能被删了,都没有人会发现。
// 这道门只判两件可判定的事:小节在不在、小节点名的技能存不存在。
//
// 为什么不判「写的内容对不对」:那是 agent 的判断,机器硬判只会变成一条恒红的门
// (门禁恒红等于没有门)。
//
// 一个事实一个 owner:每个技能在自己的文档里声明自己的出口;环的完整顺序仍由
// mm-gsd-loop 的「五步成环」一处持有,这里不复制那张表。

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 取 SKILL.md 里的「完成后」小节正文;没有这一节返回 null。
 *
 * 按行切(而不是一个大正则)—— 与 verification-gates.mjs 的 humanItems 同一套路:
 * 小节到下一个同级标题为止,标题后缀(括号说明)也要容得下。
 */
export function routeSection(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const i = lines.findIndex((l) => /^##\s*完成后\s*$/.test(l));
  if (i < 0) return null;
  const rest = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (/^#{1,3}\s/.test(lines[j])) break;
    rest.push(lines[j]);
  }
  return rest.join("\n");
}

/** 小节点名的技能名(去重) */
export function namedSkills(section) {
  return [...new Set([...String(section ?? "").matchAll(/mm-gsd-[a-z][a-z-]*/g)].map((m) => m[0]))];
}

/**
 * 路由门禁本体:遍历 skills/ 下每个 mm-gsd-* 技能,查两件事。
 *
 * 每条问题自带改法(fix)。三种问题要改的东西不一样:缺小节要**补一段**,
 * 点名不存在要**改名字或补技能** —— 早先只有一句统一的「补一段「## 完成后」」,
 * 碰上后一种问题时,照做的人会补出第二段重复的小节(2026-10-22 复核发现)。
 *
 * @param skillsRoot skills/ 目录
 * @returns [{skill, problem, fix}] —— 空数组 = 全绿
 */
export function checkRoutes(skillsRoot) {
  const problems = [];
  let entries = [];
  try { entries = readdirSync(skillsRoot, { withFileTypes: true }); } catch {
    return [{ skill: "(skills 目录)", problem: "读不到 skills 目录 —— 这等于没检查", fix: "确认 skills/ 目录在包里(打包清单漏了它)" }];
  }
  const dirs = entries.filter((d) => d.isDirectory() && d.name.startsWith("mm-gsd-")).map((d) => d.name);
  for (const skill of dirs) {
    const f = join(skillsRoot, skill, "SKILL.md");
    if (!existsSync(f)) { problems.push({ skill, problem: "没有 SKILL.md", fix: "补一份 SKILL.md" }); continue; }
    const section = routeSection(readFileSync(f, "utf8"));
    if (section === null) {
      problems.push({ skill, problem: "没有「完成后」小节 —— 跑完这个技能,人不知道下一步该敲什么",
        fix: "补一段「## 完成后」,写明做完这一步调哪个 mm-gsd 技能" });
      continue;
    }
    const named = namedSkills(section);
    if (!named.length) {
      problems.push({ skill, problem: "「完成后」小节没点名任何 mm-gsd 技能 —— 只写「继续」等于没写",
        fix: "在小节里点名下一个 mm-gsd 技能(如「下一步:调用 `mm-gsd-exec`」)" });
      continue;
    }
    for (const n of named) if (!dirs.includes(n))
      problems.push({ skill, problem: `「完成后」点名了不存在的技能 ${n}`,
        fix: `把 ${n} 改成真实存在的 mm-gsd 技能;或把那个技能补上` });
  }
  return problems;
}
