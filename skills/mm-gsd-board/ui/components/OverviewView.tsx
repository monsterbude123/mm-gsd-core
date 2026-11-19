import { AlertTriangle, ArrowRight, CheckCircle2, Clock, MessageSquare } from "lucide-react";
import { useMemo, useState } from "react";
import type { BoardView, PhaseFilter, PhaseNode, ProjectBoardState } from "../types.ts";
import {
  computeBoardKpis,
  computePhaseDag,
  filterPhases,
  getAnnotationsForPhase,
  getPhaseFiveSteps,
  getPhaseStatus,
} from "../utils/boardModel.ts";

interface OverviewViewProps {
  project: ProjectBoardState;
  onSelectPhase: (phase: PhaseNode) => void;
  onNavigateView: (view: BoardView) => void;
}

const NODE_W = 204;
const NODE_H = 124;
const COL_GAP = 40;
const ROW_GAP = 16;
const PAD_X = 16;
const PAD_Y = 18;

const FILTER_OPTIONS: { id: PhaseFilter; label: string }[] = [
  { id: "all", label: "全部阶段" },
  { id: "active", label: "进行中" },
  { id: "shipped", label: "已发布" },
  { id: "debt", label: "有欠账" },
];

export function OverviewView({
  project,
  onSelectPhase,
  onNavigateView,
}: OverviewViewProps) {
  const [filter, setFilter] = useState<PhaseFilter>("all");
  const [hoveredPhase, setHoveredPhase] = useState<string | null>(null);

  const kpis = useMemo(() => computeBoardKpis(project), [project]);
  const dag = useMemo(
    () => computePhaseDag(project.phases, project.topo.edges),
    [project.phases, project.topo.edges]
  );

  const visiblePhases = useMemo(
    () => filterPhases(project.phases, filter),
    [project.phases, filter]
  );
  const visibleSet = useMemo(
    () => new Set(visiblePhases.map((p) => p.phase)),
    [visiblePhases]
  );

  const { nodeCoords, svgWidth, svgHeight } = useMemo(() => {
    const coords = new Map<string, { x: number; y: number }>();
    let maxRows = 1;
    dag.columns.forEach((col, colIdx) => {
      if (col.phases.length > maxRows) maxRows = col.phases.length;
      col.phases.forEach((p, rowIdx) => {
        coords.set(p.phase, {
          x: PAD_X + colIdx * (NODE_W + COL_GAP),
          y: PAD_Y + rowIdx * (NODE_H + ROW_GAP),
        });
      });
    });
    const w =
      PAD_X * 2 +
      Math.max(1, dag.columns.length) * NODE_W +
      Math.max(0, dag.columns.length - 1) * COL_GAP;
    const h =
      PAD_Y * 2 +
      maxRows * NODE_H +
      Math.max(0, maxRows - 1) * ROW_GAP;
    return { nodeCoords: coords, svgWidth: w, svgHeight: h };
  }, [dag]);

  const relatedSet = useMemo(() => {
    if (!hoveredPhase) return null;
    const s = new Set<string>([hoveredPhase]);
    for (const [u, v] of dag.validEdges) {
      if (u === hoveredPhase) s.add(v);
      if (v === hoveredPhase) s.add(u);
    }
    return s;
  }, [hoveredPhase, dag.validEdges]);

  if (project.phases.length === 0) {
    return (
      <div className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-[#0F1522]">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          当前项目尚未初始化 .planning 流程工件
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
          在项目根目录完成第一次 discuss（生成 STATE.md 与 CONTEXT.md）后，过程看板将自动推导 Phase 依赖拓扑与五步环进度。
        </p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 font-mono text-xs text-slate-700 dark:border-slate-800 dark:bg-[#090D16] dark:text-slate-300">
          npx mm-gsd-core check
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      {kpis.warningCount > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/80 bg-amber-50/80 px-4 py-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              {[...project.productSurfaceWarn, ...project.debtWarn].join(" · ")}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigateView("debt")}
            className="inline-flex items-center gap-1 font-semibold text-amber-800 hover:underline whitespace-nowrap dark:text-amber-300"
          >
            <span>查看欠账台账</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <section
        aria-label="核心流程指标"
        className="grid grid-cols-2 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-5 sm:divide-x sm:divide-y-0 dark:divide-slate-800 dark:border-slate-800 dark:bg-[#0F1522]"
      >
        <div className="px-4 py-3.5">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Phase 交付
          </div>
          <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums dark:text-white">
            {kpis.phaseShipped}
            <span className="text-sm font-normal text-slate-400">
              {" "}
              / {kpis.phaseTotal}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onNavigateView("reqs")}
          className="px-4 py-3.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
        >
          <div className="text-xs text-slate-500 dark:text-slate-400">
            新增 REQ 认领
          </div>
          <div className="mt-1 flex items-baseline gap-2 font-mono text-xl font-semibold tabular-nums">
            <span
              className={
                kpis.unclaimedCount > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }
            >
              {kpis.claimedCount}
              <span className="text-sm font-normal text-slate-400">
                {" "}
                / {kpis.claimableCount}
              </span>
            </span>
            {kpis.unclaimedCount > 0 && (
              <span className="font-sans text-[11px] font-medium text-rose-600 dark:text-rose-400">
                缺 {kpis.unclaimedCount}
              </span>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateView("debt")}
          className="px-4 py-3.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
        >
          <div className="text-xs text-slate-500 dark:text-slate-400">
            未闭环欠账
          </div>
          <div className="mt-1 flex items-baseline gap-2 font-mono text-xl font-semibold tabular-nums">
            <span
              className={
                kpis.debtTotal > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }
            >
              {kpis.debtTotal}
            </span>
            <span className="font-sans text-[11px] text-slate-400">
              账{kpis.openIssues} · 批{kpis.openAnnotations}
            </span>
          </div>
        </button>

        <div className="px-4 py-3.5">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            挂起 R 票
          </div>
          <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums dark:text-white">
            {kpis.repairsPending}
            <span className="ml-1.5 font-sans text-xs font-normal text-slate-400">
              点修中
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onNavigateView("telemetry")}
          className="col-span-2 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 sm:col-span-1 dark:hover:bg-slate-800/40"
        >
          <div className="text-xs text-slate-500 dark:text-slate-400">
            本机遥测调用
          </div>
          <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums dark:text-white">
            {project.telemetry.total}
            <span className="ml-1.5 font-sans text-xs font-normal text-slate-400">
              次
            </span>
          </div>
        </button>
      </section>

      <section
        aria-label="Phase 分层依赖拓扑"
        className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0F1522]"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Phase 依赖拓扑（按依赖深度自左向右分层）
            </h2>
            <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
              {project.phases.length} 阶段 · {dag.validEdges.length} 条依赖 · 最长链 {dag.maxDepth} 层
            </span>
          </div>

          <div
            role="tablist"
            aria-label="筛选阶段状态"
            className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#090D16]"
          >
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={filter === opt.id}
                onClick={() => setFilter(opt.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  filter === opt.id
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative overflow-x-auto bg-slate-50/50 dark:bg-[#090D16]/60">
          <div
            className="relative"
            style={{ width: `${svgWidth}px`, height: `${svgHeight}px`, minWidth: "100%" }}
          >
            <svg
              width={svgWidth}
              height={svgHeight}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
            >
              <defs>
                <marker
                  id="arrow-muted"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" className="fill-slate-400 dark:fill-slate-600" />
                </marker>
                <marker
                  id="arrow-active"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" className="fill-emerald-500" />
                </marker>
              </defs>

              {dag.validEdges.map(([from, to]) => {
                const a = nodeCoords.get(from);
                const b = nodeCoords.get(to);
                if (!a || !b) return null;
                const x1 = a.x + NODE_W;
                const y1 = a.y + NODE_H / 2;
                const x2 = b.x - 2;
                const y2 = b.y + NODE_H / 2;
                const dx = Math.max(28, (x2 - x1) * 0.45);
                const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

                const highlighted =
                  hoveredPhase && (from === hoveredPhase || to === hoveredPhase);
                const dimmed =
                  (hoveredPhase && !highlighted) ||
                  (!visibleSet.has(from) && !visibleSet.has(to));

                return (
                  <path
                    key={`${from}-${to}`}
                    d={path}
                    fill="none"
                    strokeWidth={highlighted ? 2 : 1.35}
                    markerEnd={
                      highlighted ? "url(#arrow-active)" : "url(#arrow-muted)"
                    }
                    className={
                      highlighted
                        ? "stroke-emerald-500 transition-opacity duration-150"
                        : dimmed
                          ? "stroke-slate-300/35 dark:stroke-slate-700/35 transition-opacity duration-150"
                          : "stroke-slate-300 dark:stroke-slate-700 transition-opacity duration-150"
                    }
                  />
                );
              })}
            </svg>

            {project.phases.map((p) => {
              const pos = nodeCoords.get(p.phase);
              if (!pos) return null;
              const status = getPhaseStatus(p);
              const steps = getPhaseFiveSteps(p);
              const annSummary = getAnnotationsForPhase(project.annotations, p.phase);
              const matchesFilter = visibleSet.has(p.phase);
              const isDimmed =
                !matchesFilter || (relatedSet !== null && !relatedSet.has(p.phase));
              const isActiveHover = hoveredPhase === p.phase;

              return (
                <button
                  key={p.phase}
                  type="button"
                  onClick={() => onSelectPhase(p)}
                  onMouseEnter={() => setHoveredPhase(p.phase)}
                  onMouseLeave={() => setHoveredPhase(null)}
                  style={{
                    left: `${pos.x}px`,
                    top: `${pos.y}px`,
                    width: `${NODE_W}px`,
                    height: `${NODE_H}px`,
                  }}
                  className={`absolute flex flex-col justify-between rounded-lg border p-3 text-left transition-all duration-150 ${
                    isActiveHover
                      ? "border-emerald-500 bg-white shadow-md dark:border-emerald-400 dark:bg-[#141D2E]"
                      : status === "active"
                        ? "border-amber-300/80 bg-white hover:border-amber-400 dark:border-amber-500/40 dark:bg-[#0F1522] dark:hover:border-amber-400"
                        : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-[#0F1522] dark:hover:border-slate-600"
                  } ${isDimmed ? "opacity-35" : "opacity-100"}`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      Phase {p.phase}
                    </span>
                    <span
                      className={`font-medium ${
                        status === "shipped"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : status === "active"
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-slate-400 dark:text-slate-500"
                      }`}
                    >
                      {status === "shipped"
                        ? "已发布"
                        : status === "active"
                          ? "进行中"
                          : "未开始"}
                    </span>
                  </div>

                  <div className="line-clamp-2 text-xs font-medium leading-snug text-slate-700 dark:text-slate-200">
                    {p.title || `Phase ${p.phase}`}
                  </div>

                  {annSummary.total > 0 && (
                    <div
                      className={`inline-flex w-fit max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${
                        annSummary.open > 0
                          ? "border-amber-300/80 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/12 dark:text-amber-300"
                          : "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                      }`}
                    >
                      <MessageSquare className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">
                        {annSummary.open > 0
                          ? annSummary.hasOpenDiagnose
                            ? `已批注 · 待消化诊断 (${annSummary.open})`
                            : `已批注 · 待消化 ${annSummary.open}`
                          : `已批注 · 已消化 ${annSummary.digested}`}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <div className="flex items-center gap-1" aria-label="五步环进度">
                      {steps.map((st) => (
                        <span
                          key={st.key}
                          title={`${st.label}: ${st.state}`}
                          className={`h-1.5 w-4 rounded-sm ${
                            st.state === "done"
                              ? "bg-emerald-500"
                              : st.state === "warn"
                                ? "bg-amber-500"
                                : "bg-slate-200 dark:bg-slate-700"
                          }`}
                        />
                      ))}
                    </div>

                    {p.debt > 0 ? (
                      <span className="font-mono text-[11px] font-medium text-rose-600 tabular-nums dark:text-rose-400">
                        欠账 {p.debt}
                      </span>
                    ) : (
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                        {p.plans.length}P
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-2.5 text-[11.5px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-4">
            <span>悬停节点高亮上下游依赖链</span>
            <span aria-hidden="true">·</span>
            <span>点击节点展开五步环与 Ticket 详情</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm bg-emerald-500" /> 已完成步骤
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm bg-amber-500" /> 进行中 / 待收口
            </span>
          </div>
        </div>
      </section>

      <section
        aria-label="Phase 五步环明细表"
        className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0F1522]"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Phase 流水线明细
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
            显示 {visiblePhases.length} / {project.phases.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 dark:border-slate-800 dark:bg-[#090D16] dark:text-slate-400">
                <th scope="col" className="px-4 py-2.5 font-semibold whitespace-nowrap">
                  Phase
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  名称与目标
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold whitespace-nowrap">
                  五步环 (讨 / 计 / 执 / 验 / 交)
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">
                  票数
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">
                  挂账
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold whitespace-nowrap">
                  交付状态
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
              {visiblePhases.map((p) => {
                const status = getPhaseStatus(p);
                const steps = getPhaseFiveSteps(p);
                const annSummary = getAnnotationsForPhase(project.annotations, p.phase);
                const ticketCount = p.plans.reduce((sum, pl) => sum + pl.tickets.length, 0);
                const repairPending = p.plans.filter((pl) => pl.isRepair && !pl.summary).length;

                return (
                  <tr
                    key={p.phase}
                    onClick={() => onSelectPhase(p)}
                    className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900 whitespace-nowrap dark:text-white">
                      {p.phase}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectPhase(p);
                          }}
                          className="text-left hover:text-emerald-600 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:hover:text-emerald-400"
                        >
                          {p.title || `Phase ${p.phase}`}
                        </button>
                        {annSummary.total > 0 && (
                          <span
                            title={`共 ${annSummary.total} 条批注（待消化 ${annSummary.open} / 已消化 ${annSummary.digested}）`}
                            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                              annSummary.open > 0
                                ? "border-amber-300/80 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-300"
                                : "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                            }`}
                          >
                            <MessageSquare className="h-3 w-3 shrink-0" />
                            <span>
                              {annSummary.open > 0
                                ? annSummary.hasOpenDiagnose
                                  ? `已批注 · 待消化诊断 (${annSummary.open})`
                                  : `已批注 · 待消化 ${annSummary.open}`
                                : `已批注 · 已消化 ${annSummary.digested}`}
                            </span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        {steps.map((st) => (
                          <span
                            key={st.key}
                            className={
                              st.state === "done"
                                ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                : st.state === "warn"
                                  ? "font-semibold text-amber-600 dark:text-amber-400"
                                  : "text-slate-400 dark:text-slate-600"
                            }
                          >
                            {st.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap dark:text-slate-300">
                      {ticketCount}
                      {repairPending > 0 && (
                        <span className="ml-1.5 text-rose-600 dark:text-rose-400">
                          (R×{repairPending})
                        </span>
                      )}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono tabular-nums whitespace-nowrap ${
                        p.debt > 0
                          ? "font-semibold text-amber-600 dark:text-amber-400"
                          : "text-slate-400 dark:text-slate-500"
                      }`}
                    >
                      {p.debt}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {status === "shipped" ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>已发布</span>
                        </span>
                      ) : status === "active" ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                          <Clock className="h-3.5 w-3.5" />
                          <span>
                            {p.ship?.status === "held"
                              ? "暂缓 (held)"
                              : p.verification?.status === "gaps_found"
                                ? "验收缺口"
                                : "进行中"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">未开始</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visiblePhases.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400"
                  >
                    当前筛选条件下无匹配 Phase。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
