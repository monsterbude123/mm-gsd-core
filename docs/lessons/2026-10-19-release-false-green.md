# release 第 6 步的假绿,以及它顺手毁掉的 package.json

日期:2026-10-19 · 版本:v0.1.0 之后 · 相关规则:R-10 / R-11 / T-03 / T-07

## 现象

`mmc release 0.1.0` 六步全绿,收尾打印:

```
  6/6 从 npm 装回本机
✓ 本机 ~/.agents/skills/ 已更新到 0.1.0
✓ v0.1.0 发布完成
```

同一时刻查 registry:

```
dist-tags: {"latest":"0.0.0-stage"}
所有版本: ["0.0.0-stage"]
npx mm-gsd-core@0.1.0 → ETARGET No matching version found
```

**用户会拿到一个跑不通的安装命令,而发布流程报的是成功。**

## 根因

第 6 步注释写的是「从 npm 装回来 —— 用的是刚发出去的那一份,不是仓库里那份」,
代码跑的是:

```js
execFileSync(process.execPath, [R("bin", "mm-gsd.mjs"), "install"], ...)
```

`R()` 指向仓库。于是:装的全是仓库副本,一行网络请求都没有,
npm 上有没有这一版完全不影响结果。

雪上加霜的是,写进清单的 `source` 是这么算的:

```js
const SOURCE = has("--from-repo") ? `repo:${PKG_ROOT}` : `npm:${name}@${version}`;
```

只有显式传 `--from-repo` 才承认自己是仓库副本。**从仓库直接跑安装器,
默认自称来自 npm。** 清单里的 `source: npm:mm-gsd-core@0.1.0` 是假的,
而且时间戳暴露了它:安装 10:05:42,版本真正上架 10:08:16 —— 装在发布之前。

还有第三处:`catch` 里只有 `warn`,不回 1。装回失败也不影响发布宣布成功。

## 为什么不是别的问题

`npm publish` 打印 `+ mm-gsd-core@0.1.0` 是真的 —— 上传成功了。
npm 有传播延迟,`npm view` 有缓存,staged publish 还会先留 `0.0.0-stage` 占位。
所以「publish 成功」和「版本可装」是两件事,中间隔着不确定的时间窗。

第 6 步本该是唯一能覆盖这个窗口的检查。它没覆盖。

## 改法

1. **装回必须走 registry。** `npm install --prefix <tmp> <name>@<version>`,
   再从 `<tmp>/node_modules/` 里跑安装器 —— 那是别人会拿到的那一份。
2. **先确认 registry 有这一版。** `npm view <name>@<version> version` 必须等于版本号,
   否则红。注意版本不存在时 npm 是**非零退出**,不是返回空串,必须 try/catch。
3. **来源核对。** 装完读清单,`source` 不等于 `npm:<name>@<version>` 就红 ——
   这一步能直接抓出「装错了副本」。
4. **装回失败 = 发布失败。** 不再 `warn`,回 1。

顺带修了安装器的来源判据:

```js
// 仓库里跑 ≠ 来自 npm。判据是旁边没有 node_modules、也不是仓库自带的副本。
const FROM_NPM = !has("--from-repo") && !existsSync(join(PKG_ROOT, "node_modules"))
  && !existsSync(join(PKG_ROOT, "tools", "mmc.mjs"));
```

## 沉淀

**新门的证明方向可以换,但证明不能省。** T-03 要求「先证明门禁在违规输入上会红」。
这次证明时我改了 `package.json` 的版本号去造违规输入,结果:

- `npm publish` 因为已存在 staged 版本而失败,`git push` 因为网络断了而失败,
  流程在中途退出,**根本走不到我新写的第 6 步**,门禁是否会红依然没被证明。
- 我为了还原,从一个错误的备份路径把 **另一个项目(vvicat)的 package.json 覆盖了进来**。

两个失败叠在一起:造测试输入的方式污染了被测对象本身。
下一次要证明什么,先把输入准备好、确认流程真能走到那一步,再动手。

## 教训一句话

> 一条注释声称的门禁,和代码实际执行的门禁,是两回事。
> 装回来的是不是那一份,不看注释,看 `source` 字段和它的时间戳。
