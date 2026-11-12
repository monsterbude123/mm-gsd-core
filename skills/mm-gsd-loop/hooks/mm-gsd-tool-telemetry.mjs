#!/usr/bin/env node
// mm-gsd 工具遥测 —— PreToolUse 纯观测器(REQ-18:子代理跑多久 / grep 了多少次 / 角色用了没)
//
// 与守卫(guard-dangerous-git,fail-closed exit 2 阻断)相反:本脚本只机械记录,
// **任何输入形状、任何异常都 exit 0**,stdout/stderr 永不出声 —— 记录器绝不影响
// 主代理与子代理的上下文(REQ-18 零污染;与守卫 fail-closed 方向相反,20-CONTEXT D-01)。
//
// 行 = {ts, cwd, tool, brief},brief 截 140;tool=Task **另加独立字段** subagent_type 与
// prompt_head(截 80)—— 组装顺序唯一(20-预审 F10):先组 brief,Task 行再加独立键,
// 不折进 brief,否则角色与 prompt 头会丢。tool=Bash 时 brief 取命令头(grep/rg 计数落点)。
//
// 日志:GSD_TOOL_TELEMETRY_PATH 可注入(测试钩子,先例 GSD_TELEMETRY_PATH,预审 F3),
// 缺省 ~/.agents/mm-gsd-tools.jsonl(与 checker 的 runs.jsonl 分文件,量级差一个数量级);
// 超 8MB 轮转 .old(只留一代),rename 失败(Windows 句柄/竞态)→ 放弃本次轮转照常追加
// (预审 F9,不阻断不截断);GSD_TOOL_TELEMETRY=0 全停。

import { appendFileSync, statSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    if (process.env.GSD_TOOL_TELEMETRY === "0") process.exit(0);   // 全停:零写入
    const ev = JSON.parse(raw);
    const tool = String(ev?.tool_name ?? "");
    if (!tool) process.exit(0);            // 认不出工具就不记,别往日志里写垃圾行
    const ti = ev?.tool_input ?? {};
    const s = (v) => String(v ?? "");
    // 字段组装顺序唯一(预审 F10):先组 brief(截 140),Task 行再另加独立键
    const brief = (tool === "Bash"
      ? s(ti.command)                                                  // 命令头(grep/rg 计数落点)
      : s(ti.file_path ?? ti.pattern ?? ti.description ?? ti.skill)    // 其余工具取主要参数
    ).trim().slice(0, 140);
    const row = { ts: new Date().toISOString(), cwd: s(ev.cwd), tool, brief };
    if (tool === "Task") {
      row.subagent_type = s(ti.subagent_type);
      row.prompt_head = s(ti.prompt).trim().slice(0, 80);   // 独立键,不折进 brief
    }
    const path = process.env.GSD_TOOL_TELEMETRY_PATH || join(homedir(), ".agents", "mm-gsd-tools.jsonl");
    try { if (statSync(path).size > 8 * 1024 * 1024) renameSync(path, path + ".old"); }
    catch {}   // 文件不存在(size 探不了)或 rename 被占用 → 放弃本次轮转,照常追加
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(row) + "\n");
  } catch {}   // 任何异常都吞掉:观测者没有资格让宿主的工具调用失败
  process.exit(0);
});
