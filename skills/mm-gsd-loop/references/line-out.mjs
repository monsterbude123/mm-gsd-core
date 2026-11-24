// 同步行刷输出(I-022):console.log 走 async 管道缓冲,process.exit 时可被截断
// (实测:重定向跑 --selfcheck,5s 采样 6276/33849 字节 —— 中途零进度,尾部一次性落盘)。
// fs.writeSync(1) 逐行同步落 fd 1:管道/重定向下中途可见,退出不截尾。
// 输出量级 KB 级,同步写无性能代价。机读通道(--json)不在替换面。
import { writeSync } from "node:fs";

export const out = (text) => writeSync(1, text + "\n");
