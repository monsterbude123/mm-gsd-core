// update 映射门禁(R-31):mm-gsd update 必须先问 registry「最新发布的是哪一版」,再决定盖哪一份。
//
// 为什么要有这条门:update 是用户用得最多的指令,而旧实现只做「用当前这份包盖掉装出去的那份」
// —— 全局装着旧版的机器敲 update,盖回去的还是旧版(实测:别的机器上 update 指向 0.7.3)。
// 指令跑了、版本没动,而且**不报错** —— 这类故障从外面看是「命令好使」,只能靠门禁钉住。
//
// 三个场景,都用假 npm 顶替 registry(不碰真 registry:门禁不能变成网络投票):
//   ① registry 上有新版 → 必须换新再盖:版本清单里的版本 = registry 那版,技能内容来自那一版,
//      新增的技能还要链进宿主目录(不然用户更新完还是看不到它)
//   ② registry 上更旧   → 不降级:版本清单里的版本 = 当前这版
//   ③ registry 问不到   → 不硬失败:退出码 0,并把「问不到」说出来
//
// 零依赖:只用 node: 内置模块。
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const PKG = "mm-gsd-core";

/**
 * 假 npm 的实现(写成 .cjs,用 require 不受所在目录 package.json 的 type 影响):
 *   view <pkg> dist-tags.<channel> → 打印 FAKE_NPM_VERSION(或在 FAKE_NPM_VIEW=fail 时失败,模拟「问不到」)
 *   install --prefix <dir> ... <pkg>@<ver> → 在 <dir>/node_modules/<pkg> 造一个假的包出来
 */
export const FAKE_NPM_JS = `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "view") {
  if (process.env.FAKE_NPM_VIEW === "fail") { process.stderr.write("npm ERR! 404 registry unreachable\\n"); process.exit(1); }
  process.stdout.write((process.env.FAKE_NPM_VERSION || "999.0.0") + "\\n");
  process.exit(0);
}
if (args[0] === "install") {
  let prefix = null;
  for (let i = 0; i < args.length; i++) if (args[i] === "--prefix") prefix = args[i + 1];
  const spec = args.find((a) => a.startsWith("mm-gsd-core@")) || "mm-gsd-core@999.0.0";
  const version = spec.split("@")[1] || "999.0.0";
  if (!prefix) { process.stderr.write("npm ERR! missing --prefix\\n"); process.exit(1); }
  const root = path.join(prefix, "node_modules", "mm-gsd-core");
  fs.mkdirSync(path.join(root, "skills", "mm-gsd-fake"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills", "mm-gsd-loop", "references"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "mm-gsd-core", version }, null, 2));
  fs.writeFileSync(path.join(root, "skills", "mm-gsd-fake", "SKILL.md"), "---\\nname: mm-gsd-fake\\n---\\n\\nfake " + version + "\\n");
  fs.writeFileSync(path.join(root, "skills", "mm-gsd-loop", "references", "agent-routing.mjs"),
    "export const HOSTS = { claude: { dir: '.claude', skills: '.claude/skills', agents: null } };\\nexport const pointerCard = () => '# stub\\\\n';\\nexport const reviewerCard = () => '# stub\\\\n';\\n");
  process.stdout.write("added 1 package\\n");
  process.exit(0);
}
process.exit(0);
`;

/** 解析 npm install 的参数:要装到哪(prefix)、装哪一版(spec) */
export function parseInstallTarget(args) {
  let prefix = null;
  for (let i = 0; i < args.length; i++) if (args[i] === "--prefix") prefix = args[i + 1];
  const spec = args.find((a) => a.startsWith(PKG + "@")) || "";
  return { prefix, version: spec ? spec.slice(PKG.length + 1) : null };
}

/** 造一套假 npm 放进临时目录;version 为 null 时 view 一律失败(模拟 registry 问不到) */
export function makeFakeNpm(dir, version) {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const js = join(bin, "fake-npm.cjs");
  writeFileSync(js, FAKE_NPM_JS);
  const env = { FAKE_NPM_VERSION: version || "", FAKE_NPM_VIEW: version ? "ok" : "fail" };
  if (process.platform === "win32") {
    writeFileSync(join(bin, "npm.cmd"), "@echo off\r\nnode \"" + js + "\" %*\r\n");
  } else {
    const sh = join(bin, "npm");
    writeFileSync(sh, "#!/bin/sh\nexec node \"" + js + "\" \"$@\"\n");
    chmodSync(sh, 0o755);
  }
  return { bin, env };
}

/** 跑一次 update,返回退出码与输出 */
export function runUpdate({ installer, home, fake }) {
  const env = { ...process.env, ...(fake?.env || {}) };
  if (fake?.bin) {
    // Windows 的环境变量键名可能是 "Path" —— 大小写敏感,得改原来那个键,
    // 新造一个 "PATH" 会让 cmd.exe 拿到两个路径变量,先命中哪个说不准。
    for (const k of Object.keys(env)) {
      if (k.toLowerCase() === "path") { env[k] = fake.bin + delimiter + env[k]; break; }
    }
  }
  const r = spawnSync(process.execPath, [installer, "update", "--home", home], {
    env, encoding: "utf8", timeout: 180000, cwd: tmpdir(),
  });
  return { code: r.status, out: String(r.stdout || ""), err: String(r.stderr || ""), signal: r.signal };
}

function readManifest(home) {
  const p = join(home, ".agents", "skills", ".mm-gsd-install.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

/**
 * 跑三个场景,返回问题清单(空数组 = 全过)。
 * @param installer  被测的 update 入口( bin/mm-gsd.mjs )
 * @param version    当前这一版的版本号(不降级那一条要跟它比)
 */
export function checkUpdateScenarios({ installer, version, workRoot }) {
  const root = workRoot || mkdtempSync(join(tmpdir(), "mm-gsd-update-gate-"));
  const problems = [];
  const run = (name, fakeVersion) => {
    const home = join(root, name);
    mkdirSync(home, { recursive: true });
    mkdirSync(join(home, ".claude"), { recursive: true });   // 假扮一台装了 claude 的机器:查「新技能有没有链进宿主目录」
    const fake = makeFakeNpm(join(root, "fake-" + name), fakeVersion);
    const r = runUpdate({ installer, home, fake });
    return { name, r, manifest: readManifest(home), home };
  };

  // ① registry 上有新版 → 换新再盖
  const up = run("newer", "999.0.0");
  if (up.r.code !== 0) problems.push(`场景① update 退出码 ${up.r.code}(应为 0):${up.r.err.slice(0, 200)}`);
  if (!up.r.out.includes("registry 上的 latest 是 999.0.0")) problems.push("场景① update 没有报告 registry 上的版本 —— 它没问 registry");
  if (up.manifest?.version !== "999.0.0") problems.push(`场景① 版本清单里的版本是 ${up.manifest?.version},应是 registry 上的 999.0.0 —— 没有换新再盖`);
  if (up.manifest?.source !== `npm:${PKG}@999.0.0`) problems.push(`场景① 版本清单里的来源是 ${up.manifest?.source},应是 npm:${PKG}@999.0.0`);
  if (!existsSync(join(up.home, ".agents", "skills", "mm-gsd-fake", "SKILL.md"))) problems.push("场景① 装出来的技能不来自取到的那一版 —— 覆盖的还是旧内容");
  // ④ 新技能要链进宿主目录:链接是指向主仓的 junction,内容跟着主仓变,
  //    但**新增的技能名**不会自己长出来 —— 不补这一步,用户更新完还是看不到新技能(实测:看板包就没进宿主目录)。
  if (!existsSync(join(up.home, ".claude", "skills", "mm-gsd-fake"))) problems.push("场景① 新增的技能没有链进宿主目录 —— 用户更新完还是看不到它");

  // ② registry 上更旧 → 不降级
  const old = run("older", "0.0.1");
  if (old.r.code !== 0) problems.push(`场景② update 退出码 ${old.r.code}(应为 0):${old.r.err.slice(0, 200)}`);
  if (!old.r.out.includes("不降级")) problems.push("场景② registry 上更旧时没有说「不降级」—— 降级了就该说,不说等于悄悄降");
  if (old.manifest?.version !== version) problems.push(`场景② 版本清单里的版本是 ${old.manifest?.version},应是当前这版 ${version} —— 被降级了`);

  // ③ registry 问不到 → 不硬失败,并说清
  const off = run("offline", null);
  if (off.r.code !== 0) problems.push(`场景③ registry 问不到时 update 退出码 ${off.r.code}(应为 0):${off.r.err.slice(0, 200)}`);
  if (!off.r.out.includes("问不到 registry")) problems.push("场景③ registry 问不到时没有说「问不到」—— 悄悄按旧版盖过去,用户以为自己更新过");
  if (off.manifest?.version !== version) problems.push(`场景③ 版本清单里的版本是 ${off.manifest?.version},应是当前这版 ${version}`);

  return { problems, root };
}

/** mmc health 的接线入口 */
export function checkUpdateMapsLatest({ root, report }) {
  const installer = join(root, "bin", "mm-gsd.mjs");
  if (!existsSync(installer)) { report.fail("缺少 bin/mm-gsd.mjs —— 装不了,也就更新不了"); return false; }
  let version = "0.0.0";
  try { version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? version; } catch {}
  let res;
  try {
    res = checkUpdateScenarios({ installer, version });
  } catch (e) {
    report.fail("update 场景跑不起来:" + String(e?.message || e));
    return false;
  }
  for (const p of res.problems) report.fail(p);
  if (!res.problems.length) report.pass("update 映射 registry 上的最新版(有新版换新再盖 / 不降级 / 问不到不硬失败)");
  try { rmSync(res.root, { recursive: true, force: true }); } catch {}
  return res.problems.length === 0;
}
