// 路由 —— 技能之间怎么走(门禁),以及宿主 agent 该读什么(提示)。
//
// 一个文件放两件事(都是「下一步该干什么」的判定,拆开会变成两份会分叉的真相);原名 skill-routing-gates.mjs —— phase 04 加进宿主路由提示后「gates」不再准确。
// 两条纪律贯穿本文件:**不手写技能清单**(技能从 skills/ 目录派生,写死必漏)、
// **不手写门禁速查**(速查从当前项目的 ledger.json 与 budget.json 读出,手写必与台账分叉 —— D-03;读不到就说读不到)。
// 这里只出**数据**(该读什么、速查是什么、卡里写什么);排版在检查器那一侧。

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/* ================= 一、技能路由门禁(每个技能要说清自己的下一步) ================= */

/**
 * 取 SKILL.md 里的「完成后」小节正文;没有这一节返回 null。
 * 按行切(而不是一个大正则)—— 与 verification-gates.mjs 的 humanItems 同一套路。
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
 * 路由门禁本体:每个 mm-gsd-* 技能查两件事,每条问题自带改法(fix)。
 * @returns [{skill, problem, fix}] —— 空数组 = 全绿
 */
export function checkRoutes(skillsRoot) {
  const problems = [];
  let entries = [];
  try { entries = readdirSync(skillsRoot, { withFileTypes: true }); } catch {
    return [{ skill: "(skills 目录)", problem: "读不到 skills 目录 —— 这等于没检查", fix: "确认 skills/ 目录在包里(打包清单漏了它)" }];
  }
  const dirs = entries.filter((d) => d.isDirectory() && d.name.startsWith("mm-gsd-") && !d.name.endsWith(".bak-mmgsd")).map((d) => d.name);
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

/* ================= 二、宿主表与能力探测(D-04) ================= */

// 宿主适配表。agents 字段 = 该宿主的 agent 卡目录;没有约定就是 null ——
// 不硬造一个目录结构出来(D-04:探不到就不假装支持)。
// 这张表原来住在 mm-gsd-install.mjs:安装与路由提示都要它,搬到这里是为了「一个 owner」。
export const HOSTS = {
  zcode:  { dir: ".zcode",    skills: ".agents/skills", hook: "zcode",  config: ".zcode/cli/config.json",  hookDir: ".zcode/hooks",  agents: ".zcode/agents",  dist: "技能主仓(native),无需链接" },
  claude: { dir: ".claude",   skills: ".claude/skills",  hook: "claude", config: ".claude/settings.json", hookDir: ".claude/hooks", agents: ".claude/agents", dist: "标准 Claude Code 格式" },
  codex:  { dir: ".codex",    skills: ".codex/skills",   hook: null,     config: ".codex/config.toml",    hookDir: null,         agents: null,           dist: "hooks 由插件(claude-codex-hooks.json)托管,直装会与插件冲突 → 跳过" },
  trae:   { dir: ".trae",     skills: ".trae/skills",    hook: null,     config: null,                   hookDir: null,         agents: null,           dist: "未验证 hooks 机制 → 只装技能" },
  cursor: { dir: ".cursor",   skills: ".cursor/skills",  hook: null,     config: null,                   hookDir: null,         agents: null,           dist: "未验证 hooks 机制 → 只装技能" },
  minimax:{ dir: ".minimax",  skills: null,              hook: null,     config: ".minimax/config.yaml", hookDir: null,         agents: null,           dist: "未发现 skills 目录约定 → 跳过" },
};

/**
 * 宿主能力探测:探得到 agent 卡目录 → 可以开子代理;探不到 → 只说「建议开新上下文」。
 * 不派发、不假装(D-04:不允许降级成看起来在工作的空壳)。
 */
export function detectHost(home) {
  const found = Object.entries(HOSTS).filter(([, v]) => existsSync(join(home, v.dir)));
  const withAgents = found.find(([, v]) => v.agents && existsSync(join(home, v.agents)));
  if (withAgents) {
    const [name, v] = withAgents;
    return { host: name, agentsDir: join(home, v.agents), canSpawn: true, note: "" };
  }
  const seen = found.map(([k]) => k).join(",");
  return { host: seen || null, agentsDir: null, canSpawn: false,
    note: seen ? `探到的宿主(${seen})没有 agent 卡目录 —— 它的子代理机制没验证过。本阶段建议开新上下文`
               : "没探到已知宿主 —— 本阶段建议开新上下文" };
}

/* ================= 三、本项目门禁速查(D-03:机器读出,不许手写) ================= */

const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const cut = (s, n) => { const t = String(s ?? "").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };

/**
 * 从当前项目读出「本项目门禁速查」:ledger 的 active 规则 + budget 的单文件上限。
 * 读不到就记一条说明,**一个字都不许自己补**(D-03)。
 */
export function gateQuickRef(projectRoot) {
  const rules = [], caps = [], notes = [];
  const led = readJSON(join(projectRoot, ".agents", "rules", "ledger.json"));
  if (led) for (const r of (led.rules ?? []).filter((x) => x.status === "active"))
    rules.push({ id: r.id, text: cut(r.statement, 70), check: r.check ?? "" });
  else notes.push("本项目没有 .agents/rules/ledger.json —— 规则速查为空(不补写)");
  const bud = readJSON(join(projectRoot, "budget.json"));
  if (bud) for (const c of bud.fileCaps ?? []) caps.push({ pattern: c.pattern ?? "", max: c.max ?? "?" });
  else notes.push("本项目没有 budget.json —— 单文件上限速查为空(不补写)");
  return { rules, caps, notes };
}

/* ================= 四、路由提示 ================= */

/** 技能清单:从目录派生,不写死 */
export function listSkills(skillsRoot) {
  let dirs = [];
  try { dirs = readdirSync(skillsRoot, { withFileTypes: true }); } catch { return []; }
  return dirs.filter((d) => d.isDirectory() && d.name.startsWith("mm-gsd-") && !d.name.endsWith(".bak-mmgsd")).map((d) => d.name).sort();
}

/**
 * 造一份路由提示:该读哪些路径、本项目门禁速查、宿主能不能开子代理。
 * 只给路径,不给内容(SKILL.md:136:主会话上下文 ≤15%,只传路径不传内容)。
 * @param stage 阶段名(= 技能名去掉 mm-gsd- 前缀);null = 不知道要哪一步,返回环
 */
export function buildRouteBrief({ stage, skillsRoot, projectRoot, home, activePhase }) {
  const skills = listSkills(skillsRoot);
  const host = detectHost(home);
  const quick = gateQuickRef(projectRoot);
  if (!stage) {
    // 不知道要哪一步 → 把环摆出来让人挑。环的顺序由各技能的「完成后」小节持有,
    // 这里只转述,不另造一张表(D-01 的教训:第二真相源必然分叉)。
    const ring = skills.map((s) => {
      const f = join(skillsRoot, s, "SKILL.md");
      const exits = existsSync(f) ? namedSkills(routeSection(readFileSync(f, "utf8")) ?? "") : [];
      return { skill: s, path: f, exits };
    });
    return { kind: "ring", stage: null, skills: ring, host, quick, readPaths: [], projectPaths: [] };
  }
  const skill = "mm-gsd-" + stage;
  if (!skills.includes(skill))
    return { kind: "unknown", stage, skills, host, quick, readPaths: [], projectPaths: [],
      message: `没有 ${skill} 这个技能。可用:${skills.map((s) => s.replace("mm-gsd-", "")).join(", ")}` };
  const skillDir = join(skillsRoot, skill);
  const readPaths = [join(skillDir, "SKILL.md")];
  // 模板是「照抄的骨架」,一并给路径;references 不给 —— SKILL.md 自己写了该读什么
  let tpl = [];
  try { tpl = readdirSync(join(skillDir, "templates")).filter((f) => f.endsWith(".md")); } catch {}
  for (const t of tpl) readPaths.push(join(skillDir, "templates", t));
  const projectPaths = [];   // 项目上下文:只给存在的路径
  const st = join(projectRoot, ".planning", "STATE.md");
  if (existsSync(st)) projectPaths.push(st);
  if (activePhase) for (const p of ["CONTEXT", "PLAN"]) {
    const f = join(projectRoot, ".planning", `${activePhase}-${p}.md`);
    if (existsSync(f)) projectPaths.push(f);
  }
  return { kind: "stage", stage, skill, skillPath: join(skillDir, "SKILL.md"),
    readPaths, projectPaths, host, quick, message: "" };
}

/* ================= 五、指针卡(D-01/D-02:只指路,不接管) ================= */

/**
 * 造一张指针卡:只写「读哪个文件」「边界是什么」「速查怎么拿」,不写任何规则原文 ——
 * 卡里出现规则原文 = 第二真相源(本 phase 要消灭的正是那个东西)。规则在 SKILL.md 里。
 * description 从该技能 SKILL.md 现读 —— 派发器挑卡看的就是这一行,
 * 写成「这是张指针卡」的自指描述,主会话不知道什么时候该派它(2026-10-23 实测教训)。
 */
export function pointerCard({ skill, skillPath, routeCmd }) {
  const stage = skill.replace("mm-gsd-", "");
  const desc = readFileSync(skillPath, "utf8").match(/^description:\s*"([^"]*)"/m)?.[1] ?? `mm-gsd 的 ${stage} 阶段`;
  return `---
name: "${skill}"
description: "mm-gsd 的 ${stage} 子代理:${desc}"
---

## 你的任务

读 \`${skillPath}\` 并照它做。

**别在本卡里找规则**:角色定义只有一份,就在那个文件里。改它,所有卡自动跟着变。

## 边界

- 只传路径,不传内容:要什么文件,让主会话给路径;别把文件内容抄进上下文
- 主会话只做编排与验收(上下文 ≤15%),重活开子代理 —— 你就是那个子代理
- 摸清现状/调研/搜代码也派子代理:主上下文只拿**摘要 + 落盘路径**,别把探查结果灌进主上下文
- **一票一代理**:别把多张票塞给你 —— 你只接这一张(一张票 = 20 分钟能做完的量)
- **批量收尾**:一批做完再统一检查,不要改一次跑一次(贵的门禁不在票里跑)
- 本项目的门禁速查(该跑哪些门禁、单文件行数上限)由主会话在项目根跑:
  \`${routeCmd} --route ${stage}\` —— 那是机器从 ledger/budget 读出来的,不是手写的
`;
}
