#!/usr/bin/env node
// diagnose-check —— 诊断会话门禁
//
//   node diagnose-check.mjs <slug>              校验该会话能不能往下走
//   node diagnose-check.mjs --list              列活跃会话
//   node diagnose-check.mjs --status <slug>    看进度但不恢复(不写入)
//
// 它拦的是「没定位到现象就开修」:复现段空着、假设没写、证据一条没有 —— 这三种情况
// 放行,等于放任盲修。mm-gsd-exec 的失效模式第 6 条点名过:「修复回路超预算还继续盲修」。
//
// 零依赖、跨平台。退出码 0 = 可继续,1 = 不可继续(每条都带自带的解法,见 SKILL.md)。

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const STATUSES = ["diagnosing", "diagnosed", "fixing", "resolved", "abandoned"];
const STATUS_HINT = "status 合法值:" + STATUSES.join(" / ") + "(一次只写一个)";
const root = process.env.GSD_PROJECT_DIR || process.cwd();
const dir = join(root, ".planning", "debug");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : ""; };

const head = (s) => console.log("\n=== mm-gsd 诊断门禁 ===");
const ok = (s) => console.log("  ✓ " + s);
const bad = (s) => { console.log("  ✗ " + s); };
const fix = (s) => console.log("      → " + s);

/** slug 会变成文件名,不消毒就是路径穿越入口 */
function slugOk(s) {
  if (!s) return "slug 不能为空";
  if (s.length > 30) return "slug 超 30 字符";
  if (!SLUG_RE.test(s)) return `slug 非法("${s}") —— 只允许小写字母/数字/连字符`;
  if (s.includes("..") || s.includes("/") || s.includes("\\")) return "slug 不能含路径分隔符";
  return null;
}

function fm(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const o = {};
  if (!m) return o;
  for (const l of m[1].split(/\r?\n/)) {
    const kv = l.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) o[kv[1]] = kv[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
  }
  return o;
}

function section(text, name) {
  // 段尾必须锚定「下一个 ## 标题」或「真正的文末」。两个坑都在这行:
  //   1) 只写 \n## —— 空段落下 "## 复现\n\n## Current" 的 ## 前没有换行符,整段匹配失败返回 null,
  //      于是「复现为空」被判成「复现非空」,是假绿。
  //   2) 用 \s*$ 且带 m 标志 —— 每个行尾都算文末,段被截到第一行,
  //      Current Focus 四行只剩第一行,后面三行报「缺字段」。
  // 所以前瞻只用 (?:^|\n)##\s 锚标题,不用 \s*$。
  const m = text.match(new RegExp("^##\\s+" + name + "\\s*$", "m"));
  if (!m) return "";
  const from = m.index + m[0].length;
  const rest = text.slice(from);
  const next = rest.search(/\n##\s/);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

// ---- --list ----
if (has("--list")) {
  head();
  if (!existsSync(dir)) { ok("没有诊断会话(正常:说明还没遇到要诊断的异常)"); process.exit(0); }
  const rows = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const t = readFileSync(join(dir, f), "utf8");
    const m = fm(t);
    const nf = section(t, "Current Focus");
    const hyp = nf.match(/hypothesis\s*:\s*(.*)/)?.[1] ?? "";
    const ev = (t.match(/^\s*-\s*\d{4}-\d{2}-\d{2}T/gm) ?? []).length;
    rows.push({ slug: m.slug ?? f.replace(/\.md$/, ""), status: m.status ?? "?", hyp, ev });
  }
  if (!rows.length) { ok("没有诊断会话"); process.exit(0); }
  for (const r of rows) console.log(`  ${r.status.padEnd(11)} ${r.slug.padEnd(28)} 证据 ${r.ev} 条 · ${r.hyp.slice(0, 34)}`);
  process.exit(0);
}

const slug = val("--status") || argv.find((a) => !a.startsWith("--")) || "";
const badSlug = slugOk(slug);
if (badSlug) { head(); bad(`slug 不合格:${badSlug}`); fix("从症状生成 kebab-case,≤30 字符,只含 a-z0-9-"); process.exit(1); }

const path = join(dir, slug + ".md");
head();
if (!existsSync(path)) {
  bad(`找不到会话 ${slug}(期望 ${join(".planning", "debug", slug + ".md")})`);
  fix("先复制 skills/mm-gsd-diagnose/templates/debug-session.md 到该路径,slug 与文件名一致");
  process.exit(1);
}

const text = readFileSync(path, "utf8");
const f = fm(text);
// 剥注释后再判内容,避免模板示例被当成真填写
const bare = text.replace(/<!--[\s\S]*?-->/g, "");
let pass = true;

// 1) 状态合法且是单值
if (!f.status) { bad("frontmatter 缺 status"); fix(STATUS_HINT); pass = false; }
else if (!STATUSES.includes(f.status)) { bad(`status 非法值 "${f.status}" —— 写成 a | b 是把选项说明当值`); fix(STATUS_HINT); pass = false; }

// 尖括号包着的是说明,不是值 —— 与 plan/state 模板同一道判据(R-05)
const PLACEHOLDER = (v) => !v || /^[<＜【\[(（]/.test(v);

// 2) 复现段:空 = 还没定位到现象
const repro = section(bare, "复现").trim();
if (!repro) { bad("「## 复现」是空的"); fix("写出会让人照着跑出同样现象的命令/步骤;复现不出来说明还没定位到现象"); pass = false; }

// 3) 假设环四字段
const nf = section(bare, "Current Focus");
for (const k of ["hypothesis", "test", "expecting", "next_action"]) {
  const v = nf.match(new RegExp("^\\s*-\\s*" + k + "\\s*:\\s*(.*)$", "m"))?.[1]?.trim();
  if (PLACEHOLDER(v)) { bad(`Current Focus 的 ${k} 没填(尖括号是说明不是值)`); fix(`- ${k}: 写真内容,别留 <...> 占位`); pass = false; }
}

// 4) 证据至少一条 —— 「诊断产物必须带复现证据才能出 PLAN」的落点。
//    bare 已在上面剥掉 HTML 注释:模板骨架里的示例行是文本不是注释,
//    照抄模板会被算成真证据,于是「拿模板当会话提交」骗过门禁 —— 又是假绿。
const evCount = (bare.match(/^\s*-\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/gm) ?? []).length;
if (!evCount) {
  bad("一条证据都没有");
  fix("Evidence 每条带 ISO 时间戳,写「观察到什么 / 实测值是什么」;没有实测值的猜测不算证据");
  pass = false;
}

// 5) 走到 diagnosed/fixing/resolved 就必须有根因;resolved 必须有验证方式
const res = section(bare, "Resolution");
const rv = (k) => res.match(new RegExp("^\\s*-\\s*" + k + "\\s*:\\s*(.*)$", "m"))?.[1]?.trim();
if (["diagnosed", "fixing", "resolved"].includes(f.status)) {
  if (PLACEHOLDER(rv("root_cause"))) { bad(`status=${f.status} 但 root_cause 没填`); fix("根因一句话写清;写不出就说明还没诊断完,status 该留在 diagnosing"); pass = false; }
}
if (f.status === "resolved") {
  for (const k of ["fix", "verification"]) {
    if (PLACEHOLDER(rv(k))) { bad(`status=resolved 但 ${k} 没填`); fix(`补 - ${k}: 写实际内容;「看起来好了」不算 verification`); pass = false; }
  }
}

if (!pass) {
  console.log("\n  不可继续 —— 门禁自带解法,照上面每条 → 改完重跑");
  process.exit(1);
}
ok(`复现 + 假设环 + ${evCount} 条证据齐全`);
const gate = f.status === "diagnosing" ? "可继续诊断" : "可转 mm-gsd-plan 出修复 PLAN";
ok(gate);
process.exit(0);
