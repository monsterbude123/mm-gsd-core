// 工件契约表 —— 从 gsd-state-check.mjs 里拆出来的,按需加载。
//
// 为什么拆:模板契约规则会越长越多,留在主脚本里会把 626 行顶破 700 上限。
// 主脚本用 `await import()` 只在 --templates / 默认模式真正需要时才加载。
//
// 关键区分(这是本文件存在的理由):
//   模板本身天然满是占位符(它就是给人抄的),所以「模板校验」只查**结构**:
//     frontmatter 键在不在、必填节有没有、枚举值写法对不对。
//   真实工件查**内容**:status 是否合法值、commits 是否实测、有没有占位残留。
//   拿实例的规则去卡模板,等于要求模板不能有占位符——那模板就没用了。
//
// --templates 模式(扫包里的模板并逐份过契约)也住在这里:它判的就是「模板长对没有」,
// 规则与执行它的扫描放在一起名实相符;主脚本因此腾出三十多行给别的门禁(它贴着 700 上限)。

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const STATUSES = ["discussing", "planning", "executing", "verifying", "completed", "shipped", "paused"];
const SUMMARY_STATUSES = ["complete", "halted"];
const VERIF_STATUSES = ["passed", "gaps_found", "human_needed"];
const SHIP_STATUSES = ["shipped", "held"];
const PLACEHOLDER = /To be filled|待补|PLACEHOLDER|placeholder|\bTBD\b/i;

const has = (t, re) => re.test(t);
const front = (t) => {
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    const hash = v.indexOf("#");
    if (hash > 0 && !/^["']/.test(v)) v = v.slice(0, hash).trim();
    out[kv[1]] = v;
  }
  return out;
};
// 多值写法是最阴的一类:值本身不是非法值,是"照抄即非法"
const looksMulti = (v) => /\|/.test(v);

// 每份模板:必填 frontmatter 键 / 必填小节 / 单值枚举键
const CONTRACTS = {
  "state.md": {
    keys: ["status", "active_phase"],
    enumKeys: { status: STATUSES },
    sections: [/^##\s*Phases\s*$/m, /^\s*-\s*\[.\]\s*\d+/m],
    fixes: {
      status: "写单个值,例如 status: discussing(不要写 \"discussing | planning | ...\" —— 那是选项说明,不是值)",
      active_phase: "active_phase: 01",
    },
  },
  "plan.md": {
    keys: ["phase", "goal", "rollback", "files_modified"],
    sections: [/^###\s+T\d+/m],
    fixes: { goal: 'goal: <结果形一句话:做完之后用户能做到什么>', files_modified: "files_modified:\n  - src/example.ts   ← 精确路径,不要写模糊措辞" },
  },
  "context.md": {
    frontmatterFree: true,
    tags: ["domain", "decisions", "specifics", "deferred"],
    fixes: { tags: "四个标签一个都不能少:<domain>…</domain> <decisions>…</decisions> <specifics>…</specifics> <deferred>…</deferred>。deferred 空也要写上 —— 它是范围蔓延的兜底。" },
  },
  "summary.md": {
    keys: ["status", "commits"],
    enumKeys: { status: SUMMARY_STATUSES },
    sections: [/^##\s*One-liner\s*$/m, /Self-Check/i],
    fixes: { status: "status: complete(或 halted)—— 写单个值,不要写 \"complete | halted\"", commits: "commits: 3(用 git rev-list --count 实测,不手填)" },
  },
  "verification.md": {
    keys: ["status", "phase", "score"],
    enumKeys: { status: VERIF_STATUSES },
    sections: [/^##\s*Observable Truths\s*$/m],
    fixes: { status: "status: passed(或 gaps_found / human_needed)—— 写单个值,不要写 \"passed | gaps_found | human_needed\"", score: 'score: 4/6' },
  },
  "ship.md": {
    keys: ["phase", "status", "delivered", "docs_synced"],
    enumKeys: { status: SHIP_STATUSES },
    sections: [/^##\s*交付内容\s*$/m],
    fixes: { status: "status: shipped(或 held)", delivered: "delivered: PR #128 —— 真实位置,不要留 <占位符>", docs_synced: "docs_synced: yes(没改文档写 no 并说明)" },
  },
};

/**
 * 从模板文件里抽出 ```markdown 块 —— agent 照抄的就是这一段。
 *
 * **必须认 CRLF**:Git for Windows 的**系统级** `core.autocrlf=true`(不在仓库里,
 * 在 Git 安装目录的 etc/gitconfig),所以 Windows 上的新克隆全是 CRLF。
 * 只认 `\n` 的正则会在每个 Windows 用户的机器上判「找不到 ```markdown 块」——
 * 六份模板一起假红,而这条门禁(R-05/R-09/R-11)每次提交都跑。
 * 假绿要命,恒红也要命:后者让人学会忽略它。
 */
export function extractTemplateBlock(text) {
  return String(text ?? "").match(/```markdown\r?\n([\s\S]*?)\r?\n```/)?.[1] ?? null;
}

/** 校验模板文本本身:只查结构,不查占位符 */
export function validateTemplate(name, text) {
  const out = [];
  const c = CONTRACTS[name];
  if (!c) return out;
  const add = (m, fix) => out.push({ message: `[${name}] ${m}`, fix: fix ?? "" });

  if (!c.frontmatterFree) {
    const fm = front(text);
    if (!fm) add("没有 frontmatter", "以 --- 开头、--- 结束,把键值放中间");
    else {
      for (const k of c.keys ?? []) {
        if (!(k in fm)) add(`frontmatter 缺 ${k}`, c.fixes?.[k] ?? `${k}: <值>`);
      }
      for (const [k, allowed] of Object.entries(c.enumKeys ?? {})) {
        const v = fm[k];
        if (v === undefined) continue;
        if (looksMulti(v)) {
          add(`\`${k}\` 写成了多值 "${v}" —— 照抄即非法`, c.fixes?.[k] ?? `改为单个值:${allowed.slice(0, 3).join(" / ")}`);
        } else if (!allowed.includes(v)) {
          add(`\`${k}\` 值 "${v}" 非法`, c.fixes?.[k] ?? `改为 ${allowed.join(" / ")}`);
        }
      }
    }
  }
  for (const tag of c.tags ?? []) {
    if (!has(text, new RegExp("<" + tag + ">")))
      add(`缺 <${tag}> 标签`, c.fixes?.tags ?? `补 <${tag}>…</${tag}>`);
  }
  for (const re of c.sections ?? []) {
    if (!has(text, re)) add(`缺小节 ${re.source}`, "照模板把这一节补上 —— 状态机与验证环节都靠它定位");
  }
  return out;
}

/** 校验真实工件实例:查内容(合法值 / 实测值 / 占位残留) */
export function validateInstance(kind, name, text, fm) {
  const out = [];
  const add = (m, fix) => out.push({ message: `[${name}] ${m}`, fix: fix ?? "" });
  const f = fm ?? front(text) ?? {};

  if (kind === "context") {
    for (const tag of ["domain", "decisions", "specifics", "deferred"])
      if (!has(text, new RegExp("<" + tag + ">"))) add(`缺 <${tag}> 节`, "四个标签一个都不能少;deferred 空也要写上");
  }
  if (kind === "summary") {
    if (!SUMMARY_STATUSES.includes(f.status)) add(`status "${f.status ?? "(缺)"}" 非法`, "改为 complete 或 halted");
    if (!/^\d+$/.test(f.commits ?? "")) add(`commits 非纯数字 "${f.commits ?? "(缺)"}"`, "git rev-list --count <base>..HEAD 实测");
  }
  if (kind === "verification" && !VERIF_STATUSES.includes(f.status))
    add(`status "${f.status ?? "(缺)"}" 非法`, `改为 ${VERIF_STATUSES.join(" / ")}`);
  if (kind === "ship") {
    if (!SHIP_STATUSES.includes(f.status ?? "")) add(`status "${f.status ?? "(缺)"}" 非法`, `改为 ${SHIP_STATUSES.join(" / ")}`);
    const ev = String(f.delivered ?? "");
    if (!ev || /[<>]/.test(ev) || /^(tbd|n\/?a|none)$/i.test(ev))
      add("delivered 缺可核对的交付证据", "delivered: PR #128 —— 真实位置,不要留 <占位符>");
  }
  if (kind === "context" && PLACEHOLDER.test(text))
    add("含占位文本", "填真实内容;确实是延后项就写进 <deferred> 并说明");
  return out;
}

// 验收结论对账(正文判定 vs frontmatter status)住 verification-gates.mjs。
// 从这里转出而不是在调用点多写一行 import,是为了让 state-check 只认一个工件契约入口。
export { validateVerification } from "./verification-gates.mjs";

export const TEMPLATE_NAMES = Object.keys(CONTRACTS);

/**
 * --templates 模式:扫包里的模板,逐份过结构契约。
 *
 * 退出码不在这决定 —— 调用方拿着返回值自己退出,理由才能进遥测
 * (直接在模块里 exit 会让失败没有原因,T-14:看不见的失败等于没有诊断入口)。
 *
 * @returns {bad, checked, fatal?} —— fatal 是「一份模板都没找到」,那种情况是目录解析坏了
 */
export function checkTemplates({ tmplRoot, log = console.log }) {
  log("\n=== mm-gsd 模板门禁 ===");
  let bad = 0, checked = 0;
  for (const tdir of [join(tmplRoot, "mm-gsd-exec", "templates"), join(tmplRoot, "mm-gsd-plan", "templates"),
                      join(tmplRoot, "mm-gsd-verify", "templates"), join(tmplRoot, "mm-gsd-loop", "templates")]) {
    if (!existsSync(tdir)) continue;
    for (const f of readdirSync(tdir).filter((x) => x.endsWith(".md"))) {
      checked++;
      const txt = readFileSync(join(tdir, f), "utf8");
      const block = extractTemplateBlock(txt);
      if (block === null) { log("  ✗ " + f + ": 找不到 ```markdown 块 —— agent 不知道该抄哪一段"); bad++; continue; }
      const issues = validateTemplate(f, block);
      if (issues.length) {
        bad++;
        log("\n  ✗ " + f);
        for (const i of issues) { log("      " + i.message); log("        → " + i.fix); }
      } else log("  ✓ " + f);
    }
  }
  log("");
  if (!checked) return { bad: 1, checked, fatal: "一份模板都没找到 —— 目录解析坏了,这等于没检查(tmplRoot = " + tmplRoot + ")" };
  if (bad) {
    log("  " + bad + "/" + checked + " 份模板过不了自己的契约 —— 照抄即报错,agent 会卡在门禁上。");
    return { bad, checked };
  }
  log("  ✓ " + checked + " 份模板结构合规");
  return { bad: 0, checked };
}
