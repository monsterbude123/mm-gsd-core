#!/usr/bin/env node
// mm-gsd PreToolUse 守卫 —— 拦截破坏性 git 命令(exec 技能那串禁令的机器化)
//
// 为什么需要它:pre-commit 和 gsd-state-check 都管不到这一层——
// 这些命令根本不该被执行(git clean -f 会删掉别的 worktree 的文件、reset --hard 丢工作),
// 而不是"提交了错的工件"。危险发生在执行瞬间,必须在命令跑之前拦。
//
// 安装(用户级,影响本机所有项目;先看 loop/SKILL.md「宿主 hook」一节的选择题):
//   把本文件放到 ~/.zcode/hooks/guard-dangerous-git.mjs,然后合并进
//   ~/.zcode/cli/config.json 的 hooks.events.PreToolUse(matcher "Bash"),并确保 hooks.enabled: true。
//
// 契约:stdin 收事件 JSON(读 tool_input.command);exit 0 放行,exit 2 阻断
// (stdout 给 decision JSON,stderr 给人类可读理由)。
// fail-closed(phase 11 D-04):解析失败按拦截处理 —— 守卫失效的时刻恰是危险命令穿过的时刻,
// 「不能验证」不能当「不危险」。

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = String(JSON.parse(raw).tool_input?.command || "");
  } catch {
    const reason = "mm-gsd:守卫无法解析本次事件 —— 解析失败按拦截处理(fail-closed,phase 11 D-04)。若为宿主 hook 格式变更,请检查 guard-dangerous-git.mjs 并临时停用后报修,不要永久绕过。";
    process.stdout.write(JSON.stringify({ decision: "block", reason }));
    process.stderr.write(reason + "\n");
    process.exit(2);
  }
  if (cmd === "") process.exit(0);

  // 逐条对应 mm-gsd-exec「git 纪律」;命令串在 | ; && 之后的部分不算
  const DANGEROUS = [
    { re: /\bgit\s+reset\b(?![^|;&]*--soft)[^|;&]*--hard/i, why: "会丢弃未提交的工作。确认要丢再用,或用 git stash / git diff 先保住。" },
    { re: /\bgit\s+clean\b[^|;&]*\s-[a-z]*f/i, why: "会删除未跟踪文件——在共享 worktree 里可能删掉别人的东西(绝不要在 worktree 内用)。" },
    { re: /\bgit\s+stash\b/i, why: "refs/stash 跨 worktree 共享,stash 全族(push/pop/apply/drop/clear)都可能搅乱兄弟会话的 WIP。要存 WIP 用分支,不要用 stash。" },
    { re: /\bgit\s+push\b[^|;&]*(--force\b(?!-with-lease)|-f\b)/i, why: "强推会覆盖远端他人提交;除非明确知道在做什么,否则用 --force-with-lease 或先 pull。" },
    { re: /\bgit\s+(branch\s+-D|update-ref\s+-d)\b/i, why: "会不可逆删除分支/引用。确认该分支已合并或已备份再删。" },
    { re: /\bgit\s+(checkout|restore)\b[^|;&]*\s\.\s*($|[|;&])/i, why: "全量重置工作区,会丢掉所有未提交改动。逐文件恢复,或先 stash。" },
    { re: /\bgit\s+checkout\s+(-f|--force)\b/i, why: "强检出会丢掉工作区未提交改动。逐文件恢复,或先备份再切。" },
    { re: /\bgit\s+switch\b[^|;&]*--discard-changes/i, why: "--discard-changes 会丢未提交改动。先备份再切。" },
  ];
  // 推保护分支(phase 16 D-01):refspec 尾段精确匹配 main/master/develop(dev/main-x、develop-feature 不误伤);
  // --force-with-lease 是 SKILL 推荐的出路,不拦(预审 F3)。
  const pushProtected = (v) => {
    const i = v.toLowerCase().indexOf("push");
    if (i < 0) return false;
    const seg = v.slice(i + 4);
    if (/--force-with-lease/i.test(seg)) return false;
    return /(?:^|[\s:'"\/])(?:main|master|develop)(?=["'\s]|$)/i.test(seg);
  };

  // -C 归一化(phase 16 D-01,预审 F1):循环剥离 -C 全部词法形式 —— 引号含空格路径 / 带空格 / 无空格紧贴 ——
  // 每剥一次得一个测试副本,全部正则对原始命令与每个副本各测一次(变体绕过的解法是归一化输入,不是枚举变体)。
  const variants = [cmd];
  const strip = /-C\s*(?:"[^"]*"|\S+)\s*/gi;
  let mm;
  while ((mm = strip.exec(cmd)) !== null) variants.push(cmd.replace(mm[0], " "));
  variants.push(cmd.replace(strip, " "));

  const hitWhy = (v) => {
    const d = DANGEROUS.find((x) => x.re.test(v));
    if (d) return d.why;
    if (pushProtected(v)) return "直接推保护分支(main/master/develop)会绕过共享历史的评审闸。推特性分支;确需改写共享历史用 --force-with-lease 并由人确认。";
    return null;
  };
  let why = null;
  for (const v of variants) { why = hitWhy(v); if (why) break; }
  if (!why) process.exit(0);

  const reason = `mm-gsd:已拦截破坏性 git 命令。${why}\n命令:${cmd}`;
  // 宿主契约:stdout 给决策 JSON,stderr 给理由,exit 2 = 阻断
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.stderr.write(reason + "\n");
  process.exit(2);
});
