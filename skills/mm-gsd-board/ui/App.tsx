import { AlertTriangle, CheckCircle2, Info, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnnotationsView } from "./components/AnnotationsView.tsx";
import { BoardGuideModal } from "./components/BoardGuideModal.tsx";
import { DebtView } from "./components/DebtView.tsx";
import { OverviewView } from "./components/OverviewView.tsx";
import { PhaseDrawer } from "./components/PhaseDrawer.tsx";
import { ReqDepView } from "./components/ReqDepView.tsx";
import { ReqsView } from "./components/ReqsView.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { TelemetryView } from "./components/TelemetryView.tsx";
import { TopBar } from "./components/TopBar.tsx";
import type {
  AnnotationAction,
  AnnotationEditPayload,
  AnnotationType,
  BoardView,
  DeferredDebtItem,
  PhaseNode,
  ProjectBoardState,
  ProjectSummary,
  RequirementItem,
} from "./types.ts";
import {
  buildDebtPrompt,
  buildReqPrompt,
  computeBoardKpis,
  debtItemKey,
  fetchProjects,
  fetchProjectState,
  findDuplicateOpenAnnotation,
  patchAnnotation,
  postAnnotation,
} from "./utils/boardModel.ts";

const VALID_VIEWS: BoardView[] = [
  "overview",
  "reqs",
  "reqdep",
  "debt",
  "telemetry",
  "annotations",
];

function getInitialView(): BoardView {
  if (typeof window === "undefined") return "overview";
  const hash = window.location.hash.replace(/^#/, "") as BoardView;
  return VALID_VIEWS.includes(hash) ? hash : "overview";
}

function getInitialQueryProject(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("project");
  } catch {
    return null;
  }
}

interface ToastMessage {
  id: number;
  kind: "success" | "info";
  text: string;
}

export default function App() {
  const [activeView, setActiveView] = useState<BoardView>(getInitialView);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectRoot, setActiveProjectRoot] = useState<string>(
    () => getInitialQueryProject() || ""
  );
  const [projectState, setProjectState] = useState<ProjectBoardState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    try {
      const saved = window.localStorage.getItem("mmgsd-theme");
      if (saved === "light" || saved === "dark") return saved;
      return window.matchMedia?.("(prefers-color-scheme: light)")?.matches
        ? "light"
        : "dark";
    } catch {
      return "dark";
    }
  });

  const [paused, setPaused] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [prefilledTarget, setPrefilledTarget] = useState<string>("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const activeRootRef = useRef(activeProjectRoot);
  activeRootRef.current = activeProjectRoot;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    try {
      window.localStorage.setItem("mmgsd-theme", theme);
    } catch {
      // ignore storage quota errors
    }
  }, [theme]);

  useEffect(() => {
    const onHashChange = () => setActiveView(getInitialView());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigateView = useCallback((view: BoardView) => {
    setActiveView(view);
    if (window.location.hash !== `#${view}`) {
      window.location.hash = `#${view}`;
    }
  }, []);

  const showToast = useCallback((kind: "success" | "info", text: string) => {
    const id = Date.now();
    setToast({ id, kind, text });
    setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, 3800);
  }, []);

  const loadBoardData = useCallback(
    async (opts?: { targetRoot?: string | null; silent?: boolean }) => {
      const wantRoot = opts?.targetRoot !== undefined ? opts.targetRoot : activeRootRef.current;
      if (opts?.silent) setRefreshing(true);
      else setLoading(true);
      try {
        const [projList, stateData] = await Promise.all([
          fetchProjects().catch(() => []),
          fetchProjectState(wantRoot || null),
        ]);
        setProjects(projList);
        setProjectState(stateData);
        if (!wantRoot && stateData.root) {
          setActiveProjectRoot(stateData.root);
        }
        setLoadError(null);
        const now = new Date();
        setLastSyncedAt(
          `${String(now.getHours()).padStart(2, "0")}:${String(
            now.getMinutes()
          ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "连接看板服务失败";
        setLoadError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadBoardData({ targetRoot: activeProjectRoot || null, silent: false });
  }, [activeProjectRoot, loadBoardData]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      void loadBoardData({ silent: true });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [paused, loadBoardData]);

  const handleSelectProject = useCallback((nextRoot: string) => {
    if (!nextRoot || nextRoot === activeRootRef.current) return;
    setSelectedPhaseId(null);
    setPrefilledTarget("");
    setActiveProjectRoot(nextRoot);
  }, []);

  const kpis = useMemo(
    () => (projectState ? computeBoardKpis(projectState) : null),
    [projectState]
  );

  const selectedPhase = useMemo(
    () =>
      selectedPhaseId && projectState
        ? projectState.phases.find((p) => p.phase === selectedPhaseId) || null
        : null,
    [projectState, selectedPhaseId]
  );

  const submitAnnotation = useCallback(
    async (payload: {
      target: string;
      type: AnnotationType;
      text: string;
      action?: AnnotationAction;
    }): Promise<{ ok: boolean; error?: string }> => {
      if (projectState && payload.action) {
        const dup = findDuplicateOpenAnnotation(
          projectState.annotations,
          payload.target,
          payload.action
        );
        if (dup) {
          showToast(
            "info",
            `已存在同目标未消化批注（${dup.id}），已自动去重未重复提交`
          );
          return { ok: false, error: `已有同类 open 批注 (${dup.id})` };
        }
      }

      setSubmitting(true);
      try {
        const res = await postAnnotation(
          projectState?.root || activeRootRef.current || null,
          payload
        );
        if (!res.ok) {
          showToast("info", res.error || "批注校验未通过");
          return { ok: false, error: res.error };
        }
        showToast(
          "success",
          `批注已落盘（${res.id}）—— 在 agent 会话中说「有新批注」即可触发消化`
        );
        await loadBoardData({ silent: true });
        return { ok: true };
      } finally {
        setSubmitting(false);
      }
    },
    [projectState, showToast, loadBoardData]
  );

  const editAnnotation = useCallback(
    async (payload: AnnotationEditPayload): Promise<{ ok: boolean; error?: string }> => {
      setSubmitting(true);
      try {
        const res = await patchAnnotation(
          projectState?.root || activeRootRef.current || null,
          payload
        );
        if (!res.ok) {
          showToast("info", res.error || "更新批注失败");
          return { ok: false, error: res.error };
        }
        showToast("success", `批注已更新（${res.id}）`);
        await loadBoardData({ silent: true });
        return { ok: true };
      } finally {
        setSubmitting(false);
      }
    },
    [projectState, showToast, loadBoardData]
  );

  const handleJumpToAnnotate = useCallback(
    (target: string) => {
      setSelectedPhaseId(null);
      setPrefilledTarget(target);
      navigateView("annotations");
    },
    [navigateView]
  );

  const handleOneClickPhase = useCallback(
    (phase: PhaseNode, prompt: string) => {
      void submitAnnotation({
        target: `phase:${phase.phase}`,
        type: "备注",
        text: prompt.split("\n")[0] || `排查 Phase ${phase.phase}`,
        action: "diagnose",
      });
    },
    [submitAnnotation]
  );

  const handleOneClickReq = useCallback(
    (req: RequirementItem) => {
      void submitAnnotation({
        target: req.id,
        type: "备注",
        text: buildReqPrompt(req),
        action: "diagnose",
      });
    },
    [submitAnnotation]
  );

  const handleOneClickDebt = useCallback(
    (item: DeferredDebtItem) => {
      void submitAnnotation({
        target: `debt:${debtItemKey(item)}`,
        type: "备注",
        text: buildDebtPrompt(item),
        action: "repair",
      });
    },
    [submitAnnotation]
  );

  if (!projectState && loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900 dark:bg-[#090D16] dark:text-slate-100">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-[#0F1522]">
          <p className="text-sm font-medium">正在读取本机 .planning/ 流程状态…</p>
          <p className="mt-1.5 font-mono text-xs text-slate-400">
            GET /api/state
          </p>
        </div>
      </div>
    );
  }

  if (!projectState && loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900 dark:bg-[#090D16] dark:text-slate-100">
        <div className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-6 text-center shadow-sm dark:border-rose-500/30 dark:bg-[#0F1522]">
          <AlertTriangle className="mx-auto h-6 w-6 text-rose-500" />
          <h1 className="mt-3 text-sm font-semibold">无法加载过程看板状态</h1>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => void loadBoardData({ silent: false })}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>重试连接</span>
          </button>
        </div>
      </div>
    );
  }

  if (!projectState || !kpis) return null;

  return (
    <div className="flex h-full min-h-screen bg-slate-50 text-slate-900 dark:bg-[#090D16] dark:text-slate-100">
      <Sidebar
        activeView={activeView}
        onSelectView={navigateView}
        projects={projects}
        activeProjectRoot={activeProjectRoot || projectState.root}
        onSelectProject={handleSelectProject}
        counts={{
          phases: projectState.phases.length,
          reqs: projectState.reqs.length,
          unclaimedReqs: kpis.unclaimedCount,
          debt: kpis.debtTotal,
          openAnnotations: kpis.openAnnotations,
          telemetryTotal: projectState.telemetry.total,
        }}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        paused={paused}
        onTogglePause={() => {
          setPaused((p) => !p);
          showToast("info", paused ? "已恢复 15s 自动刷新" : "已暂停自动刷新");
        }}
        refreshing={refreshing}
        onManualRefresh={() => void loadBoardData({ silent: true })}
        onOpenGuide={() => setGuideOpen(true)}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          project={projectState}
          activeView={activeView}
          kpis={kpis}
          lastSyncedAt={lastSyncedAt}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onCreateAnnotation={() => {
            setPrefilledTarget("");
            navigateView("annotations");
          }}
        />

        {loadError && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 lg:px-6 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          >
            <span>最近一次同步失败（当前展示缓存快照）：{loadError}</span>
            <button
              type="button"
              onClick={() => void loadBoardData({ silent: true })}
              className="font-semibold underline whitespace-nowrap"
            >
              立即重试
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {activeView === "overview" && (
            <OverviewView
              project={projectState}
              onSelectPhase={(p) => setSelectedPhaseId(p.phase)}
              onNavigateView={navigateView}
            />
          )}

          {activeView === "reqs" && (
            <ReqsView
              reqs={projectState.reqs}
              phases={projectState.phases}
              issues={projectState.issues}
              annotations={projectState.annotations}
              submitting={submitting}
              onAnnotateTarget={handleJumpToAnnotate}
              onOneClickReq={handleOneClickReq}
              onEditAnnotation={editAnnotation}
              onCopySuccess={(label) => showToast("success", `已复制 ${label}`)}
            />
          )}

          {activeView === "reqdep" && (
            <ReqDepView
              project={projectState}
              submitting={submitting}
              onAnnotateTarget={handleJumpToAnnotate}
              onEditAnnotation={editAnnotation}
            />
          )}

          {activeView === "debt" && (
            <DebtView
              project={projectState}
              submitting={submitting}
              onOneClickDebt={handleOneClickDebt}
              onAnnotateTarget={handleJumpToAnnotate}
              onEditAnnotation={editAnnotation}
              onCopySuccess={(label) => showToast("success", `已复制 ${label}`)}
            />
          )}

          {activeView === "telemetry" && (
            <TelemetryView telemetry={projectState.telemetry} />
          )}

          {activeView === "annotations" && (
            <AnnotationsView
              project={projectState}
              prefilledTarget={prefilledTarget}
              submitting={submitting}
              onSubmitAnnotation={submitAnnotation}
              onEditAnnotation={editAnnotation}
            />
          )}
        </main>
      </div>

      <PhaseDrawer
        phase={selectedPhase}
        allPhases={projectState.phases}
        allReqs={projectState.reqs}
        issues={projectState.issues}
        annotations={projectState.annotations}
        contextQuote={
          selectedPhase ? projectState.contexts[selectedPhase.phase] : undefined
        }
        submitting={submitting}
        onClose={() => setSelectedPhaseId(null)}
        onAnnotateTarget={handleJumpToAnnotate}
        onOneClickDiagnose={handleOneClickPhase}
        onEditAnnotation={editAnnotation}
        onCopySuccess={(label) => showToast("success", `已复制 ${label}`)}
      />

      <BoardGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 flex max-w-md items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-medium text-slate-800 shadow-lg dark:border-slate-700 dark:bg-[#141D2E] dark:text-slate-100"
        >
          {toast.kind === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
          ) : (
            <Info className="h-4 w-4 shrink-0 text-blue-500" />
          )}
          <span className="leading-snug">{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="关闭通知"
            className="ml-1 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
