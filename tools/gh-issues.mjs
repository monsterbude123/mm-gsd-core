// GitHub issue 往返 —— 从 mmc.mjs 拆出来的,理由写在这里:
// mmc.mjs 撞到 700 行单文件上限,而这两个命令是唯一依赖 gh 的功能,
// 和本地的门禁/预算检查不是一回事。混在一起时每加一条外部集成就要顶破上限。
//
// 依赖注入而非 import:输出函数(ok/bad/log)和路径常量由 mmc.mjs 传进来,
// 免得这里再 import 一遍 mmc.mjs 造成环。

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export function makeInboxClose({ ISSUES, GH_BIN, log, ok, bad, head, C }) {
  return {
    // 2.5) 拉取:使用方报上来的 issue → 本地 issue 文件,接进同一条修复流
    inbox(args) {
      head("②·½ inbox —— 拉取使用方报修");
      if (!GH_BIN) { bad("没有 gh 命令 —— 拉不了 GitHub issue"); log("    装:https://cli.github.com  或改用 mmc issue 手工记录"); return 1; }
      let raw;
      try {
        // 故意不按 label 过滤,只取 open。报修入口打的 label(mm-gsd-agent)和
        // 人工打的(mm-gsd)是两个值,按任一个过滤都会静默漏掉另一批 ——
        // "新落 0 条"看起来像没事,其实是没看见。宁可多拉(本地按 github: 去重)。
        raw = execFileSync(GH_BIN, ["issue", "list", "--state", "open",
          "--json", "number,title,body,url", "--limit", "50"], { encoding: "utf8", stdio: "pipe" });
      } catch (e) {
        bad("拉取失败:" + String(e.stderr || e.message).split("\n")[0]);
        log("    常见:没登录(gh auth login)、仓库地址不对");
        return 1;   // 拉不到就说拉不到 —— 假装「0 个待办」会让真问题被当成没有
      }
      let list;
      try { list = JSON.parse(raw); }
      catch { bad("gh 返回的不是合法 JSON,不敢当成空列表"); return 1; }
      if (!Array.isArray(list)) { bad("gh 返回的形状不对(应为数组)"); return 1; }

      mkdirSync(ISSUES, { recursive: true });
      let made = 0, skipped = 0;
      const remoteOf = new Set();
      for (const f of readdirSync(ISSUES)) {
        const m = readFileSync(join(ISSUES, f), "utf8").match(/^github:\s*#?(\d+)\s*$/m);
        if (m) remoteOf.add(m[1]);
      }
      for (const it of list) {
        if (remoteOf.has(String(it.number))) { skipped++; continue; }
        let seq = readdirSync(ISSUES).filter((x) => /^I-\d+\.md$/.test(x)).length + 1;
        let id = "I-" + String(seq).padStart(3, "0");
        while (existsSync(join(ISSUES, id + ".md"))) id = "I-" + String(++seq).padStart(3, "0");
        const body = String(it.body ?? "");
        // 证据提取:先找围栏块,再退到缩进块。都没有就写明"没提到"——
        // 静默填占位符会让 R-01 证据门禁对着一段假证据说"通过",比没导入更坏。
        let ev = "";
        const fence = body.match(/```[a-z]*\n([\s\S]*?)\n?```/);
        if (fence) ev = fence[1];
        else {
          const indented = body.split("\n").filter((l) => /^\s{2,}\S/.test(l));
          if (indented.length >= 2) ev = indented.join("\n");
        }
        if (!ev.trim()) ev = "!! 这个 issue 正文里没提取到证据 —— 补上复现命令或报错原文再修,否则 R-01 门禁会对着空证据说通过";
        writeFileSync(join(ISSUES, id + ".md"), [
          `# ${id} ${it.title}`, "", `github: #${it.number}`, `url: ${it.url}`, "",
          "## 状态", "", "open", "", "## 证据", "", "```", ev.trim(), "```", "",
          "## 来源", "", "使用方 agent 报修(via npx mm-gsd-core report)", "",
          "## 根因", "", "_(填完再定修复方案)_", "", "## 修复后要沉淀什么", "",
          "- [ ] 能门禁化吗?能就写 check 并挂进台账;不能就说明为什么。",
          "- [ ] 会不会让系统变大?会的话要等量删掉什么?", "",
        ].join("\n"));
        made++;
        ok(`${id} ← GitHub #${it.number} ${String(it.title).slice(0, 44)}`);
      }
      log(`\n  新落 ${made} 条,已在本地 ${skipped} 条${list.length ? "" : "(GitHub 上没有 open 的 issue)"}`);
      if (!made) log(`  ${C.d}没有新问题要处理${C.x}`);
      else log(`\n  下一步:mmc fix <id> 逐条修,或 mmc health 先确认全绿${C.x}`);
      return 0;
    },

    // 3.5) 关闭:本地修好了,把 GitHub 那条也关掉并说清怎么关的
    close(args) {
      head("③·½ close —— 关掉已修的 GitHub issue");
      const id = args.find((a) => !a.startsWith("--"));
      const all = args.includes("--all");
      if (!id && !all) { bad("用法:mmc close <id> | mmc close --all"); return 1; }
      if (!GH_BIN) { bad("没有 gh 命令 —— 关不了 GitHub issue"); return 1; }
      mkdirSync(ISSUES, { recursive: true });
      const todo = readdirSync(ISSUES)
        .map((f) => {
          const t = readFileSync(join(ISSUES, f), "utf8");
          const g = t.match(/^github:\s*#?(\d+)\s*$/m);
          return { f, id: f.replace(/\.md$/, ""), num: g?.[1], fixed: /^## 状态\s*\n\s*fixed/m.test(t) };
        })
        .filter((x) => x.num && x.fixed && (all || x.id === id));
      if (!todo.length) { bad(all ? "没有「已修好且来自 GitHub」的 issue —— 修完跑 mmc fix <id> 才会变 fixed" : `找不到 ${id}:要同时是 fixed 且带 github: 行`); return 1; }
      let closed = 0;
      for (const x of todo) {
        try {
          execFileSync(GH_BIN, ["issue", "close", String(x.num), "--comment",
            `已由 ${x.id} 修复并发布。\n\n---\n本条由 \`mmc inbox\` 拉取 → \`mmc fix\` 修复 → \`mmc close\` 关闭。若仍复现,带证据重开。`],
            { encoding: "utf8", stdio: "pipe" });
          const t = readFileSync(join(ISSUES, x.f), "utf8");
          writeFileSync(join(ISSUES, x.f), t.replace(/^## 状态\s*\n\s*fixed.*$/m, "## 状态\n\nclosed"));
          ok(`GitHub #${x.num} 已关闭(对应 ${x.id})`);
          closed++;
        } catch (e) {
          bad(`关 #${x.num} 失败:` + String(e.stderr || e.message).split("\n")[0]);
          log(`    ${C.d}本地 ${x.id} 仍是 fixed —— 别当成已闭环${C.x}`);
        }
      }
      return closed ? 0 : 1;
    },

  };
}
