import type {
  AnnotationAction,
  AnnotationEditPayload,
  AnnotationItem,
  AnnotationStatus,
  AnnotationType,
  DeferredDebtItem,
  PhaseFilter,
  PhaseNode,
  PlanArtifact,
  ProjectBoardState,
  ProjectSummary,
  ReqGraphEdge,
  ReqGraphNode,
  ReqSegment,
  RequirementItem,
  TargetAnnotationSummary,
} from "../types.ts";

export const ANNOTATION_TYPES: AnnotationType[] = [
  "备注",
  "需求遗漏",
  "方向不对",
  "验收不过",
];

export const ANNOTATION_ACTIONS: { value: AnnotationAction | ""; label: string }[] = [
  { value: "", label: "无动作" },
  { value: "diagnose", label: "诊断 (diagnose)" },
  { value: "repair", label: "点修 (repair)" },
  { value: "requirement", label: "补需求 (requirement)" },
  { value: "note", label: "备注 (note)" },
];

export const ANNOTATION_STATUSES: { value: AnnotationStatus; label: string }[] = [
  { value: "open", label: "待消化 (open)" },
  { value: "digested", label: "已消化 (digested)" },
];

export function projectNameFromRoot(root: string): string {
  const clean = String(root || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const seg = clean.split("/").pop();
  return seg || clean || "workspace";
}

/**
 * Normalize raw JSON returned by GET /api/state so UI components never crash
 * even on empty .planning directories or older payload shapes.
 */
export function normalizeProjectState(raw: unknown): ProjectBoardState {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const root = String(src.root ?? "");
  const rawState = (src.state && typeof src.state === "object" ? src.state : {}) as Record<string, unknown>;
  const rawDebt = (src.debt && typeof src.debt === "object" ? src.debt : {}) as Record<string, unknown>;
  const rawCounts = (rawDebt.counts && typeof rawDebt.counts === "object"
    ? rawDebt.counts
    : {}) as Record<string, unknown>;
  const rawTel = (src.telemetry && typeof src.telemetry === "object"
    ? src.telemetry
    : {}) as Record<string, unknown>;
  const rawGraph = (src.reqGraph && typeof src.reqGraph === "object"
    ? src.reqGraph
    : {}) as Record<string, unknown>;
  const rawTopo = (src.topo && typeof src.topo === "object"
    ? src.topo
    : {}) as Record<string, unknown>;

  const localIssues = Array.isArray(rawDebt.localIssues) ? rawDebt.localIssues : [];
  const openAnnotations = Array.isArray(rawDebt.openAnnotations) ? rawDebt.openAnnotations : [];
  const deferredItems = Array.isArray(rawDebt.deferred) ? rawDebt.deferred : [];
  const parkedItems = Array.isArray(rawDebt.parked) ? rawDebt.parked : [];
  const dismissedItems = Array.isArray(rawDebt.dismissed) ? rawDebt.dismissed : [];

  const phases: PhaseNode[] = Array.isArray(src.phases)
    ? src.phases.map((p) => {
        const item = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
        return {
          phase: String(item.phase ?? ""),
          title: String(item.title ?? ""),
          done: Boolean(item.done),
          level: Number(item.level ?? 0) || 0,
          depends_on: Array.isArray(item.depends_on) ? item.depends_on.map(String) : [],
          context: typeof item.context === "string" ? item.context : null,
          plans: Array.isArray(item.plans)
            ? item.plans.map((pl) => {
                const planObj = (pl && typeof pl === "object" ? pl : {}) as Record<string, unknown>;
                return {
                  file: typeof planObj.file === "string" ? planObj.file : undefined,
                  plan: String(planObj.plan ?? ""),
                  goal: String(planObj.goal ?? ""),
                  isRepair: Boolean(planObj.isRepair),
                  wave: typeof planObj.wave === "string" ? planObj.wave : undefined,
                  summary: (planObj.summary as PlanArtifact["summary"]) ?? null,
                  check: (planObj.check as PlanArtifact["check"]) ?? null,
                  tickets: Array.isArray(planObj.tickets) ? planObj.tickets : [],
                  coversReq: Array.isArray(planObj.coversReq) ? planObj.coversReq.map(String) : [],
                  coversD: Array.isArray(planObj.coversD) ? planObj.coversD.map(String) : [],
                  depends: Array.isArray(planObj.depends) ? planObj.depends.map(String) : [],
                };
              })
            : [],
          summaries: Array.isArray(item.summaries) ? item.summaries.map(String) : [],
          verification: (item.verification as PhaseNode["verification"]) ?? null,
          ship: (item.ship as PhaseNode["ship"]) ?? null,
          debt: Number(item.debt ?? 0) || 0,
        };
      })
    : [];

  const reqNodes: ReqGraphNode[] = Array.isArray(rawGraph.nodes) ? rawGraph.nodes : [];
  const phaseByReq = new Map<string, string | null>();
  for (const n of reqNodes) phaseByReq.set(n.id, n.phase ?? null);

  const reqs: RequirementItem[] = Array.isArray(src.reqs)
    ? src.reqs.map((r) => {
        const reqObj = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
        const id = String(reqObj.id ?? "");
        const claimed = Array.isArray(reqObj.claimed) ? reqObj.claimed.map(String) : [];
        const derivedPhase =
          phaseByReq.get(id) ??
          (claimed[0] ? claimed[0].slice(0, 2) : null);
        return {
          id,
          baseline: Boolean(reqObj.baseline),
          text: String(reqObj.text ?? ""),
          claimed,
          disposition: typeof reqObj.disposition === "string" ? reqObj.disposition : undefined,
          phase: derivedPhase,
        };
      })
    : [];

  const annotations: AnnotationItem[] = Array.isArray(src.annotations)
    ? [...src.annotations].reverse()
    : [];

  return {
    generated: String(src.generated ?? new Date().toISOString()),
    root,
    name: String(src.name ?? projectNameFromRoot(root)),
    declared: src.declared != null ? String(src.declared) : null,
    activePhase: src.activePhase != null ? String(src.activePhase) : null,
    state: {
      declared: rawState.declared != null ? String(rawState.declared) : null,
      activePhase: rawState.activePhase != null ? String(rawState.activePhase) : null,
      plans: Number(rawState.plans ?? 0) || 0,
      summaries: Number(rawState.summaries ?? 0) || 0,
      repairsPending: Number(rawState.repairsPending ?? 0) || 0,
    },
    phases,
    topo: {
      edges: Array.isArray(rawTopo.edges) ? (rawTopo.edges as [string, string][]) : [],
    },
    contexts: (src.contexts && typeof src.contexts === "object" ? src.contexts : {}) as Record<string, string>,
    reqs,
    annotations,
    issues: Array.isArray(src.issues) ? src.issues : [],
    issuesOpen:
      typeof src.issuesOpen === "number"
        ? src.issuesOpen
        : localIssues.length,
    debt: {
      localIssues,
      openAnnotations,
      deferred: deferredItems,
      parked: parkedItems,
      dismissed: dismissedItems,
      counts: {
        openIssues: Number(rawCounts.openIssues ?? localIssues.length) || 0,
        openAnnotations: Number(rawCounts.openAnnotations ?? openAnnotations.length) || 0,
        deferred: Number(rawCounts.deferred ?? deferredItems.length) || 0,
        parked: Number(rawCounts.parked ?? parkedItems.length) || 0,
        dismissed: Number(rawCounts.dismissed ?? dismissedItems.length) || 0,
        total:
          Number(
            rawCounts.total ??
              localIssues.length + openAnnotations.length + deferredItems.length
          ) || 0,
      },
    },
    productSurfaceWarn: Array.isArray(src.productSurfaceWarn)
      ? src.productSurfaceWarn.map(String)
      : [],
    debtWarn: Array.isArray(src.debtWarn) ? src.debtWarn.map(String) : [],
    telemetry: {
      series: Array.isArray(rawTel.series) ? rawTel.series : [],
      byTool:
        rawTel.byTool && typeof rawTel.byTool === "object"
          ? (rawTel.byTool as Record<string, number>)
          : {},
      total: Number(rawTel.total ?? 0) || 0,
      empty: rawTel.empty !== undefined ? Boolean(rawTel.empty) : true,
    },
    reqGraph: {
      nodes: reqNodes,
      edges: Array.isArray(rawGraph.edges) ? rawGraph.edges : [],
    },
  };
}

export interface DagColumn {
  layer: number;
  phases: PhaseNode[];
}

export interface DagLayoutResult {
  columns: DagColumn[];
  validEdges: [string, string][];
  brokenCycleEdges: [string, string][];
  maxDepth: number;
  phaseLayerMap: Map<string, number>;
}

/**
 * Compute deterministic left-to-right layered DAG for phases.
 * Discards dangling edges pointing to missing phases and breaks cycles cleanly.
 */
export function computePhaseDag(
  phases: PhaseNode[],
  rawEdges: [string, string][]
): DagLayoutResult {
  const phaseMap = new Map(phases.map((p) => [p.phase, p]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const p of phases) {
    inDegree.set(p.phase, 0);
    adj.set(p.phase, []);
  }

  const seenEdge = new Set<string>();
  const candidateEdges: [string, string][] = [];
  for (const [from, to] of rawEdges) {
    if (!phaseMap.has(from) || !phaseMap.has(to) || from === to) continue;
    const key = `${from}->${to}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    candidateEdges.push([from, to]);
  }

  const state = new Map<string, 0 | 1 | 2>();
  const tempAdj = new Map<string, string[]>();
  for (const p of phases) tempAdj.set(p.phase, []);
  for (const [from, to] of candidateEdges) tempAdj.get(from)!.push(to);

  const cycleEdgeSet = new Set<string>();
  const brokenCycleEdges: [string, string][] = [];

  function dfs(u: string) {
    state.set(u, 1);
    const neighbors = [...(tempAdj.get(u) || [])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    for (const v of neighbors) {
      const s = state.get(v) || 0;
      if (s === 1) {
        const key = `${u}->${v}`;
        if (!cycleEdgeSet.has(key)) {
          cycleEdgeSet.add(key);
          brokenCycleEdges.push([u, v]);
        }
      } else if (s === 0) {
        dfs(v);
      }
    }
    state.set(u, 2);
  }

  const sortedIds = phases
    .map((p) => p.phase)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const id of sortedIds) {
    if ((state.get(id) || 0) === 0) dfs(id);
  }

  const validEdges: [string, string][] = [];
  for (const [from, to] of candidateEdges) {
    if (cycleEdgeSet.has(`${from}->${to}`)) continue;
    validEdges.push([from, to]);
    adj.get(from)!.push(to);
    inDegree.set(to, (inDegree.get(to) || 0) + 1);
  }

  const layerMap = new Map<string, number>();
  for (const id of sortedIds) layerMap.set(id, 0);

  const queue = sortedIds.filter((id) => (inDegree.get(id) || 0) === 0);
  while (queue.length > 0) {
    const u = queue.shift()!;
    const uLayer = layerMap.get(u) || 0;
    for (const v of adj.get(u) || []) {
      layerMap.set(v, Math.max(layerMap.get(v) || 0, uLayer + 1));
      const nextDeg = (inDegree.get(v) || 0) - 1;
      inDegree.set(v, nextDeg);
      if (nextDeg === 0) queue.push(v);
    }
  }

  const byLayer = new Map<number, PhaseNode[]>();
  let maxDepth = 0;
  for (const p of phases) {
    const layer = layerMap.get(p.phase) ?? p.level ?? 0;
    if (layer > maxDepth) maxDepth = layer;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(p);
  }

  const columns: DagColumn[] = [...byLayer.keys()]
    .sort((a, b) => a - b)
    .map((layer) => ({
      layer,
      phases: byLayer
        .get(layer)!
        .slice()
        .sort((a, b) =>
          a.phase.localeCompare(b.phase, undefined, { numeric: true })
        ),
    }));

  return {
    columns,
    validEdges,
    brokenCycleEdges,
    maxDepth: phases.length ? maxDepth + 1 : 0,
    phaseLayerMap: layerMap,
  };
}

export function getPhaseStatus(
  p: PhaseNode
): "shipped" | "active" | "pending" {
  if (p.ship?.status === "shipped" || p.done) return "shipped";
  if (p.plans.length > 0 || p.context !== null || p.verification !== null || p.ship !== null) {
    return "active";
  }
  return "pending";
}

export function isPlanClosed(pl: PlanArtifact): boolean {
  return Boolean(pl.summary);
}

export function getPhaseFiveSteps(p: PhaseNode) {
  const hasDiscuss = Boolean(p.context);
  const hasPlan = p.plans.length > 0;
  const closedCount = p.plans.filter(isPlanClosed).length;
  const hasExec = hasPlan && closedCount === p.plans.length;
  const hasExecPartial = hasPlan && closedCount > 0 && !hasExec;
  const hasVerify = Boolean(p.verification);
  const verifyPassed = p.verification?.status === "passed";
  const hasShip = Boolean(p.ship);
  const shipDone = p.ship?.status === "shipped";

  return [
    { key: "discuss", label: "讨论", state: hasDiscuss ? ("done" as const) : ("idle" as const) },
    { key: "plan", label: "计划", state: hasPlan ? ("done" as const) : ("idle" as const) },
    {
      key: "exec",
      label: "执行",
      state: hasExec ? ("done" as const) : hasExecPartial ? ("warn" as const) : ("idle" as const),
    },
    {
      key: "verify",
      label: "验收",
      state: verifyPassed ? ("done" as const) : hasVerify ? ("warn" as const) : ("idle" as const),
    },
    {
      key: "ship",
      label: "交付",
      state: shipDone ? ("done" as const) : hasShip ? ("warn" as const) : ("idle" as const),
    },
  ];
}

export function filterPhases(
  phases: PhaseNode[],
  filter: PhaseFilter
): PhaseNode[] {
  if (filter === "all") return phases;
  if (filter === "debt") return phases.filter((p) => p.debt > 0);
  return phases.filter((p) => getPhaseStatus(p) === filter);
}

export function filterReqs(
  reqs: RequirementItem[],
  query: string,
  segment: ReqSegment,
  annotations: AnnotationItem[] = []
): RequirementItem[] {
  const q = query.trim().toLowerCase();
  return reqs.filter((r) => {
    if (segment === "unclaimed" && (r.baseline || r.claimed.length > 0)) return false;
    if (segment === "claimed" && (r.baseline || r.claimed.length === 0)) return false;
    if (segment === "baseline" && !r.baseline) return false;
    if (segment === "annotated" && getAnnotationsForReq(annotations, r.id).total === 0) {
      return false;
    }
    if (!q) return true;
    const hay = `${r.id} ${r.text} ${r.claimed.join(" ")}`.toLowerCase();
    return hay.includes(q);
  });
}

export interface ReqNeighborhood {
  node: ReqGraphNode | null;
  dependsOn: { reqId: string; via: string[] }[];
  dependedBy: { reqId: string; via: string[] }[];
  relatedIds: Set<string>;
}

export function computeReqNeighborhood(
  nodes: ReqGraphNode[],
  edges: ReqGraphEdge[],
  selectedId: string | null
): ReqNeighborhood {
  if (!selectedId) {
    return {
      node: null,
      dependsOn: [],
      dependedBy: [],
      relatedIds: new Set(),
    };
  }
  const node = nodes.find((n) => n.id === selectedId) || null;
  const dependsOn: { reqId: string; via: string[] }[] = [];
  const dependedBy: { reqId: string; via: string[] }[] = [];
  const relatedIds = new Set<string>([selectedId]);

  for (const e of edges) {
    if (e.from === selectedId) {
      dependsOn.push({ reqId: e.to, via: e.via });
      relatedIds.add(e.to);
    } else if (e.to === selectedId) {
      dependedBy.push({ reqId: e.from, via: e.via });
      relatedIds.add(e.from);
    }
  }
  return { node, dependsOn, dependedBy, relatedIds };
}

export interface BoardKpis {
  claimableCount: number;
  claimedCount: number;
  unclaimedCount: number;
  phaseTotal: number;
  phaseShipped: number;
  openAnnotations: number;
  openIssues: number;
  repairsPending: number;
  debtTotal: number;
  warningCount: number;
}

export function computeBoardKpis(state: ProjectBoardState): BoardKpis {
  const claimable = state.reqs.filter((r) => !r.baseline);
  const claimed = claimable.filter((r) => r.claimed.length > 0);
  const phaseShipped = state.phases.filter((p) => getPhaseStatus(p) === "shipped").length;
  const openAnnotations = state.debt.openAnnotations.length;
  const openIssues = state.debt.localIssues.length;
  const repairsPending = state.state.repairsPending;
  const debtTotal =
    state.debt.counts?.total ??
    openIssues + openAnnotations + state.debt.deferred.length;
  const warningCount =
    (state.productSurfaceWarn?.length || 0) + (state.debtWarn?.length || 0);

  return {
    claimableCount: claimable.length,
    claimedCount: claimed.length,
    unclaimedCount: claimable.length - claimed.length,
    phaseTotal: state.phases.length,
    phaseShipped,
    openAnnotations,
    openIssues,
    repairsPending,
    debtTotal,
    warningCount,
  };
}

export function validateAnnotationInput(input: {
  target: string;
  type: string;
  text: string;
}): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const target = input.target.trim();
  const type = input.type.trim();
  const text = input.text.trim();

  if (!target) {
    problems.push("请选择或填写目标（如 REQ-01 / phase:01 / debt:<键>）");
  }
  if (!ANNOTATION_TYPES.includes(type as AnnotationType)) {
    problems.push(`批注类型必须是 ${ANNOTATION_TYPES.join(" / ")} 之一`);
  }
  if (!text) {
    problems.push("请填写批注正文");
  }
  return { ok: problems.length === 0, problems };
}

const VALID_ACTION_VALUES = new Set(["diagnose", "repair", "requirement", "note"]);

export function validateAnnotationPatch(input: {
  id: string;
  target: string;
  type: string;
  text: string;
  action?: string;
  status?: string;
}): { ok: boolean; problems: string[] } {
  const base = validateAnnotationInput(input);
  const problems = [...base.problems];
  const id = String(input.id ?? "").trim();
  const action = String(input.action ?? "").trim();
  const status = String(input.status ?? "").trim();

  if (!id) {
    problems.unshift("缺少批注 ID");
  }
  if (action && !VALID_ACTION_VALUES.has(action)) {
    problems.push("动作类型必须是 diagnose / repair / requirement / note 之一");
  }
  if (status && status !== "open" && status !== "digested") {
    problems.push("状态必须是 open 或 digested");
  }
  return { ok: problems.length === 0, problems };
}

export function normalizeAnnotationTarget(target: string): string {
  const raw = String(target ?? "").trim();
  if (!raw) return "";
  const reqColon = raw.match(/^req:\s*(req-[\w.-]+)$/i);
  if (reqColon) return reqColon[1].toUpperCase();
  if (/^req-[\w.-]+$/i.test(raw)) return raw.toUpperCase();
  const phaseMatch = raw.match(/^phase:\s*(.+)$/i);
  if (phaseMatch) return `phase:${phaseMatch[1].trim().toLowerCase()}`;
  const ticketMatch = raw.match(/^ticket:\s*(.+)$/i);
  if (ticketMatch) return `ticket:${ticketMatch[1].trim().toLowerCase()}`;
  return raw;
}

function summarizeAnnotations(items: AnnotationItem[]): TargetAnnotationSummary {
  let open = 0;
  let digested = 0;
  let hasOpenDiagnose = false;
  let hasOpenRepair = false;
  for (const a of items) {
    if (a.status === "open") {
      open += 1;
      if (a.action === "diagnose") hasOpenDiagnose = true;
      if (a.action === "repair") hasOpenRepair = true;
    } else {
      digested += 1;
    }
  }
  return {
    total: items.length,
    open,
    digested,
    hasOpenDiagnose,
    hasOpenRepair,
    items,
  };
}

export function getAnnotationsForPhase(
  annotations: AnnotationItem[],
  phaseId: string
): TargetAnnotationSummary {
  const id = String(phaseId ?? "").trim().toLowerCase();
  if (!id) return summarizeAnnotations([]);
  const items = annotations.filter((a) => {
    const norm = normalizeAnnotationTarget(a.target).toLowerCase();
    return (
      norm === `phase:${id}` ||
      norm === id ||
      norm.startsWith(`ticket:${id}-`) ||
      norm.startsWith(`${id}-`)
    );
  });
  return summarizeAnnotations(items);
}

export function getAnnotationsForReq(
  annotations: AnnotationItem[],
  reqId: string
): TargetAnnotationSummary {
  const normReq = normalizeAnnotationTarget(reqId);
  if (!normReq) return summarizeAnnotations([]);
  const items = annotations.filter(
    (a) => normalizeAnnotationTarget(a.target) === normReq
  );
  return summarizeAnnotations(items);
}

export function getPhaseRelatedAnnotations(
  annotations: AnnotationItem[],
  phase: PhaseNode,
  allReqs: RequirementItem[]
): AnnotationItem[] {
  const directIds = new Set(
    getAnnotationsForPhase(annotations, phase.phase).items.map((a) => a.id)
  );
  const coveredReqs = allReqs.filter((r) =>
    r.claimed.some((t) => t.startsWith(`${phase.phase}-`))
  );
  const covTargets = new Set(coveredReqs.map((r) => normalizeAnnotationTarget(r.id)));
  return annotations.filter(
    (a) =>
      directIds.has(a.id) || covTargets.has(normalizeAnnotationTarget(a.target))
  );
}

export function formatAnnotationAction(action?: string): string {
  switch (action) {
    case "diagnose":
      return "诊断";
    case "repair":
      return "点修";
    case "requirement":
      return "补需求";
    case "note":
      return "备注";
    default:
      return action || "";
  }
}

export function findDuplicateOpenAnnotation(
  annotations: AnnotationItem[],
  target: string,
  action?: AnnotationAction
): AnnotationItem | null {
  if (!action) return null;
  const normTarget = normalizeAnnotationTarget(target);
  return (
    annotations.find(
      (a) =>
        a.status === "open" &&
        normalizeAnnotationTarget(a.target) === normTarget &&
        a.action === action
    ) || null
  );
}

export function debtItemKey(d: DeferredDebtItem): string {
  return `${d.source}#${d.text}`.replace(/\s+/g, " ").trim();
}

export function buildPhasePrompt(
  p: PhaseNode,
  allReqs: RequirementItem[]
): string {
  const cov = allReqs.filter((r) =>
    r.claimed.some((t) => t.startsWith(`${p.phase}-`))
  );
  const openSum = p.plans.filter((x) => !x.summary).map((x) => x.plan);
  const openRep = p.plans.filter((x) => x.isRepair && !x.summary).map((x) => x.plan);
  const hasPlan = p.plans.length > 0;
  const hasSum = p.plans.some((x) => Boolean(x.summary));

  const lines = [
    `排查 Phase ${p.phase}（${p.title || "未命名"}）的状态与收口：`,
    `- 讨论工件：${p.context ? "有 CONTEXT" : "缺失"}`,
    `- 计划工件：${
      hasPlan
        ? `${p.plans.length} 张 PLAN${
            openSum.length ? `（缺 SUMMARY：${openSum.join("、")}）` : "（全部已收口）"
          }`
        : "无 PLAN"
    }`,
    `- 执行态：${
      !hasPlan
        ? "未进执行"
        : !hasSum
          ? "未收口"
          : openSum.length
            ? `部分收口（剩余 ${openSum.join("、")}）`
            : "已收口"
    }`,
    `- 验收工件：${
      p.verification ? `${p.verification.file} (${p.verification.status})` : "无"
    }`,
    `- 交付工件：${p.ship ? `${p.ship.file} (${p.ship.status})` : "无"}`,
  ];
  if (openRep.length) {
    lines.push(`- 挂起 R 票：${openRep.join("、")}`);
  }
  lines.push(
    `- 认领 REQ：${cov.length ? cov.map((r) => r.id).join("、") : "无"}`,
    `- 挂账数：${p.debt}`,
    "",
    `请核对 .planning/ 下 ${p.phase}-* 工件并运行 \`mm-gsd check --plan .planning/${p.phase}-*-PLAN.md\` 与 \`mm-gsd check\`，给出结论与实测证据。`
  );
  return lines.join("\n");
}

export function buildReqPrompt(r: RequirementItem): string {
  return `帮我核对 REQ ${r.id} 的实现与验收：这条需求是「${r.text}」。请对照认领票（${
    r.claimed.length ? r.claimed.join("、") : "暂无认领票"
  }）与实测证据，判断它是否真的达成，给结论与依据。`;
}

export function buildDebtPrompt(d: DeferredDebtItem): string {
  const when = d.condition
    ? `当「${d.condition}」满足时`
    : "当这条债务的处置时机到了时";
  const who = d.owner ? `（责任归属：${d.owner}）` : "";
  return `${when}，帮我清偿挂账「${d.text}」${who}（来源：${d.source}）。请给出落地修改范围与验证命令。`;
}

/* ================= Live HTTP API Adapters (127.0.0.1 mm-gsd-web.mjs) ================= */

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const res = await fetch("/api/projects", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`加载项目名单失败 (HTTP ${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data)
    ? data.map((p) => ({
        root: String(p.root ?? ""),
        name: String(p.name ?? projectNameFromRoot(String(p.root ?? ""))),
        exists: p.exists !== false,
      }))
    : [];
}

export async function fetchProjectState(projectRoot?: string | null): Promise<ProjectBoardState> {
  const qs = projectRoot ? `?project=${encodeURIComponent(projectRoot)}` : "";
  const res = await fetch(`/api/state${qs}`, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false) {
    const msg =
      Array.isArray(data?.problems) && data.problems.length
        ? data.problems.join("；")
        : `加载项目状态失败 (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return normalizeProjectState(data);
}

export async function postAnnotation(
  projectRoot: string | null,
  payload: {
    target: string;
    type: AnnotationType;
    text: string;
    action?: AnnotationAction;
    note?: string;
  }
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const qs = projectRoot ? `?project=${encodeURIComponent(projectRoot)}` : "";
  const res = await fetch(`/api/annotations${qs}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    const msg =
      Array.isArray(data?.problems) && data.problems.length
        ? data.problems.join("；")
        : `提交批注失败 (HTTP ${res.status})`;
    return { ok: false, error: msg };
  }
  return { ok: true, id: String(data.id ?? "") };
}

export async function patchAnnotation(
  projectRoot: string | null,
  payload: AnnotationEditPayload
): Promise<{ ok: boolean; id?: string; annotation?: AnnotationItem; error?: string }> {
  const qs = projectRoot ? `?project=${encodeURIComponent(projectRoot)}` : "";
  const res = await fetch(`/api/annotations${qs}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    const msg =
      Array.isArray(data?.problems) && data.problems.length
        ? data.problems.join("；")
        : `更新批注失败 (HTTP ${res.status})`;
    return { ok: false, error: msg };
  }
  return {
    ok: true,
    id: String(data.id ?? payload.id),
    annotation: data.annotation as AnnotationItem | undefined,
  };
}
