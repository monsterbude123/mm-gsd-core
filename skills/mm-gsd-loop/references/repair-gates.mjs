// 点修闭环的判定件(phase 21,D-04/D-05/D-06/D-09)。
//
// 为什么独立:点修是「已交付 phase 的快速修复」,它的一族判定(批注消化状态、R 票收口、
// 重验记录)与 checker 既有的状态推导/记账门是两种关注面 —— 塞进主脚本只会让 checker
// 继续膨胀。本模块只供数据与判定,不 exit、不打印(红黄由调用方决定)。
//
// 格式钉死(预审 F2/F6 —— 它们是推导的数据源,格式漂移推导就瞎):
//   R 票命名: .planning/<NN>-Rk-PLAN.md,收口件同名 <NN>-Rk-SUMMARY.md(k 递增)
//   重验记录: VERIFICATION 的 `## 重验记录` 节内一行 `- Rk: passed — 重验 <truth 名>`(未过写 failed)
//   批注:     .planning/annotations.json 行 {id, ts, target, type, text, status: open|digested}

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** R 票识别:文件名形如 01-R1-PLAN.md(挂在原 phase 下,k 递增) */
export function isRepairPlan(name) {
  return /^\d{2}-R\d+-PLAN\.md$/.test(String(name ?? ""));
}

/** 读批注(.planning/annotations.json)。文件缺失/坏 JSON → 空数组(观测面,不猜) */
export function readAnnotations(root) {
  try {
    const list = JSON.parse(readFileSync(join(root, ".planning", "annotations.json"), "utf8"));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

/** 重验记录里第 k 号 R 票是否已 passed(`- Rk: passed` 行;failed 或缺失都算未过) */
export function reverifyPassed(text, k) {
  return new RegExp(`^[-*]\\s*R${k}:\\s*passed\\b`, "m").test(String(text ?? ""));
}

/**
 * 每张 R 票的收口状态(D-09 推导数据源):closed = 同名 SUMMARY status complete;
 * passed = VERIFICATION 重验节有 `- Rk: passed`。checker 拿它推 reopened / 回 shipped。
 *
 * @param plans            本 phase 的 PLAN 文件名数组(checker 的 artifactInfo.plans)
 * @param summaryOf        f => 同名 SUMMARY 的 frontmatter(无则 null)—— 注入,避免抄第二份 frontmatter 解析
 * @param verificationText VERIFICATION 全文(无则 "")
 */
export function repairStatus({ plans, summaryOf, verificationText = "" }) {
  return (plans ?? []).filter((f) => isRepairPlan(f)).map((f) => {
    const k = f.match(/-R(\d+)-PLAN\.md$/)?.[1] ?? "";
    const sf = summaryOf?.(f);
    return { k, closed: sf?.status === "complete", passed: reverifyPassed(verificationText, k) };
  });
}
