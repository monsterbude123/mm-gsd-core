#!/usr/bin/env node
// 看板前端构建 —— 产出 skills/mm-gsd-board/templates/web.html(单文件)。
//
// 为什么单独一个脚本而不是 vite CLI:CLI 会把产物写成 build/index.html,
// 而看板服务读的是 templates/web.html —— 中间那一步搬运要有个落点,不然
// 「产物从哪来」就没有答案了。
//
// 零运行时依赖不受影响:vite 与插件都是 devDependencies,只在本仓库构建时用。
// 产物本身是纯静态 HTML,不发版也能跑。
//
// 用法:node scripts/build-board-ui.mjs

import { build } from "vite";
import { copyFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UI_DIR = join(ROOT, "skills", "mm-gsd-board", "ui");
const BUILD_DIR = join(ROOT, "out", "board");
const OUT = join(ROOT, "skills", "mm-gsd-board", "templates", "web.html");

if (!existsSync(join(UI_DIR, "index.html"))) {
  console.error("找不到 ui/index.html —— 看板前端源码不在预期位置");
  process.exit(1);
}

await build({ root: UI_DIR, configFile: join(UI_DIR, "vite.config.ts") });

const built = join(BUILD_DIR, "index.html");
if (!existsSync(built)) {
  console.error("构建没产出 out/board/index.html");
  process.exit(1);
}

const before = existsSync(OUT) ? statSync(OUT).size : 0;
copyFileSync(built, OUT);
const after = statSync(OUT).size;

const kb = (n) => (n / 1024).toFixed(0) + " KB";
console.log(`看板产物已更新:${OUT}`);
console.log(`  ${kb(before)} → ${kb(after)}`);
