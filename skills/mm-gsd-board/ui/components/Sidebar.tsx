import {
  Activity,
  BookOpen,
  GitFork,
  Layers,
  ListChecks,
  MessageSquarePlus,
  Moon,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  Sun,
  X,
} from "lucide-react";
import type { BoardView, ProjectSummary } from "../types.ts";

interface SidebarProps {
  activeView: BoardView;
  onSelectView: (view: BoardView) => void;
  projects: ProjectSummary[];
  activeProjectRoot: string;
  onSelectProject: (root: string) => void;
  counts: {
    phases: number;
    reqs: number;
    unclaimedReqs: number;
    debt: number;
    openAnnotations: number;
    telemetryTotal: number;
  };
  theme: "dark" | "light";
  onToggleTheme: () => void;
  paused: boolean;
  onTogglePause: () => void;
  refreshing: boolean;
  onManualRefresh: () => void;
  onOpenGuide: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: {
  id: BoardView;
  label: string;
  icon: typeof Layers;
}[] = [
  { id: "overview", label: "总览", icon: Layers },
  { id: "reqs", label: "需求", icon: ListChecks },
  { id: "reqdep", label: "REQ 依赖", icon: GitFork },
  { id: "debt", label: "欠账", icon: ShieldAlert },
  { id: "telemetry", label: "遥测", icon: Activity },
  { id: "annotations", label: "批注", icon: MessageSquarePlus },
];

export function Sidebar({
  activeView,
  onSelectView,
  projects,
  activeProjectRoot,
  onSelectProject,
  counts,
  theme,
  onToggleTheme,
  paused,
  onTogglePause,
  refreshing,
  onManualRefresh,
  onOpenGuide,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const getNavCount = (id: BoardView): { text: string; alert?: boolean } | null => {
    switch (id) {
      case "overview":
        return { text: String(counts.phases) };
      case "reqs":
        return counts.unclaimedReqs > 0
          ? { text: `${counts.reqs} · 缺${counts.unclaimedReqs}`, alert: true }
          : { text: String(counts.reqs) };
      case "debt":
        return { text: String(counts.debt), alert: counts.debt > 0 };
      case "annotations":
        return counts.openAnnotations > 0
          ? { text: `${counts.openAnnotations} open`, alert: true }
          : null;
      case "telemetry":
        return counts.telemetryTotal > 0 ? { text: String(counts.telemetryTotal) } : null;
      default:
        return null;
    }
  };

  const selectOptions =
    projects.length > 0
      ? projects
      : activeProjectRoot
        ? [{ root: activeProjectRoot, name: activeProjectRoot.split("/").pop() || activeProjectRoot, exists: true }]
        : [];

  const sidebarContent = (
    <div className="flex h-full flex-col bg-white text-slate-900 dark:bg-[#0D1320] dark:text-slate-100">
      <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800/80">
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            onSelectView("overview");
            onCloseMobile();
          }}
          className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 dark:text-white"
        >
          mm-gsd
        </a>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onManualRefresh}
            disabled={refreshing}
            title="立即刷新 .planning 数据"
            aria-label="立即刷新数据"
            className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="关闭导航菜单"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="border-b border-slate-200 px-3 py-3 dark:border-slate-800/80">
        <label
          htmlFor="project-switcher"
          className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400"
        >
          <span>注册项目</span>
          <span className="font-mono tabular-nums text-[10px]">{selectOptions.length} 个</span>
        </label>
        <select
          id="project-switcher"
          value={activeProjectRoot}
          onChange={(e) => onSelectProject(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-900 transition-colors hover:border-slate-300 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700/80 dark:bg-[#090D16] dark:text-slate-100 dark:hover:border-slate-600"
        >
          {selectOptions.map((p) => (
            <option key={p.root} value={p.root} disabled={!p.exists}>
              {p.name}
              {!p.exists ? "（目录不存在）" : ""}
            </option>
          ))}
        </select>
      </div>

      <nav aria-label="看板视图导航" className="flex-1 space-y-1 overflow-y-auto px-2.5 py-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.id;
          const badge = getNavCount(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectView(item.id);
                onCloseMobile();
              }}
              aria-current={active ? "page" : undefined}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors whitespace-nowrap ${
                active
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-400"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </span>
              {badge && (
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    badge.alert
                      ? "font-semibold text-amber-600 dark:text-amber-400"
                      : active
                        ? "text-emerald-700/80 dark:text-emerald-300/80"
                        : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {badge.text}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="space-y-1.5 border-t border-slate-200 p-2.5 dark:border-slate-800/80">
        <button
          type="button"
          onClick={onOpenGuide}
          className="flex w-full items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <BookOpen className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>契约说明与操作指引</span>
        </button>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={onToggleTheme}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {theme === "dark" ? (
              <>
                <Sun className="h-3.5 w-3.5 shrink-0" />
                <span>浅色</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5 shrink-0" />
                <span>深色</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onTogglePause}
            aria-pressed={paused}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              paused
                ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {paused ? (
              <>
                <Play className="h-3.5 w-3.5 shrink-0" />
                <span>已暂停</span>
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5 shrink-0" />
                <span>15s 同步</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 lg:block dark:border-slate-800/80">
        {sidebarContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 w-64 max-w-[80vw] border-r border-slate-200 dark:border-slate-800">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
