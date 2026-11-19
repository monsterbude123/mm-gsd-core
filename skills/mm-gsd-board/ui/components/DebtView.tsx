import { Check, Copy, Pencil, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  AnnotationEditPayload,
  AnnotationItem,
  DeferredDebtItem,
  LocalIssueItem,
  ProjectBoardState,
} from "../types.ts";
import { buildDebtPrompt, debtItemKey } from "../utils/boardModel.ts";
import { AnnotationEditForm } from "./AnnotationEditForm.tsx";

interface DebtViewProps {
  project: ProjectBoardState;
  submitting: boolean;
  onOneClickDebt: (item: DeferredDebtItem) => void;
  onAnnotateTarget: (target: string) => void;
  onEditAnnotation: (
    payload: AnnotationEditPayload
  ) => Promise<{ ok: boolean; error?: string }>;
  onCopySuccess: (label: string) => void;
}

type DebtTab = "all" | "issues" | "annotations" | "deferred" | "parked";

export function DebtView({
  project,
  submitting,
  onOneClickDebt,
  onAnnotateTarget,
  onEditAnnotation,
  onCopySuccess,
}: DebtViewProps) {
  const [tab, setTab] = useState<DebtTab>("all");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [editingAnnId, setEditingAnnId] = useState<string | null>(null);
  const { debt } = project;

  const tabs: { id: DebtTab; label: string; count: number }[] = useMemo(
    () => [
      { id: "all", label: "全部欠账", count: debt.counts.total },
      { id: "issues", label: "本地账 I-*", count: debt.localIssues.length },
      { id: "annotations", label: "待消化批注", count: debt.openAnnotations.length },
      { id: "deferred", label: "未清偿挂账", count: debt.deferred.length },
      { id: "parked", label: "已挂条件/关闭（不计数）", count: debt.parked.length },
    ],
    [debt]
  );

  const handleCopy = async (item: DeferredDebtItem) => {
    const k = debtItemKey(item);
    try {
      await navigator.clipboard.writeText(buildDebtPrompt(item));
    } catch {
      // Clipboard API may be unavailable
    }
    setCopiedKey(k);
    onCopySuccess("挂账清偿提示词");
    setTimeout(() => setCopiedKey(null), 1600);
  };

  const renderIssueRow = (iss: LocalIssueItem) => (
    <div
      key={iss.id}
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">
            {iss.id}
          </span>
          <span className="font-mono text-[11px] text-slate-400">
            {iss.source}
          </span>
          {(iss.disposition || iss.originalStatus) && (
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {iss.disposition || iss.originalStatus}
            </span>
          )}
        </div>
        <p className="mt-1 leading-relaxed text-slate-700 dark:text-slate-200">
          {iss.title}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onAnnotateTarget(iss.id)}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        批注处置
      </button>
    </div>
  );

  const renderAnnotationRow = (ann: AnnotationItem) => {
    const isEditing = editingAnnId === ann.id;
    return (
      <div key={ann.id} className="px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                {ann.type}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-700 dark:text-slate-300">
                {ann.target}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{ann.id}</span>
            </div>
            {!isEditing && (
              <p className="mt-1 leading-relaxed text-slate-700 dark:text-slate-200">
                {ann.text}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[11px] font-medium text-amber-600 dark:text-amber-400">
              待消化 open
            </span>
            <button
              type="button"
              onClick={() => setEditingAnnId(isEditing ? null : ann.id)}
              aria-expanded={isEditing}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Pencil className="h-3 w-3" />
              <span>{isEditing ? "收起" : "编辑"}</span>
            </button>
          </div>
        </div>
        {isEditing && (
          <AnnotationEditForm
            annotation={ann}
            phases={project.phases}
            reqs={project.reqs}
            issues={project.issues}
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
  };

  const renderDeferredRow = (d: DeferredDebtItem, parked: boolean) => {
    const k = debtItemKey(d);
    return (
      <tr
        key={k}
        className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
      >
        <td className="px-4 py-3 leading-relaxed text-slate-800 dark:text-slate-200">
          {d.text}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span
            className={
              d.kind === "未分类"
                ? "font-medium text-amber-600 dark:text-amber-400"
                : "text-slate-500 dark:text-slate-400"
            }
          >
            {d.kind}
          </span>
        </td>
        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
          {d.condition || <span className="text-slate-400">—</span>}
        </td>
        <td className="px-4 py-3 text-slate-600 whitespace-nowrap dark:text-slate-300">
          {d.owner || "—"}
        </td>
        <td className="px-4 py-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">
          {d.source}
        </td>
        {!parked && (
          <td className="px-4 py-3 text-right whitespace-nowrap">
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleCopy(d)}
                aria-label={`复制 ${d.text} 清偿提示词`}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white"
              >
                {copiedKey === k ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                <span>提示词</span>
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => onOneClickDebt(d)}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
              >
                <Wrench className="h-3 w-3" />
                <span>一键点修</span>
              </button>
            </div>
          </td>
        )}
      </tr>
    );
  };

  return (
    <div id="debt" className="mx-auto max-w-[1440px] space-y-5">
      <section className="grid grid-cols-1 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-slate-800 dark:border-slate-800 dark:bg-[#0F1522]">
        <div className="px-5 py-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            本地账未闭环 (I-*)
          </div>
          <div
            className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${
              debt.localIssues.length > 0
                ? "text-rose-600 dark:text-rose-400"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {debt.localIssues.length}
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            待消化批注 (open)
          </div>
          <div
            className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${
              debt.openAnnotations.length > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {debt.openAnnotations.length}
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            未清偿挂账（不含已挂条件/关闭 {debt.parked.length} 项）
          </div>
          <div
            className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${
              debt.deferred.length > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {debt.deferred.length}
          </div>
        </div>
      </section>

      <div
        role="tablist"
        aria-label="欠账来源筛选"
        className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-slate-800 dark:bg-[#0F1522]"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              tab === t.id
                ? "bg-slate-900 text-white dark:bg-slate-800 dark:text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
            }`}
          >
            <span>{t.label}</span>
            <span className="font-mono text-[11px] tabular-nums opacity-75">
              {t.count}
            </span>
          </button>
        ))}
      </div>

      <section
        id="debt-issues"
        hidden={tab !== "all" && tab !== "issues"}
        className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0F1522]"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            本地账未闭环
          </h2>
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            {debt.localIssues.length} 项
          </span>
        </div>
        {debt.localIssues.length === 0 ? (
          <div className="px-4 py-6 text-xs text-slate-500 dark:text-slate-400">
            所有本地账问题均已闭环。
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {debt.localIssues.map(renderIssueRow)}
          </div>
        )}
      </section>

      <section
        id="debt-anns"
        hidden={tab !== "all" && tab !== "annotations"}
        className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0F1522]"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            待消化批注
          </h2>
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            {debt.openAnnotations.length} 项
          </span>
        </div>
        {debt.openAnnotations.length === 0 ? (
          <div className="px-4 py-6 text-xs text-slate-500 dark:text-slate-400">
            没有待消化的 open 批注。
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {debt.openAnnotations.map(renderAnnotationRow)}
          </div>
        )}
      </section>

      <section
        id="debt-deferred"
        hidden={tab !== "all" && tab !== "deferred"}
        className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0F1522]"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            未清偿挂账
          </h2>
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            {debt.deferred.length} 项
          </span>
        </div>
        {debt.deferred.length === 0 ? (
          <div className="px-4 py-6 text-xs text-slate-500 dark:text-slate-400">
            没有登记的未清偿挂账。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 dark:border-slate-800 dark:bg-[#090D16] dark:text-slate-400">
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    挂账事项
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    分类
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    触发条件 / 关闭理由
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    归属
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    来源
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {debt.deferred.map((d) => renderDeferredRow(d, false))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {tab === "parked" && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0F1522]">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              已挂条件 / 关闭项（不计入欠账总数）
            </h2>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {debt.parked.length} 项
            </span>
          </div>
          {debt.parked.length === 0 ? (
            <div className="px-4 py-6 text-xs text-slate-500 dark:text-slate-400">
              暂无已挂条件或已关闭的项。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 dark:border-slate-800 dark:bg-[#090D16] dark:text-slate-400">
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      挂账事项
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      分类
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      触发条件 / 关闭理由
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      归属
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      来源
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {debt.parked.map((d) => renderDeferredRow(d, true))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
