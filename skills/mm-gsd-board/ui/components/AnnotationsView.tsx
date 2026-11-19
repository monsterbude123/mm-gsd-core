import { Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AnnotationEditPayload,
  AnnotationItem,
  AnnotationType,
  ProjectBoardState,
} from "../types.ts";
import { validateAnnotationInput } from "../utils/boardModel.ts";
import { AnnotationEditForm } from "./AnnotationEditForm.tsx";

interface AnnotationsViewProps {
  project: ProjectBoardState;
  prefilledTarget: string;
  submitting: boolean;
  onSubmitAnnotation: (input: {
    target: string;
    type: AnnotationType;
    text: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onEditAnnotation: (
    payload: AnnotationEditPayload
  ) => Promise<{ ok: boolean; error?: string }>;
}

const TYPE_META: {
  type: AnnotationType;
  routing: string;
}[] = [
  { type: "备注", routing: "记录参考信息，不阻断流转" },
  { type: "需求遗漏", routing: "补入 REQ 并触发人工确认门" },
  { type: "方向不对", routing: "退回讨论环节重开关键决策" },
  { type: "验收不过", routing: "触发点修分流并生成 R 票提醒" },
];

export function AnnotationsView({
  project,
  prefilledTarget,
  submitting,
  onSubmitAnnotation,
  onEditAnnotation,
}: AnnotationsViewProps) {
  const [target, setTarget] = useState(prefilledTarget || "");
  const [customTargetMode, setCustomTargetMode] = useState(false);
  const [type, setType] = useState<AnnotationType>("备注");
  const [text, setText] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "digested">(
    "all"
  );

  useEffect(() => {
    if (prefilledTarget) {
      setTarget(prefilledTarget);
      setCustomTargetMode(false);
      setErrorMsg(null);
    }
  }, [prefilledTarget]);

  const targetGroups = useMemo(() => {
    const openIssues = (project.issues || []).filter((i) => i.open);
    return {
      phases: project.phases.map((p) => ({
        value: `phase:${p.phase}`,
        label: `phase:${p.phase} — ${p.title || "未命名"}`,
      })),
      reqs: project.reqs.map((r) => ({
        value: r.id,
        label: `${r.id} — ${r.text.slice(0, 36)}${r.text.length > 36 ? "…" : ""}`,
      })),
      issues: openIssues.map((i) => ({
        value: i.id,
        label: `${i.id} — ${i.title.slice(0, 36)}`,
      })),
    };
  }, [project]);

  const filteredAnnotations = useMemo(() => {
    return project.annotations.filter((a) => {
      if (statusFilter === "all") return true;
      return a.status === statusFilter;
    });
  }, [project.annotations, statusFilter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateAnnotationInput({ target, type, text });
    if (!check.ok) {
      setErrorMsg(check.problems.join("；"));
      return;
    }
    const res = await onSubmitAnnotation({
      target: target.trim(),
      type,
      text: text.trim(),
    });
    if (!res.ok) {
      setErrorMsg(res.error || "提交失败");
      return;
    }
    setErrorMsg(null);
    setText("");
  };

  return (
    <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
      <section className="h-fit rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0F1522]">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          新建批注（看板唯一写通道）
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          提交后落盘至 .planning/annotations.json（status: open），在 agent 会话中输入「有新批注」即可触发消化。
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="ann-target"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                批注目标
              </label>
              <button
                type="button"
                onClick={() => setCustomTargetMode((v) => !v)}
                className="text-[11px] font-medium text-emerald-600 hover:underline dark:text-emerald-400"
              >
                {customTargetMode ? "切回下拉选择" : "手动输入目标"}
              </button>
            </div>
            {customTargetMode ? (
              <input
                id="ann-target"
                type="text"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setErrorMsg(null);
                }}
                placeholder="例如 REQ-01 / phase:01 / ticket:01-01"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-[#090D16] dark:text-slate-100"
              />
            ) : (
              <select
                id="ann-target"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setErrorMsg(null);
                }}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-[#090D16] dark:text-slate-100"
              >
                <option value="">请选择目标 (Phase / REQ / 本地账)…</option>
                {target &&
                  !targetGroups.phases.some((x) => x.value === target) &&
                  !targetGroups.reqs.some((x) => x.value === target) &&
                  !targetGroups.issues.some((x) => x.value === target) && (
                    <option value={target}>{target}</option>
                  )}
                <optgroup label="阶段 (Phase)">
                  {targetGroups.phases.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="需求 (REQ)">
                  {targetGroups.reqs.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
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
            <span className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              批注类型与处理流向
            </span>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_META.map((item) => {
                const active = type === item.type;
                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => setType(item.type)}
                    className={`rounded-lg border p-2.5 text-left transition-colors ${
                      active
                        ? "border-emerald-500 bg-emerald-50/70 text-emerald-900 dark:border-emerald-400 dark:bg-emerald-500/12 dark:text-emerald-200"
                        : "border-slate-200 bg-slate-50/60 text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-[#090D16] dark:text-slate-300"
                    }`}
                  >
                    <div className="text-xs font-semibold">{item.type}</div>
                    <div className="mt-0.5 text-[11px] leading-snug opacity-75">
                      {item.routing}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="ann-text"
              className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              批注正文
            </label>
            <textarea
              id="ann-text"
              rows={4}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              placeholder="描述发现的问题、遗漏场景或验收不通过的具体依据…"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-[#090D16] dark:text-slate-100"
            />
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
            >
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
          >
            {submitting ? "落盘中…" : "提交批注"}
          </button>
        </form>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0F1522]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              批注记录
            </h2>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {filteredAnnotations.length} 条
            </span>
          </div>

          <div
            role="tablist"
            aria-label="批注状态筛选"
            className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#090D16]"
          >
            {(
              [
                { id: "all", label: "全部" },
                { id: "open", label: "待消化 open" },
                { id: "digested", label: "已消化 digested" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={statusFilter === opt.id}
                onClick={() => setStatusFilter(opt.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  statusFilter === opt.id
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {filteredAnnotations.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              当前筛选下暂无批注记录。
            </div>
          ) : (
            filteredAnnotations.map((a: AnnotationItem) => {
              const isEditing = editingId === a.id;
              return (
                <article key={a.id} className="space-y-2 px-5 py-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`font-semibold ${
                          a.status === "open"
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {a.status === "open" ? "待消化" : "已消化"}
                      </span>
                      <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {a.type}
                      </span>
                      <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-mono text-slate-600 dark:text-slate-300">
                        {a.target}
                      </span>
                      {a.action && (
                        <>
                          <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            action:{a.action}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <time
                        dateTime={a.updatedAt || a.ts}
                        title={
                          a.updatedAt
                            ? `创建：${a.ts.replace("T", " ").slice(0, 16)} / 编辑：${a.updatedAt.replace("T", " ").slice(0, 16)}`
                            : a.ts
                        }
                        className="font-mono text-[11px] text-slate-400 tabular-nums"
                      >
                        {a.ts.replace("T", " ").slice(0, 16)}
                        {a.updatedAt ? ` · 已改 ${a.updatedAt.replace("T", " ").slice(0, 16)}` : ""}
                      </time>
                      <button
                        type="button"
                        onClick={() => setEditingId(isEditing ? null : a.id)}
                        aria-expanded={isEditing}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Pencil className="h-3 w-3" />
                        <span>{isEditing ? "收起" : "编辑"}</span>
                      </button>
                    </div>
                  </div>

                  {!isEditing ? (
                    <>
                      <p className="leading-relaxed text-slate-700 dark:text-slate-200">
                        {a.text}
                      </p>

                      {a.note && (
                        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] text-slate-600 dark:border-slate-800 dark:bg-[#090D16] dark:text-slate-300">
                          消化结论：{a.note}
                        </p>
                      )}
                    </>
                  ) : (
                    <AnnotationEditForm
                      annotation={a}
                      phases={project.phases}
                      reqs={project.reqs}
                      issues={project.issues}
                      submitting={submitting}
                      onSave={async (payload) => {
                        const res = await onEditAnnotation(payload);
                        if (res.ok) setEditingId(null);
                        return res;
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  )}
                </article>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
