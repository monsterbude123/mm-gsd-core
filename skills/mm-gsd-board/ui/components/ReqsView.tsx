import { Check, Copy, MessageSquare, MessageSquarePlus, Pencil, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AnnotationEditPayload,
  AnnotationItem,
  LocalIssueItem,
  PhaseNode,
  ReqSegment,
  RequirementItem,
} from "../types.ts";
import {
  buildReqPrompt,
  filterReqs,
  formatAnnotationAction,
  getAnnotationsForReq,
} from "../utils/boardModel.ts";
import { AnnotationEditForm } from "./AnnotationEditForm.tsx";

interface ReqsViewProps {
  reqs: RequirementItem[];
  phases?: PhaseNode[];
  issues?: LocalIssueItem[];
  annotations: AnnotationItem[];
  submitting: boolean;
  onAnnotateTarget: (target: string) => void;
  onOneClickReq: (req: RequirementItem) => void;
  onEditAnnotation: (
    payload: AnnotationEditPayload
  ) => Promise<{ ok: boolean; error?: string }>;
  onCopySuccess: (label: string) => void;
}

const SEGMENTS: { id: ReqSegment; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "unclaimed", label: "无人认领" },
  { id: "claimed", label: "已认领" },
  { id: "baseline", label: "基线" },
  { id: "annotated", label: "已批注" },
];

export function ReqsView({
  reqs,
  phases = [],
  issues = [],
  annotations,
  submitting,
  onAnnotateTarget,
  onOneClickReq,
  onEditAnnotation,
  onCopySuccess,
}: ReqsViewProps) {
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<ReqSegment>("all");
  const [selectedId, setSelectedId] = useState<string | null>(reqs[0]?.id ?? null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingAnnId, setEditingAnnId] = useState<string | null>(null);

  useEffect(() => {
    setEditingAnnId(null);
  }, [selectedId]);

  const annotatedReqCount = useMemo(
    () => reqs.filter((r) => getAnnotationsForReq(annotations, r.id).total > 0).length,
    [reqs, annotations]
  );

  const filtered = useMemo(
    () => filterReqs(reqs, query, segment, annotations),
    [reqs, query, segment, annotations]
  );

  const selectedReq = useMemo(
    () =>
      reqs.find((r) => r.id === selectedId) ||
      filtered[0] ||
      reqs[0] ||
      null,
    [reqs, filtered, selectedId]
  );

  const selectedAnn = useMemo(
    () => (selectedReq ? getAnnotationsForReq(annotations, selectedReq.id) : null),
    [annotations, selectedReq]
  );

  const handleCopyPrompt = async (req: RequirementItem) => {
    const prompt = buildReqPrompt(req);
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // Clipboard API may be unavailable
    }
    setCopiedId(req.id);
    onCopySuccess(`${req.id} 核对提示词`);
    setTimeout(() => setCopiedId(null), 1600);
  };

  if (reqs.length === 0) {
    return (
      <div className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-[#0F1522]">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          尚未建立 REQUIREMENTS.md 需求台账
        </h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          在讨论环节提取用户原话需求并落盘后，看板将逐条追踪每条 REQ 的认领票与交付状态。
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-[#0F1522]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="即时过滤 REQ / 原话 / 认领票号…"
              aria-label="过滤需求清单"
              className="w-72 max-w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-[#090D16] dark:text-slate-100"
            />
          </div>

          <div
            role="tablist"
            aria-label="需求状态分组"
            className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#090D16]"
          >
            {SEGMENTS.map((seg) => (
              <button
                key={seg.id}
                type="button"
                role="tab"
                aria-selected={segment === seg.id}
                onClick={() => setSegment(seg.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  segment === seg.id
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {seg.id === "annotated" && annotatedReqCount > 0
                  ? `${seg.label} (${annotatedReqCount})`
                  : seg.label}
              </button>
            ))}
          </div>
        </div>

        <span
          role="status"
          className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400"
        >
          匹配 {filtered.length} / {reqs.length} 条
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0F1522]">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 dark:border-slate-800 dark:bg-[#090D16] dark:text-slate-400">
                  <th scope="col" className="w-32 px-4 py-2.5 font-semibold">
                    REQ
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    原话一句话
                  </th>
                  <th scope="col" className="w-44 px-4 py-2.5 font-semibold">
                    认领票
                  </th>
                  <th scope="col" className="w-48 px-4 py-2.5 font-semibold">
                    状态
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
                {filtered.map((r) => {
                  const isUnclaimed = !r.baseline && r.claimed.length === 0;
                  const isSelected = selectedReq?.id === r.id;
                  const annSummary = getAnnotationsForReq(annotations, r.id);

                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-emerald-50/70 dark:bg-emerald-500/10"
                          : isUnclaimed
                            ? "bg-rose-50/50 hover:bg-rose-50/80 dark:bg-rose-500/5 dark:hover:bg-rose-500/10"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      }`}
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900 whitespace-nowrap dark:text-white">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(r.id);
                          }}
                          className="text-left focus-visible:outline-2 focus-visible:outline-emerald-500"
                        >
                          {r.id}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                        <div className="line-clamp-2 leading-relaxed">{r.text}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        {r.claimed.length > 0 ? (
                          r.claimed.join(" · ")
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {r.baseline ? (
                            <span className="text-slate-500 dark:text-slate-400">
                              基线已交付
                            </span>
                          ) : isUnclaimed ? (
                            <span className="font-semibold text-rose-600 dark:text-rose-400">
                              无人认领
                            </span>
                          ) : r.disposition === "delivered" ? (
                            <span className="font-medium text-emerald-600 dark:text-emerald-400">
                              已交付
                            </span>
                          ) : (
                            <span className="font-medium text-emerald-600 dark:text-emerald-400">
                              已认领
                            </span>
                          )}
                          {annSummary.total > 0 && (
                            <span
                              title={`共 ${annSummary.total} 条批注（待消化 ${annSummary.open} / 已消化 ${annSummary.digested}）`}
                              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] font-medium ${
                                annSummary.open > 0
                                  ? "border-amber-300/80 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-300"
                                  : "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                              }`}
                            >
                              <MessageSquare className="h-3 w-3 shrink-0" />
                              <span>
                                {annSummary.open > 0
                                  ? annSummary.hasOpenDiagnose
                                    ? "已批注 · 待核对"
                                    : `已批注 (${annSummary.open})`
                                  : "已消化批注"}
                              </span>
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400"
                    >
                      没有匹配的 REQ。请尝试清空关键词或切换筛选分组。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0F1522]">
          {selectedReq ? (
            <div className="space-y-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                  <span>{selectedReq.id}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {selectedReq.baseline
                      ? "基线能力"
                      : selectedReq.claimed.length > 0
                        ? `Phase ${selectedReq.phase || "—"}`
                        : "未认领"}
                  </span>
                  {selectedReq.disposition && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>台账:{selectedReq.disposition}</span>
                    </>
                  )}
                  {selectedAnn && selectedAnn.total > 0 && (
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-sans text-[11px] font-medium ${
                        selectedAnn.open > 0
                          ? "border-amber-300/80 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-300"
                          : "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                      }`}
                    >
                      <MessageSquare className="h-3 w-3 shrink-0" />
                      <span>
                        {selectedAnn.open > 0
                          ? selectedAnn.hasOpenDiagnose
                            ? "已批注 · 待核对诊断"
                            : `已批注 · 待消化 ${selectedAnn.open}`
                          : `已批注 · 已消化 ${selectedAnn.digested}`}
                      </span>
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm font-medium leading-relaxed text-slate-900 dark:text-white">
                  {selectedReq.text}
                </p>
              </div>

              <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                <h3 className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  认领票据 ({selectedReq.claimed.length})
                </h3>
                {selectedReq.claimed.length > 0 ? (
                  <div className="space-y-1.5">
                    {selectedReq.claimed.map((tk) => (
                      <div
                        key={tk}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 dark:border-slate-800 dark:bg-[#090D16] dark:text-slate-300"
                      >
                        {tk}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {selectedReq.baseline
                      ? "基线能力已在前期交付，不参与新增票认领。"
                      : "暂无任何 PLAN 票认领该需求，建议发起「需求遗漏」批注。"}
                  </p>
                )}
              </div>

              <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    核对提示词
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyPrompt(selectedReq)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  >
                    {copiedId === selectedReq.id ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                        <span>已复制</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>复制</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11.5px] leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-[#090D16] dark:text-slate-300">
                  {buildReqPrompt(selectedReq)}
                </pre>
              </div>

              {selectedAnn && selectedAnn.total > 0 && (
                <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                  <h3 className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    关联批注 ({selectedAnn.total})
                  </h3>
                  <div className="space-y-2">
                    {selectedAnn.items.map((a) => {
                      const isEditing = editingAnnId === a.id;
                      return (
                        <div
                          key={a.id}
                          className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-xs dark:border-slate-800 dark:bg-[#090D16]"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="flex items-center gap-1.5">
                              <strong className="font-semibold text-slate-800 dark:text-slate-200">
                                {a.type}
                              </strong>
                              {a.action && (
                                <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                  {formatAnnotationAction(a.action)}
                                </span>
                              )}
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
                                <p className="mt-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                                  消化结论：{a.note}
                                </p>
                              )}
                            </>
                          ) : (
                            <AnnotationEditForm
                              annotation={a}
                              phases={phases}
                              reqs={reqs}
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
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => onAnnotateTarget(selectedReq.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  <span>写批注</span>
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => onOneClickReq(selectedReq)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-60 ${
                    selectedAnn?.hasOpenDiagnose
                      ? "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25"
                      : "bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
                  }`}
                >
                  {selectedAnn?.hasOpenDiagnose && <Check className="h-3.5 w-3.5 shrink-0" />}
                  <span>
                    {submitting
                      ? "提交中…"
                      : selectedAnn?.hasOpenDiagnose
                        ? "已发起核对批注（待消化）"
                        : "一键核对批注"}
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              点击左侧任意 REQ 行查看详情。
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
