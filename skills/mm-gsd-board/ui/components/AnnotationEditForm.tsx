import { useEffect, useId, useMemo, useState } from "react";
import type {
  AnnotationAction,
  AnnotationEditPayload,
  AnnotationItem,
  AnnotationStatus,
  AnnotationType,
  LocalIssueItem,
  PhaseNode,
  RequirementItem,
} from "../types.ts";
import {
  ANNOTATION_ACTIONS,
  ANNOTATION_STATUSES,
  ANNOTATION_TYPES,
  validateAnnotationPatch,
} from "../utils/boardModel.ts";

interface AnnotationEditFormProps {
  annotation: AnnotationItem;
  phases?: PhaseNode[];
  reqs?: RequirementItem[];
  issues?: LocalIssueItem[];
  submitting: boolean;
  onSave: (
    payload: AnnotationEditPayload
  ) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
}

export function AnnotationEditForm({
  annotation,
  phases = [],
  reqs = [],
  issues = [],
  submitting,
  onSave,
  onCancel,
}: AnnotationEditFormProps) {
  const uid = useId();
  const targetInputId = `${uid}-target`;
  const typeSelectId = `${uid}-type`;
  const actionSelectId = `${uid}-action`;
  const statusSelectId = `${uid}-status`;
  const textAreaId = `${uid}-text`;
  const noteAreaId = `${uid}-note`;

  const [target, setTarget] = useState(annotation.target);
  const [customTargetMode, setCustomTargetMode] = useState(false);
  const [type, setType] = useState<AnnotationType>(
    ANNOTATION_TYPES.includes(annotation.type as AnnotationType)
      ? (annotation.type as AnnotationType)
      : "备注"
  );
  const [action, setAction] = useState<AnnotationAction | "">(
    ANNOTATION_ACTIONS.some((a) => a.value === (annotation.action || ""))
      ? ((annotation.action || "") as AnnotationAction | "")
      : ""
  );
  const [status, setStatus] = useState<AnnotationStatus>(
    annotation.status === "digested" ? "digested" : "open"
  );
  const [text, setText] = useState(annotation.text);
  const [note, setNote] = useState(annotation.note ?? "");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setTarget(annotation.target);
    setCustomTargetMode(false);
    setType(
      ANNOTATION_TYPES.includes(annotation.type as AnnotationType)
        ? (annotation.type as AnnotationType)
        : "备注"
    );
    setAction(
      ANNOTATION_ACTIONS.some((a) => a.value === (annotation.action || ""))
        ? ((annotation.action || "") as AnnotationAction | "")
        : ""
    );
    setStatus(annotation.status === "digested" ? "digested" : "open");
    setText(annotation.text);
    setNote(annotation.note ?? "");
    setErrorMsg(null);
  }, [annotation]);

  const targetGroups = useMemo(() => {
    const openIssues = issues.filter((i) => i.open);
    return {
      phases: phases.map((p) => ({
        value: `phase:${p.phase}`,
        label: `phase:${p.phase} — ${p.title || "未命名"}`,
      })),
      reqs: reqs.map((r) => ({
        value: r.id,
        label: `${r.id} — ${r.text.slice(0, 32)}${r.text.length > 32 ? "…" : ""}`,
      })),
      issues: openIssues.map((i) => ({
        value: i.id,
        label: `${i.id} — ${i.title.slice(0, 32)}`,
      })),
    };
  }, [phases, reqs, issues]);

  const hasDropdownOptions =
    targetGroups.phases.length > 0 ||
    targetGroups.reqs.length > 0 ||
    targetGroups.issues.length > 0;

  const targetKnownInOptions =
    targetGroups.phases.some((o) => o.value === target) ||
    targetGroups.reqs.some((o) => o.value === target) ||
    targetGroups.issues.some((o) => o.value === target);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: AnnotationEditPayload = {
      id: annotation.id,
      target: target.trim(),
      type,
      text: text.trim(),
      action,
      status,
      note: note.trim(),
    };
    const check = validateAnnotationPatch(payload);
    if (!check.ok) {
      setErrorMsg(check.problems.join("；"));
      return;
    }
    const res = await onSave(payload);
    if (!res.ok) {
      setErrorMsg(res.error || "保存失败");
      return;
    }
    setErrorMsg(null);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800"
      aria-label={`编辑批注 ${annotation.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="font-mono">编辑批注 · {annotation.id}</span>
        {hasDropdownOptions && (
          <button
            type="button"
            onClick={() => setCustomTargetMode((v) => !v)}
            className="font-medium text-emerald-600 hover:underline whitespace-nowrap dark:text-emerald-400"
          >
            {customTargetMode ? "切回下拉选择" : "手动输入目标"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label
            htmlFor={targetInputId}
            className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300"
          >
            批注目标
          </label>
          {customTargetMode || !hasDropdownOptions ? (
            <input
              id={targetInputId}
              type="text"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              placeholder="例如 REQ-01 / phase:01 / ticket:01-01"
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-[#090D16] dark:text-slate-100"
            />
          ) : (
            <select
              id={targetInputId}
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-[#090D16] dark:text-slate-100"
            >
              {target && !targetKnownInOptions && (
                <option value={target}>{target}</option>
              )}
              {targetGroups.phases.length > 0 && (
                <optgroup label="阶段 (Phase)">
                  {targetGroups.phases.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {targetGroups.reqs.length > 0 && (
                <optgroup label="需求 (REQ)">
                  {targetGroups.reqs.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {targetGroups.issues.length > 0 && (
                <optgroup label="本地账问题">
                  {targetGroups.issues.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
        </div>

        <div>
          <label
            htmlFor={typeSelectId}
            className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300"
          >
            批注类型
          </label>
          <select
            id={typeSelectId}
            value={type}
            onChange={(e) => {
              setType(e.target.value as AnnotationType);
              if (errorMsg) setErrorMsg(null);
            }}
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-[#090D16] dark:text-slate-100"
          >
            {ANNOTATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor={actionSelectId}
            className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300"
          >
            处理动作
          </label>
          <select
            id={actionSelectId}
            value={action}
            onChange={(e) => {
              setAction(e.target.value as AnnotationAction | "");
              if (errorMsg) setErrorMsg(null);
            }}
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-[#090D16] dark:text-slate-100"
          >
            {ANNOTATION_ACTIONS.map((opt) => (
              <option key={opt.value || "__none__"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label
            htmlFor={statusSelectId}
            className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300"
          >
            消化状态
          </label>
          <select
            id={statusSelectId}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as AnnotationStatus);
              if (errorMsg) setErrorMsg(null);
            }}
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-[#090D16] dark:text-slate-100"
          >
            {ANNOTATION_STATUSES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label
            htmlFor={textAreaId}
            className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300"
          >
            批注正文
          </label>
          <textarea
            id={textAreaId}
            rows={3}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (errorMsg) setErrorMsg(null);
            }}
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs leading-relaxed text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-[#090D16] dark:text-slate-100"
          />
        </div>

        <div className="sm:col-span-2">
          <label
            htmlFor={noteAreaId}
            className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300"
          >
            消化结论（可选，清空将移除）
          </label>
          <textarea
            id={noteAreaId}
            rows={2}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              if (errorMsg) setErrorMsg(null);
            }}
            placeholder="记录核对结果、变更范围或验证依据…"
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs leading-relaxed text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-[#090D16] dark:text-slate-100"
          />
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
        >
          {errorMsg}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 whitespace-nowrap shrink-0 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
        >
          {submitting ? "保存中…" : "保存修改"}
        </button>
      </div>
    </form>
  );
}
