// 看板前端构建配置 —— 产物是单文件 templates/web.html。
//
// 为什么是单文件:看板的模板由 mm-gsd-web.mjs 原样读出来发给浏览器
// (没有构建步骤、没有静态资源目录),所以 CSS 与 JS 必须内联进同一个 HTML。
// vite-plugin-singlefile 做这件事;产物随后由 scripts/build-board-ui.mjs
// 搬进 templates/web.html。
//
// 零运行时依赖不受影响:这些全是 devDependencies,只在本仓库构建时用,
// npm 包里不带 node_modules(见 package.json 的 files 白名单)。

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    // 中间产物放仓库根的 out/ —— 已 gitignore,且不在 npm 包的 skills/ 白名单里,
    // 不会被打进包(放在 ui/ 旁边会被 files 白名单连坐,白送一份 388 KB 重复产物)。
    outDir: "../../../out/board",
    emptyOutDir: true,
    // 单文件产物:所有资源都内联,没有第二个请求
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    reportCompressedSize: false,
    rollupOptions: { input: "index.html" },
  },
});
