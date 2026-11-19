import { Check, Copy, MessageSquare, MessageSquarePlus, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  AnnotationEditPayload,
  AnnotationItem,
  LocalIssueItem,
  PhaseNode,
  RequirementItem,
} from "../types.ts";
import {
  buildPhasePrompt,
  formatAnnotationAction,
  getAnnotationsForPhase,
  getPhaseFiveSteps,
  getPhaseRelatedAnnotations,
  getPhaseStatus,
} from "../utils/boardModel.ts";
import { AnnotationEditForm } from "./AnnotationEditForm.tsx";

interface PhaseDrawerProps {
  phase: PhaseNode | null;
  allPhases?: PhaseNode[];
  allReqs: RequirementItem[];
  issues?: LocalIssueItem[];
  annotations: AnnotationItem[];
  contextQuote: string | undefined;
  submitting: boolean;
  onClose: () => void;
  onAnnotateTarget: (target: string) => void;
  onOneClickDiagnose: (phase: PhaseNode, prompt: string) => void;
  onEditAnnotation: (
    payload: AnnotationEditPayload
  ) => Promise<{ ok: boolean; error?: string }>;
  onCopySuccess: (label: string) => void;
}

export function PhaseDrawer({
  phase,
  allPhases = [],
  allReqs,
  issues = [],
  annotations,
  contextQuote,
  submitting,
  onClose,
  onAnnotateTarget,
  onOneClickDiagnose,
  onEditAnnotation,
  onCopySuccess,
}: PhaseDrawerProps) {
  const [copied, setCopied] = useState(false);
  const [editingAnnId, setEditingAnnId] = useState<string | null>(null);

  useEffect(() => {
    setCopied(false);
    setEditingAnnId(null);
  }, [phase?.phase]);

  useEffect(() => {
    if (!phase) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, onClose]);

  if (!phase) return null;

  const status = getPhaseStatus(phase);
  const steps = getPhaseFiveSteps(phase);
  const coveredReqs = allReqs.filter((r) =>
    r.claimed.some((t) => t.startsWith(`${phase.phase}-`))
  );
  const phaseAnn = getAnnotationsForPhase(annotations, phase.phase);
  const relAnns = getPhaseRelatedAnnotations(annotations, phase, allReqs);
  const promptText = buildPhasePrompt(phase, allReqs);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
    } catch {
      // Clipboard API may be unavailable in restricted contexts
    }
    setCopied(true);
    onCopySuccess(`Phase ${phase.phase} 排查提示词`);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Phase ${phase.phase} 详情`}
        className="flex h-full w-full max-w-[560px] flex-col border-l border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-[#0D1320] dark:text-slate-100"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400">
              <span>PHASE {phase.phase}</span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  status === "shipped"
                    ? "font-semibold text-emerald-600 dark:text-emerald-400"
                    : status === "active"
                      ? "font-semibold text-amber-600 dark:text-amber-400"
                      : "text-slate-500 dark:text-slate-400"
                }
              >
                {status === "shipped"
                  ? "已交付 shipped"
                  : status === "active"
                    ? "进行中 active"
                    : "未开始 pending"}
              </span>
              {phase.verification && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>验收:{phase.verification.status}</span>
                </>
              )}
              {phase.debt > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-rose-600 dark:text-rose-400">
                    挂账 {phase.debt}
                  </span>
                </>
              )}
              {phaseAnn.total > 0 && (
                <span
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-sans text-[11px] font-medium ${
                    phaseAnn.open > 0
                      ? "border-amber-300/80 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-300"
                      : "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                  }`}
                >
                  <MessageSquare className="h-3 w-3 shrink-0" />
                  <span>
                    {phaseAnn.open > 0
                      ? phaseAnn.hasOpenDiagnose
                        ? "已批注 · 待消化诊断"
                        : `已批注 · 待消化 ${phaseAnn.open}`
                      : `已批注 · 已消化 ${phaseAnn.digested}`}
                  </span>
                </span>
              )}
            </div>
            <h2 className="mt-1 text-base font-semibold leading-snug text-slate-900 dark:text-white">
              {phase.title || `Phase ${phase.phase}`}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭详情抽屉"
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section>
            <h3 className="mb-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
              五步环进度（基于工件存在性推导）
            </h3>
            <div className="grid grid-cols-5 gap-2">
              {steps.map((st, idx) => (
                <div
                  key={st.key}
                  className={`rounded-lg border px-2.5 py-2 text-center ${
                    st.state === "done"
                      ? "border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                      : st.state === "warn"
                        ? "border-amber-200 bg-amber-50/80 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                        : "border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-500"
                  }`}
                >
                  <div className="font-mono text-[10px] tabular-nums opacity-75">
                    0{idx + 1}
                  </div>
                  <div className="mt-0.5 text-xs font-semibold">{st.label}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                计划与票据清单
              </h3>
              <span className="font-mono text-xs text-slate-400 tabular-nums">
                {phase.plans.length} PLAN ·{" "}
                {phase.plans.reduce((n, p) => n + p.tickets.length, 0)} 票
              </span>
            </div>
            {phase.plans.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                暂无 PLAN 工件。进入计划环节后将在此展示拆票明细与验收命令。
              </p>
            ) : (
              <div className="space-y-2.5">
                {phase.plans.map((pl) => {
                  const summaryLabel =
                    typeof pl.summary === "object" && pl.summary
                      ? `SUMMARY (${pl.summary.status})`
                      : pl.summary
                        ? "SUMMARY 已收口"
                        : "待收口";
                  return (
                    <div
                      key={pl.plan}
                      className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-[#090D16]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {pl.plan}
                          </span>
                          {pl.check && (
                            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              · 预审 {pl.check.status}
                            </span>
                          )}
                          {pl.isRepair && (
                            <span className="font-medium text-rose-600 dark:text-rose-400">
                              · 点修 R 票
                            </span>
                          )}
                        </div>
                        <span
                          className={`font-mono text-[11px] ${
                            pl.summary
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-amber-600 dark:text-amber-400"
                          }`}
                        >
                          {summaryLabel}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                        {pl.goal}
                      </p>
                      {pl.tickets.length > 0 && (
                        <div className="mt-2.5 space-y-1.5 border-t border-slate-200 pt-2.5 dark:border-slate-800/80">
                          {pl.tickets.map((t) => (
                            <div
                              key={t.id}
                              className="flex items-start justify-between gap-3 text-xs"
                            >
                              <div className="min-w-0">
                                <span className="mr-2 font-mono font-medium text-slate-500 dark:text-slate-400">
                                  {t.id}
                                </span>
                                <span className="text-slate-700 dark:text-slate-300">
                                  {t.title}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
              认领的需求 ({coveredReqs.length})
            </h3>
            {coveredReqs.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                本 Phase 暂未认领 REQ。
              </p>
            ) : (
              <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {coveredReqs.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-start justify-between gap-3 px-3.5 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="mr-2 font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {r.id}
                      </span>
                      <span className="text-slate-600 dark:text-slate-300">
                        {r.text}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-slate-400">
                      {r.claimed.join(", ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {relAnns.length > 0 && (
            <section>
              <h3 className="mb-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                关联批注 ({relAnns.length})
              </h3>
              <div className="space-y-2">
                {relAnns.map((a) => {
                  const isEditing = editingAnnId === a.id;
                  return (
                    <div
                      key={a.id}
                      className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs dark:border-slate-800 dark:bg-[#090D16]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <strong className="font-semibold text-slate-800 dark:text-slate-200">
                            {a.type}
                          </strong>
                          {a.action && (
                            <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {formatAnnotationAction(a.action)}
                            </span>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{a.target}</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              a.status === "open"
                                ? "font-semibold text-amber-600 dark:text-amber-400"
                                : "text-emerald-600 dark:text-emerald-400"
                            }
                          >
                            {a.status === "open" ? "待消化 open" : "已消化 digested"}
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditingAnnId(isEditing ? null : a.id)}
                            aria-expanded={isEditing}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <Pencil className="h-3 w-3" />
                            <span>{isEditing ? "收起" : "编辑"}</span>
                          </button>
                        </div>
                      </div>
                      {!isEditing ? (
                        <>
                          <p className="mt-1.5 leading-relaxed text-slate-700 dark:text-slate-300">
                            {a.text}
                          </p>
                          {a.note && (
                            <p className="mt-1.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                              消化结论：{a.note}
                            </p>
                          )}
                        </>
                      ) : (
                        <AnnotationEditForm
                          annotation={a}
                          phases={allPhases}
                          reqs={allReqs}
                          issues={issues}
                          submitting={submitting}
                          onSave={async (payload) => {
                            const res = await onEditAnnotation(payload);
                            if (res.ok) setEditingAnnId(null);
                            return res;
                          }}
                          onCancel={() => setEditingAnnId(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <details className="rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 dark:border-slate-800 dark:bg-[#090D16]">
            <summary className="cursor-pointer text-xs font-medium text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
              用户原话 / CONTEXT 原文
            </summary>
            <p className="mt-2.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {contextQuote || "暂无 CONTEXT 原话记录。"}
            </p>
          </details>

          <section className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-[#090D16]">
            <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-2.5 dark:border-slate-800">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Agent 排查提示词
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    <span>已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>复制提示词</span>
                  </>
                )}
              </button>
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap p-3.5 font-mono text-[11.5px] leading-relaxed text-slate-600 dark:text-slate-300">
              {promptText}
            </pre>
          </section>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <button
            type="button"
            onClick={() => onAnnotateTarget(`phase:${phase.phase}`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            <span>批注此 Phase</span>
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => onOneClickDiagnose(phase, promptText)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-60 ${
              phaseAnn.hasOpenDiagnose
                ? "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25"
                : "bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
            }`}
          >
            {phaseAnn.hasOpenDiagnose && <Check className="h-3.5 w-3.5 shrink-0" />}
            <span>
              {submitting
                ? "落盘中…"
                : phaseAnn.hasOpenDiagnose
                  ? "已发起诊断批注（待消化）"
                  : "一键发起诊断批注"}
            </span>
          </button>
        </div>
      </aside>
    </div>
  );
}
