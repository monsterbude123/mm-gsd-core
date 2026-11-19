# 看板前端源码

看板的界面是 React + Tailwind 写的,构建产物是**一个 HTML 文件**:
`../templates/web.html`(CSS 与 JS 全部内联)。

## 为什么是单文件

看板服务 `mm-gsd-web.mjs` 把模板原样读出来发给浏览器 —— 没有构建步骤、没有
静态资源目录、也没有第二个请求。所以产物必须自包含。

## 怎么构建

```bash
npm install          # 根目录装构建工具链(只在 devDependencies 里)
npm run build:board  # 产出 skills/mm-gsd-board/templates/web.html
```

中间产物在 `out/board/`(已 gitignore,也不在 npm 包里)。

## 怎么测

```bash
npm run test:board   # boardModel 纯逻辑(node 内置 test runner,无第三方)
node skills/mm-gsd-board/selftests/board-probe.selftest.mjs   # 服务端 + 模板契约
```

## 改产物时别踩的三个坑

1. **`[hidden]` 规则要在自己的 `<style>` 块里** —— R-30 判据二按 CSS 块扫
   `[hidden]{display:none}`;混进 Tailwind 的 `@layer` 里会被正则拆碎。
2. **`#root` 里那段 hidden 骨架不能删** —— 看板探针按静态字符串断言欠账区四个
   id(`debt` / `debt-issues` / `debt-anns` / `debt-deferred`)与内联 `<svg>`,
   骨架是它们在产物里的落点。React 接管 `#root` 后会清掉它。
3. **首屏骨架里的 `src` 用相对路径**(`./main.tsx`)—— R-30 会解析模板引用的
   外部脚本,绝对路径(`/main.tsx`)会被当成文件系统根路径,判红「脚本不存在」。
