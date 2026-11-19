// 模板脚本门禁(R-30):模板里的脚本必须真能跑,而不是「看着像对的」。
// 三条判据(每条都对应一次真实事故):
//   ① 内联 <script> 必须过 node --check —— 抓语法错(游离大括号会让整页 JS 死掉,页面永远停在「连接中…」)。
//   ② CSS 必须有显式隐藏 [hidden] 的 display:none 规则 —— 抓「作者样式压过 UA 的 [hidden]{display:none}」
//      (作者样式优先级高于 UA 样式,于是 hidden 的元素照样显示,顶栏永远压在内容上面)。
//   ③ 先声明、后引导:顶层裸调用必须排在所有顶层 const/let/class 声明之后 ——
//      抓「顶层调用早于声明」引发的 TDZ 崩溃(ReferenceError: Cannot access 'x' before initialization,
//      页面同样永远停在「连接中…」)。
// 扫描范围:skills/ 下全部 .html(核心与可选包一视同仁 —— 核心不认识任何包名);冻结基准快照排除(那是数据不是活模板)。
// 零依赖:只用 node: 内置模块。
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const FROZEN = /plan-review-fixtures[\\/]/;

// JS 关键字:行首是这些词的不是「裸调用」(是控制结构或声明)。
const KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "function", "return", "new", "typeof",
  "delete", "void", "await", "yield", "do", "else", "try", "throw", "class",
  "const", "let", "var", "import", "export", "case", "default", "in", "of",
]);

// 顶层声明行:顶格 + const/let/class 开头。
const DECL_RE = /^(?:const|let|class)\s+[A-Za-z_$]/;
// 顶层调用行:顶格 + 标识符紧跟左括号。
const CALL_RE = /^([A-Za-z_$][\w$]*)\s*\(/;
// 成员调用形态:标识符(...) 后面紧跟 "." —— 最外层是成员调用,不是裸调用。
const MEMBER_RE = /^[A-Za-z_$][\w$]*\([^()]*\)\s*\./;

function walkHtml(dir, out = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkHtml(p, out);
    else if (e.name.toLowerCase().endsWith(".html")) out.push(p);
  }
  return out;
}

/** 模板清单:skills 下全部 .html,排除冻结基准快照目录 */
export function collectTemplates({ skillsRoot }) {
  return walkHtml(skillsRoot)
    .filter((f) => !FROZEN.test(f))
    .map((file) => ({ file, rel: relative(skillsRoot, file).replace(/\\/g, "/") }));
}

/** 取内联脚本:返回 [{ code, isModule }];带 src 的外部脚本不在此列(单独处理) */
export function extractInlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] ?? "";
    const code = m[2] ?? "";
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (type && !/^(?:module|text\/javascript|application\/javascript|javascript)$/i.test(type)) continue;
    if (!code.trim()) continue;
    out.push({ code, isModule: /module/i.test(type || "") });
  }
  return out;
}

/** 外部脚本:带 src= 的 <script>,返回 [{ src, resolved }](相对模板目录解析) */
function extractExternalScripts(html, templateDir) {
  const out = [];
  const re = /<script\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] ?? "";
    const src = (attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!src) continue;
    if (/^(?:https?:)?\/\//i.test(src)) continue; // 外部 CDN:本仓管不了
    out.push({ src, resolved: resolve(templateDir, src) });
  }
  return out;
}

/** 顶层结构扫描:返回 { decls: [{line,name}], calls: [{line,name}] } */
export function scanTopLevel(code) {
  const lines = code.split("\n");
  const decls = [];
  const calls = [];
  lines.forEach((raw, i) => {
    if (!raw || /^\s/.test(raw)) return; // 顶格才算顶层(本仓缩进两格,嵌套语句必缩进)
    const line = raw.trim();
    const d = line.match(DECL_RE);
    if (d) {
      const name = (line.match(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/) || [])[1] || "";
      decls.push({ line: i + 1, name });
      return;
    }
    const c = line.match(CALL_RE);
    if (!c) return;
    const ident = c[1];
    if (KEYWORDS.has(ident)) return;
    if (MEMBER_RE.test(line)) return; // 最外层是成员调用
    calls.push({ line: i + 1, name: ident, text: line.slice(0, 80) });
  });
  return { decls, calls };
}

/** 判据二:CSS 里必须有显式隐藏 [hidden] 的规则 */
export function checkHiddenRule(css) {
  const blocks = css.match(/([^{}]+)\{([^{}]*)\}/g) || [];
  for (const b of blocks) {
    const i = b.indexOf("{");
    const selector = b.slice(0, i);
    const body = b.slice(i + 1, b.lastIndexOf("}"));
    if (!selector.includes("[hidden]")) continue;
    if (/display\s*:\s*none/i.test(body)) return null;
  }
  return "CSS 里没有显式隐藏 [hidden] 元素的规则 —— 作者样式会压过 UA 的 [hidden]{display:none},被 hidden 的视图照样显示";
}

/** 一份模板的判据:返回问题数组 [{ rule, message }] */
export function checkTemplate(file, html) {
  const problems = [];
  const scripts = extractInlineScripts(html);
  const dir = file.replace(/[\\/][^\\/]+$/, "");
  for (const s of extractExternalScripts(html, dir)) {
    if (!existsSync(s.resolved)) problems.push({ rule: 3, message: "模板引用的脚本文件不存在:" + s.src });
    else if (s.resolved.toLowerCase().endsWith(".js")) {
      const r = nodeCheck(s.resolved);
      if (r) problems.push({ rule: 1, message: "外部脚本语法错(" + s.src + "):" + r });
    }
  }
  const tmp = mkdtempSync(join(tmpdir(), "mm-gsd-webgate-"));
  try {
    scripts.forEach((s, i) => {
      const p = join(tmp, "inline-" + i + (s.isModule ? ".mjs" : ".js"));
      writeFileSync(p, s.code, "utf8");
      const r = nodeCheck(p);
      if (r) problems.push({ rule: 1, message: "第 " + (i + 1) + " 段内联脚本语法错:" + r });
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (scripts.length) {
    for (const s of scripts) {
      const { decls, calls } = scanTopLevel(s.code);
      const lastDecl = decls.length ? decls[decls.length - 1].line : 0;
      for (const c of calls) {
        if (c.line < lastDecl) {
          problems.push({
            rule: 3,
            message:
              "顶层调用 " + c.name + "(...) 在第 " + c.line + " 行,早于第 " + lastDecl + " 行的顶层声明 —— " +
              "顶层调用先于 const/let/class 声明执行会踩 TDZ(ReferenceError: Cannot access ... before initialization),脚本整体死掉",
          });
          break;
        }
      }
    }
  }
  const css = (html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) || [])
    .map((b) => b.replace(/<\/?style[^>]*>/gi, ""))
    .join("\n");
  if (css) {
    const msg = checkHiddenRule(css);
    if (msg) problems.push({ rule: 2, message: msg });
  }
  return problems;
}

/** node --check:通过返回 null,失败返回错误摘要 */
function nodeCheck(file) {
  try {
    execFileSync(process.execPath, ["--check", file], { encoding: "utf8", stdio: "pipe" });
    return null;
  } catch (e) {
    const err = String(e.stderr || e.message || "");
    const first = err.split("\n").filter((l) => l.trim()).slice(0, 3).join(" | ");
    return first || "node --check 失败";
  }
}

/** 判定入口:扫描 skills 下全部模板 */
export function checkWebTemplateJs({ skillsRoot }) {
  const problems = [];
  for (const t of collectTemplates({ skillsRoot })) {
    let html = "";
    try { html = readFileSync(t.file, "utf8"); } catch { continue; }
    for (const p of checkTemplate(t.file, html)) {
      problems.push({ file: t.rel, rule: p.rule, message: p.message });
    }
  }
  return problems;
}

/** mmc health 的接线入口 */
export function checkWebTemplateJsAll({ root, report }) {
  const problems = checkWebTemplateJs({ skillsRoot: join(root, "skills") });
  for (const p of problems) report.fail("[" + p.rule + "] " + p.file + ": " + p.message);
  if (!problems.length) report.pass("模板脚本能跑(语法过 + hidden 显式隐藏 + 先声明后引导)");
  return problems.length === 0;
}
