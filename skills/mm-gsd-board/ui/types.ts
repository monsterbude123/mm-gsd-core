export type BoardView =
  | "overview"
  | "reqs"
  | "reqdep"
  | "debt"
  | "telemetry"
  | "annotations";

export type PhaseFilter = "all" | "active" | "shipped" | "pending" | "debt";
export type ReqSegment = "all" | "unclaimed" | "claimed" | "baseline" | "annotated";
export type AnnotationType = "备注" | "需求遗漏" | "方向不对" | "验收不过";
export type AnnotationAction = "diagnose" | "repair" | "requirement" | "note";

export interface TargetAnnotationSummary {
  total: number;
  open: number;
  digested: number;
  hasOpenDiagnose: boolean;
  hasOpenRepair: boolean;
  items: AnnotationItem[];
}

export interface TicketItem {
  id: string;
  title: string;
  files: string;
  verify: string;
  done: string;
}

export interface PlanSummaryInfo {
  file: string;
  status: string;
  commits: string;
}

export interface PlanArtifact {
  file?: string;
  plan: string;
  goal: string;
  isRepair: boolean;
  wave?: string;
  summary: PlanSummaryInfo | boolean | null;
  check: { status: string; file?: string } | null;
  tickets: TicketItem[];
  coversReq: string[];
  coversD?: string[];
  depends: string[];
}

export interface PhaseNode {
  phase: string;
  title: string;
  done: boolean;
  level: number;
  depends_on: string[];
  context: string | null;
  plans: PlanArtifact[];
  summaries?: string[];
  verification: { file: string; status: string } | null;
  ship: { file: string; status: string } | null;
  debt: number;
}

export interface RequirementItem {
  id: string;
  baseline: boolean;
  text: string;
  claimed: string[];
  disposition?: string;
  phase?: string | null;
}

export type AnnotationStatus = "open" | "digested";

export interface AnnotationItem {
  id: string;
  ts: string;
  updatedAt?: string;
  target: string;
  type: AnnotationType | string;
  text: string;
  status: AnnotationStatus | string;
  action?: AnnotationAction | string;
  note?: string;
}

export interface AnnotationEditPayload {
  id: string;
  target: string;
  type: AnnotationType;
  text: string;
  action?: AnnotationAction | "";
  status?: AnnotationStatus;
  note?: string;
}

export interface LocalIssueItem {
  id: string;
  title: string;
  file?: string;
  status?: string;
  originalStatus?: string;
  disposition?: string;
  state?: string;
  open?: boolean;
  source: string;
}

export interface DeferredDebtItem {
  text: string;
  kind: string;
  condition: string;
  owner: string;
  source: string;
}

export interface DebtLedger {
  localIssues: LocalIssueItem[];
  openAnnotations: AnnotationItem[];
  deferred: DeferredDebtItem[];
  parked: DeferredDebtItem[];
  dismissed?: DeferredDebtItem[];
  counts: {
    openIssues: number;
    openAnnotations: number;
    deferred: number;
    parked: number;
    dismissed?: number;
    total: number;
  };
}

export interface TelemetryDay {
  date: string;
  count: number;
}

export interface ToolTelemetry {
  series: TelemetryDay[];
  byTool: Record<string, number>;
  total: number;
  empty: boolean;
}

export interface ReqGraphNode {
  id: string;
  text: string;
  baseline: boolean;
  claimed: string[];
  phase: string | null;
  group: string;
  note: "" | "claimed-no-dep" | "unclaimed" | string;
}

export interface ReqGraphEdge {
  from: string;
  to: string;
  kind: string;
  via: string[];
}

export interface ProjectSummary {
  root: string;
  name: string;
  exists: boolean;
}

export interface ProjectBoardState {
  generated: string;
  root: string;
  name: string;
  declared: string | null;
  activePhase: string | null;
  state: {
    declared: string | null;
    activePhase: string | null;
    plans: number;
    summaries: number;
    repairsPending: number;
  };
  phases: PhaseNode[];
  topo: {
    edges: [string, string][];
  };
  contexts: Record<string, string>;
  reqs: RequirementItem[];
  annotations: AnnotationItem[];
  issues: LocalIssueItem[];
  issuesOpen: number;
  debt: DebtLedger;
  productSurfaceWarn: string[];
  debtWarn: string[];
  telemetry: ToolTelemetry;
  reqGraph: {
    nodes: ReqGraphNode[];
    edges: ReqGraphEdge[];
  };
}
