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

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = String(JSON.parse(raw).tool_input?.command || "");
  } catch {
    process.exit(0); // 事件不是预期形状 → 永不阻断(守卫不能验时不该回答"危险")
  }
  if (cmd === "") process.exit(0);

  // 逐条对应 mm-gsd-exec「git 纪律」;命令串在 | ; && 之后的部分不算
  const DANGEROUS = [
    { re: /\bgit\s+reset\b(?![^|;&]*--soft)[^|;&]*--hard/i, why: "会丢弃未提交的工作。确认要丢再用,或用 git stash / git diff 先保住。" },
    { re: /\bgit\s+clean\b[^|;&]*\s-[a-z]*f/i, why: "会删除未跟踪文件——在共享 worktree 里可能删掉别人的东西(绝不要在 worktree 内用)。" },
    { re: /\bgit\s+stash\b[^|;&]*\b(drop|clear)\b/i, why: "refs/stash 跨 worktree 共享,drop 会清掉兄弟会话的 WIP。要存 WIP 用分支,不要用 stash。" },
    { re: /\bgit\s+push\b[^|;&]*(--force\b(?!-with-lease)|-f\b)/i, why: "强推会覆盖远端他人提交;除非明确知道在做什么,否则用 --force-with-lease 或先 pull。" },
    { re: /\bgit\s+(branch\s+-D|update-ref\s+-d)\b/i, why: "会不可逆删除分支/引用。确认该分支已合并或已备份再删。" },
    { re: /\bgit\s+(checkout|restore)\b[^|;&]*\s\.\s*($|[|;&])/i, why: "全量重置工作区,会丢掉所有未提交改动。逐文件恢复,或先 stash。" },
  ];

  const hit = DANGEROUS.find((d) => d.re.test(cmd));
  if (!hit) process.exit(0);

  const reason = `mm-gsd:已拦截破坏性 git 命令。${hit.why}\n命令:${cmd}`;
  // 宿主契约:stdout 给决策 JSON,stderr 给理由,exit 2 = 阻断
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.stderr.write(reason + "\n");
  process.exit(2);
});
