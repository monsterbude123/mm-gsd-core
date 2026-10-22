// 发布与晋级 —— mm-gsd-core 自己的发版通道。
//
// 为什么独立成文件:mmc.mjs 顶过 700 上限两次(本仓先例:gh-issues.mjs、rule-baseline.mjs
// 都是顶破时抽出去的)。phase 03 要加 promote 与标签时效门禁,主文件放不下 ——
// 就地扩是那条路的终点。
//
// 三个角色:
//   release  发版:门禁 → 版本 → 提交打标签 → npm publish → 钉 next → 推 git → 从 npm 装回来
//   promote  晋级:把某个已发布版本钉到 latest(秒级,不重新构建、不重跑发布链)
//   checkTags 标签时效门禁:预发布通道不得比正式通道旧 —— 通道腐烂的唯一方式
//
// 两条通道各给谁用(03-CONTEXT D-01/D-02):
//   latest 给不想读文档的人(默认,必须指向最稳那条)
//   next   给要新功能的人(刚发出来的那份)
// 回退走 git revert + 重发,先落 next 自测、确认无误再转 latest —— 没有「该不该退」的
// 判据之前不接自动回退(那是在用不可靠的判断保护不可逆的动作)。

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOME_SKILLS = join(homedir(), ".agents", "skills");
const MANIFEST_NAME = ".mm-gsd-install.json";
const readJSON = (p, fallback) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; } };

/**
 * 版本号比较:返回 -1 / 0 / 1。
 *
 * 带预发布后缀时 0.5.0-rc.1 < 0.5.0(semver 口径)。
 * 不用字符串比较:字符串会把 "0.10.0" 判成小于 "0.9.0"。
 */
export function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre] = String(v ?? "").trim().replace(/^v/, "").split("-");
    const nums = core.split(".").map((n) => Number(n) || 0);
    return { nums, pre: pre ?? "" };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;          // 正式版 > 同号预发布版
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

/**
 * 标签结论(纯函数,可离线判):
 *   error —— 预发布通道比正式通道旧:通道在腐烂
 *   warn  —— 通道还没建 / 读不到正式通道:判不了,但不判红
 *   pass  —— 通道正常
 */
export function tagsVerdict({ next, latest } = {}) {
  if (!next) return { level: "warn", message: "预发布通道(next)还没建 —— 第一次 mmc release 后自动建立" };
  if (!latest) return { level: "warn", message: "正式通道(latest)读不到 —— 判不了通道有没有在腐烂" };
  const c = compareVersions(next, latest);
  if (c < 0) return { level: "error", message: `预发布通道(next=${next})比正式通道(latest=${latest})旧 —— 通道在腐烂` };
  return { level: "pass", message: `通道正常(next=${next} ≥ latest=${latest})` };
}

/**
 * 读 npm 上的 dist-tags。查不到就说查不到 ——
 * **不能**把「查不到」当成「标签没问题」(那是假绿)。
 */
export function readDistTags(pkg, exec = execFileSync) {
  try {
    const out = exec("npm.cmd", ["view", pkg, "dist-tags", "--json"], { encoding: "utf8", shell: true, stdio: "pipe" });
    return { ok: true, tags: JSON.parse(out) };
  } catch (e) {
    return { ok: false, tags: {}, error: String(e.stderr || e.message).split("\n")[0] };
  }
}

/** 判定一段结果并汇报。单独抽出来:自证要拿它跑一遍假标签,证明整条路径都会红 */
function reportTags(report, pkg, live) {
  if (!live.ok) { report.info(`查不到 ${pkg} 在 npm 上的 dist-tags(${live.error})—— 没核对,不判红`); return true; }
  const v = tagsVerdict({ next: live.tags.next, latest: live.tags.latest });
  if (v.level === "error") { report.fail(v.message); return false; }
  if (v.level === "warn") { report.info(v.message); return true; }
  report.pass(v.message);
  return true;
}

/**
 * 标签时效门禁:预发布通道不得比正式通道旧。
 * 查不到 npm 时判「没核对」而不是判红(照 R-17 的先例:外部依赖不在时不能判红);
 * 通道还没建时也只警告 —— 第一次 release 之前整仓恒红,那是墙不是门(T-13)。
 *
 * @param readTags 读标签的方式(自测时注入假的)
 */
export function checkTags(report, readTags = readDistTags) {
  const pkg = readJSON(join(ROOT, "package.json"), {}).name;
  // 自证会红:用一对假标签(正式通道比预发布通道新)跑一遍**整条判定路径**,
  // 确认它真的给出 error 级结论。门禁自己不会红,就没有人知道它坏了
  // (check-report-fails-loud 的先例)。
  const fake = { pass: () => {}, fail: (m) => fake.fails.push(m), info: () => {}, fails: [] };
  const red = reportTags(fake, pkg, { ok: true, tags: { next: "0.0.1", latest: "9.9.9" } });
  if (red !== false || !fake.fails.length) {
    report.fail("标签门禁自证失败:喂 next=0.0.1/latest=9.9.9 竟没判红 —— 判定逻辑坏了");
    return false;
  }
  report.info("标签门自证会红(喂 next=0.0.1/latest=9.9.9 → 判红)");
  return reportTags(report, pkg, readTags(pkg));
}

/**
 * 造命令组。log 工具由调用方注入 —— 本模块不自己决定怎么显示。
 *
 * exec / readTags 只给 promote 用:门禁要能断言「默认路径真的没碰 registry」,
 * 而不碰 registry 正是可判事实(有没有发出过 dist-tag add)。不注入就没法在
 * 隔离环境里证它 —— 只能拿真 registry 去试,那等于用公开标签做实验。
 */
export function makeReleaseFlow({ log, ok, bad, warn, head, C, health, exec = execFileSync, readTags = readDistTags }) {
  return {
    // 发版。顺序有讲究 —— 先发 npm,再从 npm 装回来,
    // 这样「装出去的那份」和「发出去的那份」是同一份,不会出现本地改了没发的情况。
    async release(args) {
      head("release —— 发布部署");
      const pkgPath = join(ROOT, "package.json");
      const pkg = readJSON(pkgPath, {});
      const bump = args.includes("--patch") ? "patch" : args.includes("--minor") ? "minor" : args.includes("--major") ? "major" : null;
      const explicit = args.find((a) => /^\d+\.\d+\.\d+/.test(a));
      // 认不出来的参数必须当场说。`release --bump patch` 曾被静默忽略,
      // 拿旧版本号去发布 —— 用户以为在升版本,实际发布的是上一次的版本(T-09 同族)。
      const known = new Set(["--patch", "--minor", "--major"]);
      const junk = args.filter((a) => !known.has(a) && !/^\d+\.\d+\.\d+/.test(a));
      if (junk.length) { bad("不认识的参数:" + junk.join(" ") + "\n      合法:--patch / --minor / --major / 显式版本号"); return 1; }
      if (!bump && !explicit) { bad("没说升哪个版本 —— 加 --patch / --minor / --major,或直接给版本号"); return 1; }

      // 1) 门禁必须全绿 —— 不绿就不许发
      log("  1/7 跑门禁");
      if ((await health()) !== 0) { bad("门禁没过,不发布"); return 1; }

      // 2) 版本
      let version = pkg.version;
      if (explicit) version = explicit.replace(/^v/, "");
      else if (bump) {
        const [ma, mi, pa] = version.split(".").map(Number);
        version = bump === "major" ? ma + 1 + ".0.0" : bump === "minor" ? ma + "." + (mi + 1) + ".0" : ma + "." + mi + "." + (pa + 1);
      }
      if (version !== pkg.version) {
        pkg.version = version;
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
        log("  2/7 版本 " + pkg.version + " → " + version);
      } else log("  2/7 版本 " + version + "(未变)");

      // 3) 提交 + 打标签
      log("  3/7 提交与打标签");
      const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim();
      if (dirty) {
        try {
          execFileSync("git", ["add", "-A"], { cwd: ROOT, stdio: "pipe" });
          execFileSync("git", ["commit", "-m", "release: v" + version], { cwd: ROOT, stdio: "pipe" });
          log("      已提交改动");
        } catch (e) { bad("提交失败:" + String(e.stderr || e.message).split("\n")[0]); return 1; }
      } else log("      工作区干净");
      try { execFileSync("git", ["tag", "-f", "v" + version], { cwd: ROOT, stdio: "pipe" }); log("      已打标签 v" + version); }
      catch { log("      标签 v" + version + " 已存在"); }

      // 4) 发 npm
      log("  4/7 发布到 npm");
      try {
        const out = execFileSync("npm", ["publish", "--access", "public"], { cwd: ROOT, encoding: "utf8", stdio: "pipe", shell: process.platform === "win32" });
        log("      " + out.split("\n").filter((l) => l.includes("+")).join(" ").trim());
      } catch (e) {
        bad("npm publish 失败:\n" + String(e.stdout || "") + String(e.stderr || e.message));
        log("      常见原因:账号未开 2FA 且 token 没有 bypass 2FA 权限(见 README「发布」)");
        return 1;
      }

      // 5) 钉预发布通道 next —— 刚发出去的那份先落在 next 上:
      //    要新功能的人装 next 就拿到,latest 一点不动(它是给不想读文档的人的默认)。
      log("  5/7 钉到预发布通道 next");
      try {
        execFileSync("npm.cmd", ["dist-tag", "add", pkg.name + "@" + version, "next"], { encoding: "utf8", shell: true, stdio: "pipe" });
        ok("next → " + version);
      } catch (e) {
        bad("钉 next 失败:" + String(e.stderr || e.message).split("\n")[0]);
        log("      版本已经发出去了,但 next 没钉上 —— 补一次:mmc promote " + version + " --channel next --execute");
        return 1;
      }

      // 6) 推 git
      log("  6/7 推送 GitHub");
      try {
        execFileSync("git", ["push", "origin", "main", "--follow-tags"], { cwd: ROOT, stdio: "pipe" });
        ok("已推送 main 与标签");
      } catch (e) { bad("git push 失败:" + String(e.stderr || e.message).split("\n")[0]); return 1; }

      // 7) 从 npm 装回来 —— 必须是 registry 上那一份,不是仓库里那份
      //    npm publish 返回 ≠ 版本已可装:npm 有传播延迟,而且 staged publish 会留占位。
      //    拿仓库副本装回来并写上 npm 来源,是这条注释曾经描述、代码却没做的假绿(T-07)。
      log("  7/7 从 npm 装回本机");
      const spec = pkg.name + "@" + version;
      // npm 有传播延迟:实测 60-96 秒才可见。查一次就判失败,会让每次发布
      // 都停在第 7 步,逼人手工补 —— 那等于把门禁写成了障碍。轮询到耗尽才判,
      // 而耗尽之后还红,那才是真的没发出去。
      let live = "";
      for (let i = 0; i < 12; i++) {
        try { live = execFileSync("npm.cmd", ["view", spec, "version"], { encoding: "utf8", shell: true, stdio: "pipe" }).trim(); }
        catch { live = ""; /* 版本不存在时 npm 直接非零退出,不是返回空串 */ }
        if (live === version) break;
        if (i) log(`      registry 还没同步(第 ${i} 次)…… 再等 30s`);
        else log("      registry 还没同步,等它生效(最长 6 分钟)");
        try { execFileSync(process.execPath, ["-e", "setTimeout(()=>{},30000)"], { stdio: "ignore" }); } catch {}
      }
      if (live !== version) { bad(`registry 上 ${spec} 查不到(轮询 6 分钟仍未见)—— 发出去的没生效,别信 publish 那行 "+name@version"`); return 1; }
      const sb = join(tmpdir(), "mmc-release-inst");
      rmSync(sb, { recursive: true, force: true });
      try {
        execFileSync("npm.cmd", ["install", "--prefix", sb, "--no-audit", "--no-fund", spec], { encoding: "utf8", shell: true, stdio: "pipe", timeout: 180000 });
        execFileSync(process.execPath, [join(sb, "node_modules", pkg.name, "bin", "mm-gsd.mjs"), "install"], { encoding: "utf8", stdio: "pipe" });
        const mf = JSON.parse(readFileSync(join(HOME_SKILLS, MANIFEST_NAME), "utf8"));
        if (mf.source !== "npm:" + spec) { bad(`装回来的来源是 ${mf.source},不是 npm —— 装错了东西`); return 1; }
        ok(`本机 ~/.agents/skills/ 已更新到 ${version}(来源已核对:${mf.source})`);
      } catch (e) {
        bad("装回本机失败:" + String(e.stdout || "") + String(e.stderr || e.message).split("\n")[0]);
        log("      npm 上已经有了,本机没更新 —— 下次 mmc sync 会补上");
        return 1;
      } finally { rmSync(sb, { recursive: true, force: true }); }

      log("");
      ok("v" + version + " 发布完成");
      log("  npm:      npx mm-gsd-core@" + version);
      log("  预发布:   npx mm-gsd-core@next(钉在 next 上,latest 未动)");
      log("  GitHub:   https://github.com/monsterbude123/mm-gsd-core/releases/tag/v" + version);
      log("");
      return 0;
    },

    // 晋级:把某个已发布版本钉到正式通道 latest。秒级 —— 不重新构建、不重跑发布链。
    //
    // **默认只演练**:改 npm 的标签是外部副作用(拍板权第 3 类),工具不该自己按下扳机 ——
    // 「批 promote」是人保留的动作(03-CONTEXT D-04)。真要改必须显式 --execute。
    // (曾经写成「带 --dry-run 才演练」,于是默认路径直接改公开的 registry ——
    //  探针在隔离环境里抓到:不带参数就真的发了 dist-tag add。计划里写的是默认演练。)
    async promote(args) {
      head("promote —— 把已发布版本晋级到正式通道(latest)");
      const version = args.find((a) => /^\d+\.\d+\.\d+/.test(a));
      const really = args.includes("--execute") || args.includes("--yes");
      const channel = args.includes("--channel") ? "next" : "latest";
      const junk = args.filter((a) => !["--dry-run", "--execute", "--yes", "--channel"].includes(a) && !/^\d+\.\d+\.\d+/.test(a));
      if (junk.length) { bad("不认识的参数:" + junk.join(" ") + "\n      合法:<版本> [--execute] [--channel]"); return 1; }
      if (!version) { bad("用法:mmc promote <版本> [--execute] [--channel]"); return 1; }
      const pkg = readJSON(join(ROOT, "package.json"), {});
      const spec = pkg.name + "@" + version;
      const cmd = `npm dist-tag add ${spec} ${channel}`;
      if (!really) {
        log(`  ${C.d}默认只演练,不碰 registry。真要晋级加 --execute:${C.x}`);
        log(`  ${cmd}`);
        log(`  晋级后自测:npm install ${spec} → node ~/.agents/skills/mm-gsd-loop/scripts/gsd-state-check.mjs --templates`);
        return 0;
      }
      // 真跑之前先看现在的标签:晋级不该让通道往回退。
      const live = readTags(pkg.name);
      if (live.ok && live.tags[channel] && compareVersions(version, live.tags[channel]) < 0) {
        bad(`${version} 比当前 ${channel}(${live.tags[channel]})旧 —— 晋级会让通道往回退`);
        return 1;
      }
      try {
        exec("npm.cmd", ["dist-tag", "add", spec, channel], { encoding: "utf8", shell: true, stdio: "pipe" });
        ok(`${spec} 已晋级到 ${channel}`);
      } catch (e) { bad("晋级失败:" + String(e.stderr || e.message).split("\n")[0]); return 1; }
      const after = readTags(pkg.name);
      if (after.ok) {
        const v = tagsVerdict({ next: after.tags.next, latest: after.tags.latest });
        log("  " + v.message);
      } else log("  " + C.d + "晋级后没核对到标签(查不到 registry):" + after.error + C.x);
      log(`\n  下一步:正式通道是给不想读文档的人的默认 —— 要新功能的人装 next(见 AGENTS.md 的回退路径)${C.x}\n`);
      return 0;
    },

  };
}
