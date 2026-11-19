import { ArrowLeft, ArrowRight, Eye, MessageSquare, MessageSquarePlus, Pencil, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AnnotationEditPayload, ProjectBoardState, ReqGraphNode } from "../types.ts";
import { computeReqNeighborhood, formatAnnotationAction, getAnnotationsForReq } from "../utils/boardModel.ts";
import { AnnotationEditForm } from "./AnnotationEditForm.tsx";

interface ReqDepViewProps {
  project: ProjectBoardState;
  submitting: boolean;
  onAnnotateTarget: (target: string) => void;
  onEditAnnotation: (
    payload: AnnotationEditPayload
  ) => Promise<{ ok: boolean; error?: string }>;
}

const NODE_W = 114;
const NODE_H = 44;
const COL_GAP = 30;
const ROW_GAP = 12;
const PAD_X = 14;
const PAD_Y = 42;

export function ReqDepView({
  project,
  submitting,
  onAnnotateTarget,
  onEditAnnotation,
}: ReqDepViewProps) {
  const { nodes, edges } = project.reqGraph;
  const defaultSelectedId = useMemo(() => {
    const connected =
      nodes.find(
        (n) =>
          edges.some((e) => e.from === n.id) && edges.some((e) => e.to === n.id)
      ) || nodes.find((n) => edges.some((e) => e.from === n.id || e.to === n.id));
    return connected?.id ?? nodes[0]?.id ?? null;
  }, [nodes, edges]);

  const [selectedId, setSelectedId] = useState<string | null>(defaultSelectedId);
  const [focusOnly, setFocusOnly] = useState(true);
  const [query, setQuery] = useState("");
  const [editingAnnId, setEditingAnnId] = useState<string | null>(null);

  useEffect(() => {
    setEditingAnnId(null);
  }, [selectedId]);

  useEffect(() => {
    setSelectedId((prev) =>
      prev && nodes.some((n) => n.id === prev) ? prev : defaultSelectedId
    );
  }, [defaultSelectedId, nodes]);

  const neighborhood = useMemo(
    () => computeReqNeighborhood(nodes, edges, selectedId),
    [nodes, edges, selectedId]
  );

  const selectedAnn = useMemo(
    () =>
      neighborhood.node
        ? getAnnotationsForReq(project.annotations, neighborhood.node.id)
        : null,
    [project.annotations, neighborhood.node]
  );

  const { columns, coords, svgWidth, svgHeight } = useMemo(() => {
    const byGroup = new Map<string, ReqGraphNode[]>();
    for (const n of nodes) {
      const k = n.group || "unclaimed";
      if (!byGroup.has(k)) byGroup.set(k, []);
      byGroup.get(k)!.push(n);
    }
    const keys = [...byGroup.keys()].sort((a, b) => {
      const ka = a === "unclaimed" ? "zzz" : a;
      const kb = b === "unclaimed" ? "zzz" : b;
      return ka.localeCompare(kb, undefined, { numeric: true });
    });

    const cols = keys.map((k) => ({
      key: k,
      label: k === "unclaimed" ? "未认领" : `Phase ${k}`,
      items: byGroup.get(k)!,
    }));

    const posMap = new Map<string, { x: number; y: number }>();
    let maxRows = 1;
    cols.forEach((col, ci) => {
      if (col.items.length > maxRows) maxRows = col.items.length;
      col.items.forEach((n, ri) => {
        posMap.set(n.id, {
          x: PAD_X + ci * (NODE_W + COL_GAP),
          y: PAD_Y + ri * (NODE_H + ROW_GAP),
        });
      });
    });

    const w =
      PAD_X * 2 +
      Math.max(1, cols.length) * NODE_W +
      Math.max(0, cols.length - 1) * COL_GAP;
    const h =
      PAD_Y + 24 + maxRows * NODE_H + Math.max(0, maxRows - 1) * ROW_GAP;

    return { columns: cols, coords: posMap, svgWidth: w, svgHeight: h };
  }, [nodes]);

  const queryLower = query.trim().toLowerCase();

  if (edges.length === 0) {
    return (
      <div className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-[#0F1522]">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          暂未记录票级依赖（depends_on）
        </h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          REQ 依赖网络由服务端从 PLAN 工件的票级 depends_on 字段自动推导，当前项目还没有跨票依赖边。
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
              placeholder="高亮 REQ 编号或描述…"
              aria-label="高亮 REQ 节点"
              className="w-60 rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-[#090D16] dark:text-slate-100"
            />
          </div>

          <button
            type="button"
            aria-pressed={focusOnly}
            onClick={() => setFocusOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              focusOnly
                ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/12 dark:text-blue-300"
                : "border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-[#090D16] dark:text-slate-300"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            <span>{focusOnly ? "聚焦选中邻域" : "显示全部连线"}</span>
          </button>
        </div>

        <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
          {nodes.length} 需求 · {edges.length} 条票级依赖
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-[#090D16]">
          <div
            className="relative"
            style={{ width: `${svgWidth}px`, height: `${svgHeight}px`, minWidth: "100%" }}
          >
            {columns.map((col, ci) => (
              <div
                key={col.key}
                style={{
                  left: `${PAD_X + ci * (NODE_W + COL_GAP)}px`,
                  top: "14px",
                  width: `${NODE_W}px`,
                }}
                className="absolute flex items-center justify-between font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400"
              >
                <span>{col.label}</span>
                <span className="tabular-nums opacity-70">{col.items.length}</span>
              </div>
            ))}

            <svg
              width={svgWidth}
              height={svgHeight}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
            >
              {edges.map((e, i) => {
                const a = coords.get(e.from);
                const b = coords.get(e.to);
                if (!a || !b) return null;
                const leftToRight = b.x < a.x;
                const x1 = leftToRight ? b.x + NODE_W : b.x;
                const y1 = b.y + NODE_H / 2;
                const x2 = leftToRight ? a.x : a.x + NODE_W;
                const y2 = a.y + NODE_H / 2;
                const dx = Math.max(24, Math.abs(x2 - x1) * 0.45);
                const d = leftToRight
                  ? `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
                  : `M ${x1} ${y1} L ${x2} ${y2}`;

                const isRelated =
                  selectedId && (e.from === selectedId || e.to === selectedId);
                if (focusOnly && selectedId && !isRelated) {
                  return (
                    <path
                      key={`${e.from}-${e.to}-${i}`}
                      d={d}
                      fill="none"
                      strokeWidth={1}
                      className="stroke-slate-300/25 dark:stroke-slate-700/25"
                    />
                  );
                }
                return (
                  <path
                    key={`${e.from}-${e.to}-${i}`}
                    d={d}
                    fill="none"
                    strokeWidth={isRelated ? 2 : 1.25}
                    className={
                      isRelated
                        ? e.from === selectedId
                          ? "stroke-blue-500"
                          : "stroke-emerald-500"
                        : "stroke-slate-300 dark:stroke-slate-700"
                    }
                  />
                );
              })}
            </svg>

            {nodes.map((n) => {
              const p = coords.get(n.id);
              if (!p) return null;
              const isSelected = n.id === selectedId;
              const isRelated = neighborhood.relatedIds.has(n.id);
              const annSummary = getAnnotationsForReq(project.annotations, n.id);
              const matchesSearch =
                !queryLower ||
                `${n.id} ${n.text}`.toLowerCase().includes(queryLower);

              const dimmed =
                !matchesSearch ||
                (focusOnly && selectedId !== null && !isRelated);

              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  style={{
                    left: `${p.x}px`,
                    top: `${p.y}px`,
                    width: `${NODE_W}px`,
                    height: `${NODE_H}px`,
                  }}
                  className={`absolute flex flex-col justify-center rounded-lg border px-2.5 py-1.5 text-left transition-all duration-150 ${
                    isSelected
                      ? "border-emerald-500 bg-white shadow-sm dark:border-emerald-400 dark:bg-[#141D2E]"
                      : isRelated
                        ? "border-blue-400 bg-white dark:border-blue-500/50 dark:bg-[#0F1522]"
                        : n.note === "unclaimed"
                          ? "border-rose-300 bg-rose-50/70 dark:border-rose-500/40 dark:bg-rose-500/10"
                          : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-[#0F1522] dark:hover:border-slate-600"
                  } ${dimmed ? "opacity-30" : "opacity-100"}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-[11px] font-semibold text-slate-900 dark:text-white">
                      {n.id}
                    </span>
                    {annSummary.total > 0 ? (
                      <span
                        title={`已批注 ${annSummary.total} 条`}
                        className={`text-[10px] font-medium ${
                          annSummary.open > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        已批注
                      </span>
                    ) : (
                      n.note === "unclaimed" && (
                        <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400">
                          未认领
                        </span>
                      )
                    )}
                  </div>
                  <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {n.text}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0F1522]">
          {neighborhood.node ? (
            <div className="space-y-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    {neighborhood.node.id} ·{" "}
                    {neighborhood.node.group === "unclaimed"
                      ? "未认领"
                      : `Phase ${neighborhood.node.group}`}
                  </span>
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
                          ? `已批注 · 待消化 ${selectedAnn.open}`
                          : `已批注 · 已消化 ${selectedAnn.digested}`}
                      </span>
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-900 dark:text-white">
                  {neighborhood.node.text}
                </p>
              </div>

              <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>前置依赖 ({neighborhood.dependsOn.length})</span>
                </h3>
                {neighborhood.dependsOn.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    无前置依赖，属于根需求节点。
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {neighborhood.dependsOn.map((dep) => (
                      <button
                        key={dep.reqId}
                        type="button"
                        onClick={() => setSelectedId(dep.reqId)}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs hover:border-blue-400 dark:border-slate-800 dark:bg-[#090D16] dark:hover:border-blue-500"
                      >
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {dep.reqId}
                        </span>
                        <span className="font-mono text-[11px] text-slate-400">
                          via {dep.via.join(" → ")}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <ArrowRight className="h-3.5 w-3.5" />
                  <span>被下游依赖 ({neighborhood.dependedBy.length})</span>
                </h3>
                {neighborhood.dependedBy.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    暂无下游需求依赖本条 REQ。
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {neighborhood.dependedBy.map((dep) => (
                      <button
                        key={dep.reqId}
                        type="button"
                        onClick={() => setSelectedId(dep.reqId)}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs hover:border-emerald-400 dark:border-slate-800 dark:bg-[#090D16] dark:hover:border-emerald-500"
                      >
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {dep.reqId}
                        </span>
                        <span className="font-mono text-[11px] text-slate-400">
                          via {dep.via.join(" → ")}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
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
                          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
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
                                {a.status === "open" ? "待消化" : "已消化"}
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
                              <p className="mt-1 leading-relaxed text-slate-700 dark:text-slate-300">
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
                    })}
                  </div>
                </div>
              )}

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => onAnnotateTarget(neighborhood.node!.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  <span>批注此节点</span>
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              点击画布中的任意 REQ 节点，查看其上下游依赖路径。
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
