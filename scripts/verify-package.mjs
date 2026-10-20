#!/usr/bin/env node
// 打包完整性检查 —— 发布前必跑。
//
// 存在的理由:「打包漏了文件」是 npm 包最常见也最难发现的故障 —��
// 用户 npx 装完才发现某个脚本不在,报错信息还指向包内路径,极难定位。
// 所以打包后必须模拟一次安装,把该在的东西全检一遍。
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, rmSync, mkdtempSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, homedir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = { r: "\x1b[31m", g: "\x1b[32m", d: "\x1b[90m", b: "\x1b[1m", x: "\x1b[0m" };
const log = (s = "") => console.log(s);
const ok = (s) => log(`${C.g}✓${C.x} ${s}`);
const bad = (s) => { log(`${C.r}✗${C.x} ${s}`); process.exitCode = 1; };

log(`\n${C.b}mm-gsd-core 打包完整性检查${C.x}\n`);

// 1) package.json 基本字段
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
for (const k of ["name", "version", "description", "bin", "files", "engines"]) {
  if (!pkg[k]) bad(`package.json 缺 ${k}`);
}
if (pkg.dependencies && Object.keys(pkg.dependencies).length) bad("有 dependencies —— 违反零依赖");
// npx 在多 bin 时报 "could not determine executable to run",headline 命令直接失效
if (Object.keys(pkg.bin ?? {}).length !== 1) bad(`bin 必须只有一个(现在 ${Object.keys(pkg.bin ?? {}).length} 个)—— npx 无法在多 bin 时确定跑哪个`);
ok(`package.json: ${pkg.name}@${pkg.version},bin=${Object.keys(pkg.bin ?? {}).join(",")}`);

// 2) files 里列的路径都得存在
for (const f of pkg.files ?? []) {
  if (!existsSync(join(ROOT, f))) bad(`files 里列的 "${f}" 在仓库里不存在`);
}

// 3) 每个 skill 都要有 SKILL.md,scripts 要能跑
const skillsDir = join(ROOT, "skills");
const skillNames = readdirSync(skillsDir).filter((d) => d.startsWith("mm-gsd-"));
if (skillNames.length < 5) bad(`只找到 ${skillNames.length} 个技能,应为 5 个`);
for (const s of skillNames) {
  if (!existsSync(join(skillsDir, s, "SKILL.md"))) bad(`${s} 缺 SKILL.md`);
}
ok(`${skillNames.length} 个技能,均有 SKILL.md`);

// 4) 检查器六种模式在干净项目里都能跑起来(包内路径)
const CHECKER = join(skillsDir, "mm-gsd-loop", "scripts", "gsd-state-check.mjs");
if (!existsSync(CHECKER)) bad("检查器不在包内");
else {
  const sandbox = mkdtempSync(join(tmpdir(), "mmgsd-pkg-"));
  execFileSync(process.execPath, ["-e", `require('fs').mkdirSync(${JSON.stringify(join(sandbox, ".planning"))},{recursive:true})`]);
  execFileSync(process.execPath, ["-e", `require('fs').writeFileSync(${JSON.stringify(join(sandbox, ".planning", "STATE.md"))}, "---\\nstatus: discussing\\nactive_phase: 01\\n---\\n")`]);
  for (const m of ["", "--plan", "--phases", "--worktrees", "--stats", "--json", "--templates"]) {
    try { execFileSync(process.execPath, [CHECKER, m].filter(Boolean), { cwd: sandbox, env: { ...process.env, GSD_SANDBOX: "1" }, stdio: "pipe", timeout: 30000 }); }
    catch (e) {
      const err = String(e.stderr || "");
      if (/is not a function|is not defined|Cannot find/.test(err)) bad(`模式 ${m || "(默认)"} 运行时崩了: ${err.split("\n")[0]}`);
    }
  }
  rmSync(sandbox, { recursive: true, force: true });
  ok("检查器七种模式在干净项目里都跑得起来");
}

// 5) 装到临时 HOME,验证 install 流程
const fakeHome = mkdtempSync(join(tmpdir(), "mmgsd-home-"));
try {
  execFileSync(process.execPath, [join(ROOT, "bin", "mm-gsd.mjs"), "install", "--dir", join(fakeHome, "skills")], { stdio: "pipe" });
  const installed = readdirSync(join(fakeHome, "skills")).filter((n) => !n.startsWith("."));
  for (const s of skillNames) if (!installed.includes(s)) bad(`install 后缺 ${s}`);
  const instChecker = join(fakeHome, "skills", "mm-gsd-loop", "scripts", "gsd-state-check.mjs");
  if (!existsSync(instChecker)) bad("install 后找不到检查器");
  else {
    execFileSync(process.execPath, [instChecker, "--templates"], { cwd: fakeHome, stdio: "pipe" });
    ok("安装后检查器可跑,--templates 通过");
  }
  ok(`install 流程正常,装出 ${installed.length} 个技能`);
} catch (e) {
  bad("install 流程失败:\n" + String(e.stdout || "") + String(e.stderr || e.message));
} finally {
  rmSync(fakeHome, { recursive: true, force: true });
}

// 6) npm pack 干跑,看实际会打进去什么
// Windows 上 npm 是 npm.cmd,spawnSync 找不到裸 "npm" —— 用 shell 兜住跨平台
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
try {
  const out = execFileSync(NPM, ["pack", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8", stdio: "pipe", shell: process.platform === "win32" });
  const info = JSON.parse(out)[0];
  const files = info.files.map((f) => f.path);
  log(`\n  npm pack 会打入 ${files.length} 个文件,${(info.size / 1024).toFixed(0)} KB`);
  const need = ["package.json", "README.md", "LICENSE", "bin/mm-gsd.mjs"];
  for (const n of need) if (!files.includes(n)) bad(`npm pack 里缺 ${n}`);
  // 仓库自维护工具不该进用户包
  for (const n of files) {
    if (n.startsWith("tools/") || n.startsWith("docs/") || n.startsWith(".agents/") || n.startsWith(".github/"))
      bad(`不该进用户包: ${n}`);
  }
  ok("打包清单符合预期");
} catch (e) {
  bad("npm pack --dry-run 失败:" + String(e.stderr || e.message).split("\n")[0]);
}

log("");
if (process.exitCode) { log("打包检查未通过 —— 不要发布\n"); } else { log("打包检查通过\n"); }
