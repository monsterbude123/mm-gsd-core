// update 的版本决策 —— 纯函数,自测能直接调。
//
// 背景:mm-gsd update 是用户用得最多的指令。旧实现只做「用当前这份包盖掉装出去的那份」,
// 全局装着旧版的机器敲 update,盖回去的还是旧版 —— 指令看起来跑了,版本没动
// (用户实测:别的机器上 update 指向 0.7.3)。修法是先把 registry 上的最新版问出来,
// 再决定盖哪一份。
//
// 四个结局,每个都有明确的话可说 —— 说不清楚就等于骗人:
//   upgrade  registry 上更新 → 先取新版,再盖新版的技能
//   current  registry 上就是这一版 → 盖当前这份
//   older    registry 上更旧 → 不降级,盖当前这份
//   offline  问不到 registry(离线/没装 npm)→ 盖当前这份,并把「问不到」说出来

/** 语义化版本比较:只比前三段数字,够用且不引依赖 */
export function cmpVersion(a, b) {
  const pa = String(a ?? "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b ?? "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * @param running   当前跑着的这份包的版本
 * @param published registry 上该通道发布的是哪一版(null = 问不到)
 * @returns "upgrade" | "current" | "older" | "offline"
 */
export function pickUpdateAction(running, published) {
  if (!published) return "offline";
  const c = cmpVersion(published, running);
  if (c > 0) return "upgrade";
  if (c === 0) return "current";
  return "older";
}

/**
 * 覆盖之前问一次:已装的那份比要盖的还新吗?
 * 还新 → 不许盖(盖回去等于把用户已经升到的新技能弄丢)。
 * 现场:全局命令是 0.7.0、主仓是 0.7.9,旧 update 把主仓盖回 0.7.0,看板包直接没了。
 *
 * @param installed 已装那份的版本(null = 没装过/读不到清单)
 * @param target    这次要盖上去的版本
 * @returns "cover" | "skip"
 */
export function pickCoverAction(installed, target) {
  if (!installed) return "cover";
  return cmpVersion(installed, target) > 0 ? "skip" : "cover";
}
