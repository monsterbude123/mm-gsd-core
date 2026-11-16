// version.mjs —— mm-gsd 的版本号从哪来,一份实现给写记录方与观察方共用(phase 27 D-04)。
//
// 为什么独立成文件:「这条失败是哪个版本产的」是事实,只有那个版本自己知道 ——
// 让观察方猜(比如按时间猜)会把猜测当事实。仓库里跑就报仓库版本,装到 ~/.agents/skills/
// 就报安装版本;写记录的一方在写记录时算一次,观察方读记录时分桶用。
//
// 零依赖:只 import node 内置模块(仓库纪律 R-06)。

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const NAME = "mm-gsd-core";
const UNKNOWN = "unknown";

/** 读 JSON,坏文件当没有(解析失败 = 未知版本,不是崩) */
const readJson = (p) => {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
};

const isUsable = (j) => j && j.name === NAME && typeof j.version === "string" && j.version;

/**
 * mm-gsd 自己的版本号。顺序写死(phase 27 D-04):
 * ① `opts.manifestPath` 给了 → **只读这一个文件**(要求 name 是 mm-gsd-core,别抓用户项目自己的
 *    package.json),不往上找;读不到 / name 不对 → 走 ③;
 * ② 没给 → 从 `fromDir` 起逐级往上找 `package.json`(同样要求 name);
 *    **`fromDir` 不存在 → 不往上找**(起点都没有,不猜);
 * ③ 读安装清单(`opts.installManifestPath ?? ~/.agents/skills/.mm-gsd-install.json`)的顶层 `version`;
 * ④ 再找不到 → `"unknown"`。
 *
 * `opts.manifestPath` / `opts.installManifestPath` 两个口子存在的理由:测试要能指定「读不到」,
 * 否则「解析不到时返回 unknown」这条分支没法验(仓库里往上找总能找到 package.json)。
 */
export function mmGsdVersion(fromDir, opts = {}) {
  if (opts.manifestPath) {
    const j = readJson(opts.manifestPath);
    if (isUsable(j)) return j.version;
  } else if (fromDir && existsSync(fromDir)) {
    let d = fromDir;
    for (;;) {
      const j = readJson(join(d, "package.json"));
      if (isUsable(j)) return j.version;
      const up = dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  const manifest = opts.installManifestPath ?? join(homedir(), ".agents", "skills", ".mm-gsd-install.json");
  const m = readJson(manifest);
  if (m && typeof m.version === "string" && m.version) return m.version;
  return UNKNOWN;
}

/**
 * 把遥测行按版本分桶(phase 27 D-05):`cur` = 当前版本还在发生的,`old` = 其余。
 * - 缺 `ver` 字段的老记录归 old(它们来自本改动之前的版本,事实如此,不许猜);
 * - `ver === "unknown"` 的行归 old("unknown" 不是已知版本);
 * - 观察方自己版本未知(curVer === "unknown")时**全部归 old** —— 没有已知版本就没有「当前版本」。
 */
export function splitByVersion(rows, curVer) {
  const cur = [];
  const old = [];
  const known = Boolean(curVer) && curVer !== UNKNOWN;
  for (const r of rows ?? []) {
    if (known && r && r.ver === curVer) cur.push(r);
    else old.push(r);
  }
  return { cur, old };
}
