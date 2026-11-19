import { Menu, Plus } from "lucide-react";
import type { BoardView, ProjectBoardState } from "../types.ts";
import type { BoardKpis } from "../utils/boardModel.ts";

const VIEW_TITLES: Record<BoardView, string> = {
  overview: "总览与依赖拓扑",
  reqs: "需求溯源链",
  reqdep: "REQ 依赖网络",
  debt: "三源欠账台账",
  telemetry: "本机工具遥测",
  annotations: "审核批注工作台",
};

interface TopBarProps {
  project: ProjectBoardState;
  activeView: BoardView;
  kpis: BoardKpis;
  lastSyncedAt: string | null;
  onOpenMobileMenu: () => void;
  onCreateAnnotation: () => void;
}

export function TopBar({
  project,
  activeView,
  kpis,
  lastSyncedAt,
  onOpenMobileMenu,
  onCreateAnnotation,
}: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-6 border-b border-slate-200 bg-white px-4 lg:px-6 dark:border-slate-800/80 dark:bg-[#0D1320]">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="打开导航菜单"
          className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 lg:hidden dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Menu className="h-4 w-4" />
        </button>
        <div
          className="flex min-w-0 items-center gap-2 text-sm whitespace-nowrap"
          title={project.root}
        >
          <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
            {project.name}
          </span>
          <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
            /
          </span>
          <h1 className="truncate font-medium text-slate-600 dark:text-slate-300">
            {VIEW_TITLES[activeView]}
          </h1>
        </div>
      </div>

      <div className="hidden items-center gap-4 text-xs text-slate-500 xl:flex whitespace-nowrap tabular-nums dark:text-slate-400">
        <span>
          状态{" "}
          <strong className="font-mono font-semibold text-slate-800 dark:text-slate-200">
            {project.declared || "—"}
          </strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          活跃阶段{" "}
          <strong className="font-mono font-semibold text-slate-800 dark:text-slate-200">
            {project.activePhase ? `Phase ${project.activePhase}` : "—"}
          </strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          收口{" "}
          <strong className="font-mono font-semibold text-slate-800 dark:text-slate-200">
            {project.state.summaries}/{project.state.plans}
          </strong>
        </span>
        {kpis.warningCount > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {kpis.warningCount} 项门禁提醒
            </span>
          </>
        )}
        {lastSyncedAt && (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
              同步 {lastSyncedAt}
            </span>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={onCreateAnnotation}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap shrink-0 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>新建批注</span>
        </button>
      </div>
    </header>
  );
}
