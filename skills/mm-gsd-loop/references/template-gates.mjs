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

export const TEMPLATE_NAMES = Object.keys(CONTRACTS);
