#!/usr/bin/env node
// mm-gsd PreToolUse 守卫 —— 拦截越工作树的递归删除(I-020:验证代理 rm -rf /d/tmp 误删约 1800 文件的硬层防再犯)
//
// 为什么需要它:删除是唯一不可逆且无 git 兜底的操作类——pre-commit 与 gsd-state-check
// 都管不到这一层,危险发生在执行瞬间,必须在命令跑之前拦。
// 白名单两支柱(37-CONTEXT D-01):cwd 内删除放行(有 git 兜底),系统 Temp 内删除放行
// (探针卫生条款的合法自建区);越两支柱的 rm 递归族一律拦(exit 2 + 两段话术:为什么拦 + 合法出路)。
//
// 安装:由 mm-gsd-install.mjs 仿 guard-dangerous-git 的宿主矩阵分发到 ~/.agents/hooks/ 并接线
// 各宿主 hooks.events/settings 的 PreToolUse(matcher 按工具名枚举),装上即对本机所有项目生效。
//
// 契约:stdin 收事件 JSON(读 cwd 与 tool_input.command);exit 0 放行,exit 2 阻断
// (stdout 给 decision JSON,stderr 给人类可读理由)。
// fail-closed(37 预审 W6,对齐 guard-dangerous-git phase 11 D-04 先例):事件解析失败、
// 删除目标含未展开变量/通配符 —— 删除不可逆,误拦的代价是一条整改话术,
// 放行的代价是 I-020 重演,一律按拦截处理。
// 判定面首版只覆盖 rm 递归族(-r/-R/-rf 族/--recursive);PowerShell 原生删除族(Remove-Item/rd)
// 与非 rm 形态(find -delete/fs.rmSync)按 37-CONTEXT deferred 回流。

import { resolve, join, sep } from "node:path";
import { tmpdir, homedir } from "node:os";

const block = (reason) => {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.stderr.write(reason + "\n");
  process.exit(2);
};

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let cmd = "", evtCwd = "";
  try {
    const evt = JSON.parse(raw);
    cmd = String(evt.tool_input?.command || "");
    evtCwd = String(evt.cwd || "");
  } catch {
    block("mm-gsd:守卫无法解析本次事件 —— 解析失败按拦截处理(fail-closed)。若为宿主 hook 格式变更,请检查 guard-dangerous-rm.mjs 并临时停用后报修,不要永久绕过。");
  }
  if (cmd === "") process.exit(0);

  // cwd 源(37 预审 W3):事件 JSON 的 cwd 字段,缺失才回落 process.cwd()
  const cwd = resolve(evtCwd || process.cwd());
  const tmp = resolve(tmpdir());
  const home = homedir();

  // 分段 + 分词:引号内是一个词(带引号交付给剥引号);未加引号的 | ; & 是命令边界
  const tokenize = (s) => {
    const toks = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "|" || c === ";" || c === "&") { toks.push(null); i++; continue; }
      if (c === "'" || c === '"') {
        const e = s.indexOf(c, i + 1);
        const end = e === -1 ? s.length : e + 1;
        toks.push(s.slice(i, end));
        i = end;
        continue;
      }
      let j = i;
      while (j < s.length && !/\s/.test(s[j]) && !"'\"|;&".includes(s[j])) j++;
      toks.push(s.slice(i, j));
      i = j;
    }
    return toks;
  };

  // 未解析目标(37 预审 W6 fail-closed 的判定面):$变量 / ${} / %VAR% / glob 通配符 / 反引号替换
  const UNRESOLVED = new RegExp("[$?*\\[\\`]|%[^%]+%");
  const stripQuotes = (p) =>
    p.length >= 2 && ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) ? p.slice(1, -1) : p;
  // 目标归一(37 预审 W4):~ 展开 → MSYS 形归一(/d/x→盘符、/tmp→os.tmpdir(),仅 win32)→ resolve
  // (盘符大小写与正反斜杠交给 resolve + 比对期 fold 兜住)
  const msysExpand = (p) => {
    if (p === "~") return home;
    if (p.startsWith("~/") || p.startsWith("~\\")) return join(home, p.slice(2));
    if (process.platform !== "win32") return p;
    const mt = p.match(/^\/(?:tmp|var\/tmp|temp)(?:\/|$)/i);
    if (mt) return join(tmp, p.slice(mt[0].length));
    const md = p.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
    return md ? md[1].toUpperCase() + ":\\" + (md[2] || "") : p;
  };
  // 段感知的前缀比对(win32 比对期大小写折叠):D:\foo2 不算 D:\foo 之内
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  const inside = (t, d) => { const a = fold(t), b = fold(d); return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep); };
  const isRecursiveFlag = (f) =>
    f.startsWith("--") ? /^--recursive(=|$)/i.test(f) : /^-[^-]*$/.test(f) && /[rR]/.test(f);

  const offenders = [];
  let unresolved = false;
  const segs = [[]];
  for (const tok of tokenize(cmd)) { if (tok === null) segs.push([]); else segs[segs.length - 1].push(tok); }
  for (const seg of segs) {
    const idx = seg.indexOf("rm");
    if (idx < 0) continue;
    let afterDD = false;
    const flags = [], targets = [];
    for (const t of seg.slice(idx + 1)) {
      if (!afterDD && t.startsWith("-")) { if (t === "--") afterDD = true; else flags.push(t); }
      else targets.push(t);
    }
    if (!flags.some(isRecursiveFlag)) continue;   // 首版判定面:rm 递归族;非递归 rm 与其它命令零触碰
    for (const t of targets) {
      const p = stripQuotes(t);
      if (p === "" || UNRESOLVED.test(p)) { unresolved = true; continue; }
      const r = resolve(cwd, msysExpand(p));
      if (!inside(r, cwd) && !inside(r, tmp)) offenders.push(r);
    }
  }

  if (unresolved) {
    block("mm-gsd:已拦截含未解析变量/通配符的递归删除 —— 删除不可逆,解析失败按最坏情况处理(fail-closed)。\n合法出路:展开变量后用精确路径重试(先在 shell 里展开确认落点);探针/临时产物放进系统 Temp(os.tmpdir())前缀下再删。\n命令:" + cmd);
  }
  if (offenders.length) {
    block("mm-gsd:已拦截越工作树的递归删除(rm -r 族)。目标 " + offenders.join(", ") + " 既不在当前工作树内,也不在系统 Temp 内 —— 越树删除没有 git 兜底,误删无法恢复(I-020 曾因此误删约 1800 个文件)。\n合法出路:① 只删自己刚建的文件,逐条列出精确路径再执行;② 工作成果要暂存就提交到分支,不要依赖工作树外的目录;③ 探针/临时产物用系统 Temp 前缀存放与删除。\n命令:" + cmd);
  }
  process.exit(0);
});
