// context-pack —— 静态接口预打包(D-03/REQ-77,兑现 R-21「探索外包 + 必读压薄」)
//
// 读目标源文件的顶层 export 声明与 interface/type 契约,渲染紧凑 <interfaces> 块:
// 每条带 file:line 锚点。规划端把输出贴进 PLAN,Worker 按锚点直取签名,不为找接口通读整文件。
//
//   mm-gsd context-pack <file...>        # bin 转发;路径相对 cwd
//   node context-pack.mjs --selftest     # 解析器自测(解析器基础设施自带自测,AGENTS 造门禁判据)
//
// 零依赖正则词法截取,不引入 TS Parser([AUTO] 守 R-06)。shortcut: 只认零缩进行 = 顶层声明,
// 字符串/模板字面量里的同名行不识别 —— 预打包是摘要器不是编译器,锚点在,细节按行号回原文件取。
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_SIG = 140;      // 单条签名渲染宽度,超长截断(行号锚点在,细节自己取)
const MAX_SIG_LINES = 6;  // 多行签名最多拼接的物理行数(数组/对象大字面量不整收)
const MAX_BLOCK = 8;      // interface/type 块内联上限,超出只留头行 + 行距提示

// 零缩进顶层的 export 声明(函数/类/变量)
const EXPORT_DECL = /^export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?|abstract\s+class|class|const|let|var)\s*([A-Za-z_$][\w$]*)?/;
// 零缩进顶层的类型契约(export 与否都收 —— dwf.ts 这类宿主契约文件的内聚 interface 也是接口)
const TYPE_DECL = /^(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:interface|enum|type)\s+[A-Za-z_$][\w$]*/;
// 整行 re-export / 命名导出清单
const EXPORT_LIST = /^export\s*(?:type\s*)?\{/;
const EXPORT_DEFAULT = /^export\s+default\b/;

const isCode = (l) => { const t = l.trim(); return t !== "" && !/^(\/\/|\*|\/\*)/.test(t); };

const oneLine = (s) => { const t = String(s).replace(/\s+/g, " ").trim(); return t.length > MAX_SIG ? t.slice(0, MAX_SIG - 1) + "…" : t; };

// 从第 i 行(0 基)拼一条声明签名:到出现 { / ; / => 的行为止(签名在此结束,函数体不收)
function sigLines(lines, i) {
  const out = [];
  for (let j = i; j < lines.length && out.length < MAX_SIG_LINES; j++) {
    const l = lines[j].trim();
    if (!isCode(l)) continue;
    out.push(l);
    if (/[{;]\s*$|=>\s*$/.test(l)) break;
  }
  return out.join(" ");
}

// interface/type/enum 块:从第 i 行数大括号回零;≤MAX_BLOCK 个有效行整块收,
// 超出只留头行 + 行距提示;纯注释行不收
function blockLines(lines, i) {
  let depth = 0, started = false, end = i;
  for (let j = i; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (ch === "{") { depth++; started = true; }
      else if (ch === "}") depth--;
    }
    end = j;
    if (started && depth <= 0) break;
    if (!started && /;\s*$/.test(lines[j])) break;   // type X = string; 单行收束
  }
  const span = [];
  for (let j = i; j <= end; j++) if (isCode(lines[j])) span.push({ line: j + 1, text: lines[j].trim() });
  if (span.length <= MAX_BLOCK) return span;
  return [span[0], { line: span[0].line, text: `// …(${span.length} 行,至 L${end + 1},全文按锚点取)` }];
}

/** 提取一份源码文本的接口清单;每条 { line(1 基), kind: "sig"|"type", sig } */
export function extractInterfaces(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (TYPE_DECL.test(l)) {
      if (l.includes("{")) out.push(...blockLines(lines, i).map((e) => ({ line: e.line, kind: "type", sig: oneLine(e.text) })));
      else out.push({ line: i + 1, kind: "type", sig: oneLine(sigLines(lines, i)) });   // type 别名/并集:拼到 ; 一条收
      continue;
    }
    if (EXPORT_DECL.test(l) || EXPORT_DEFAULT.test(l)) out.push({ line: i + 1, kind: "sig", sig: oneLine(sigLines(lines, i)) });
    else if (EXPORT_LIST.test(l)) out.push({ line: i + 1, kind: "sig", sig: oneLine(l) });
  }
  return out;
}

/** 渲染紧凑 <interfaces> 块;paths 相对 root(缺省 cwd)取相对路径做节标题。目标缺失抛错(不静默空过) */
export function packFiles(paths, root = process.cwd()) {
  const list = paths.map(String).filter(Boolean);
  if (!list.length) throw new Error("context-pack:没有给目标文件");
  const missing = list.filter((p) => !existsSync(resolve(root, p)));
  if (missing.length) throw new Error("context-pack:目标文件不存在 —— " + missing.join(", "));
  const secs = list.map((p) => {
    const abs = resolve(root, p);
    const rel = relative(root, abs).replace(/\\/g, "/") || p;
    const body = extractInterfaces(readFileSync(abs, "utf8")).map((e) => `L${e.line} ${e.sig}`).join("\n");
    return `## ${rel}\n${body || "// (未发现顶层 export / interface / type)"}`;
  });
  return `<interfaces>\n${secs.join("\n\n")}\n</interfaces>\n`;
}

/** 自测(解析器基础设施自带自测):断言式,失败抛错,返回断言数 */
export function selfTest() {
  let n = 0;
  const eq = (a, b, msg) => { n++; if (a !== b) throw new Error(`selftest 失败: ${msg}\n  期望 ${JSON.stringify(b)}\n  实得 ${JSON.stringify(a)}`); };
  const ok = (v, msg) => { n++; if (!v) throw new Error("selftest 失败: " + msg); };
  const big = Array.from({ length: 14 }, (_, k) => `  f${k}: number;`);
  const src = [
    "/** 头注释不算 */",
    "export const SSOT_SCHEMA = 1;",
    "",
    "export function contentSha(",
    "  text,",
    ") {",
    "  return 1;",
    "}",
    "",
    "const local = 2;                  // 非 export 常量不收",
    "  interface Nested { x: number }  // 缩进的嵌套类型不收",
    "",
    "export interface Plan {",
    "  id: string;",
    "  tasks: Task[];",
    "}",
    "",
    "export type Verdict =",
    '  "passed" | "failed";',
    "",
    'export { parseReqLedger } from "./req-ledger.mjs";',
    "export interface Big {",
    ...big,
    "}",
  ].join("\n");
  const got = extractInterfaces(src);
  const sigAt = (ln) => got.find((g) => g.line === ln)?.sig ?? "";
  eq(sigAt(2), "export const SSOT_SCHEMA = 1;", "export const 单行");
  ok(sigAt(4).startsWith("export function contentSha( text, ) {"), "多行签名拼到 { 收束");
  ok(!got.some((g) => g.sig.includes("local") || g.sig.includes("Nested")), "非 export 常量与嵌套 interface 不收");
  eq(sigAt(13), "export interface Plan {", "短 interface 块头行锚点");
  eq(sigAt(14), "id: string;", "块内字段行锚点");
  eq(sigAt(18), 'export type Verdict = "passed" | "failed";', "跨行 type 并集拼到 ; 收束");
  eq(sigAt(21), 'export { parseReqLedger } from "./req-ledger.mjs";', "整行 re-export");
  eq(sigAt(22), "export interface Big {", "大块只留头行");
  ok(got.some((g) => g.sig.startsWith("// …(") && g.sig.includes("至 L" + (22 + big.length + 1))), "大块行距提示");
  return n;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    try { console.log(`✓ context-pack 自测 ${selfTest()} 条断言全过`); process.exit(0); }
    catch (e) { console.error(e.message); process.exit(1); }
  }
  const files = args.filter((a) => !a.startsWith("-"));
  if (!files.length) { console.error("用法:node context-pack.mjs <file...>(相对 cwd;或 --selftest)"); process.exit(1); }
  try { process.stdout.write(packFiles(files)); } catch (e) { console.error(e.message); process.exit(1); }
}
