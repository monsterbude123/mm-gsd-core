import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDebtPrompt,
  computeBoardKpis,
  computePhaseDag,
  computeReqNeighborhood,
  debtItemKey,
  filterPhases,
  filterReqs,
  findDuplicateOpenAnnotation,
  formatAnnotationAction,
  getAnnotationsForPhase,
  getAnnotationsForReq,
  getPhaseFiveSteps,
  getPhaseRelatedAnnotations,
  getPhaseStatus,
  normalizeAnnotationTarget,
  normalizeProjectState,
  validateAnnotationInput,
  validateAnnotationPatch,
} from "./boardModel.ts";

describe("boardModel pure logic against live mm-gsd-web schema", () => {
  it("normalizes raw /api/state payload accurately (issuesOpen: number, summary object)", () => {
    const raw = {
      generated: "2026-11-18T00:00:00.000Z",
      root: "/tmp/projA",
      declared: "executing",
      activePhase: "22",
      state: { declared: "executing", activePhase: "22", plans: 2, summaries: 1, repairsPending: 1 },
      phases: [
        {
          phase: "21",
          title: "已交付",
          done: true,
          level: 0,
          depends_on: [],
          context: "ctx",
          plans: [
            {
              file: "21-01-PLAN.md",
              plan: "21-01",
              goal: "g1",
              isRepair: false,
              tickets: [],
              coversReq: ["REQ-01"],
              depends: [],
              check: { file: "21-01-PLAN-CHECK.md", status: "passed" },
              summary: { file: "21-01-SUMMARY.md", status: "complete", commits: "abc" },
            },
          ],
          verification: { file: "21-VERIFICATION.md", status: "passed" },
          ship: { file: "21-SHIP.md", status: "shipped" },
          debt: 0,
        },
        {
          phase: "22",
          title: "验收缺口",
          done: false,
          level: 1,
          depends_on: ["21"],
          context: "ctx2",
          plans: [
            {
              file: "22-01-PLAN.md",
              plan: "22-01",
              goal: "g2",
              isRepair: true,
              tickets: [],
              coversReq: ["REQ-02"],
              depends: ["21-01"],
              check: null,
              summary: null,
            },
          ],
          verification: { file: "22-VERIFICATION.md", status: "gaps_found" },
          ship: { file: "22-SHIP.md", status: "held" },
          debt: 2,
        },
      ],
      topo: { edges: [["21", "22"]] },
      contexts: { "21": "ctx" },
      reqs: [
        { id: "REQ-01", baseline: false, text: "需求一", claimed: ["21-01 T1"] },
        { id: "REQ-02", baseline: false, text: "需求二", claimed: ["22-01 T1"] },
        { id: "REQ-03", baseline: false, text: "未认领", claimed: [] },
        { id: "REQ-00", baseline: true, text: "基线", claimed: [] },
      ],
      annotations: [
        { id: "a-1", ts: "2026-11-18T00:00:00.000Z", target: "REQ-02", type: "备注", text: "first", status: "open" },
      ],
      issues: [{ id: "I-001", title: "closed issue", status: "open", open: false, file: "I-001.md" }],
      issuesOpen: 0,
      debt: {
        localIssues: [],
        openAnnotations: [
          { id: "a-1", ts: "2026-11-18T00:00:00.000Z", target: "REQ-02", type: "备注", text: "first", status: "open" },
        ],
        deferred: [{ text: "wait item", kind: "未分类", condition: "", owner: "", source: "22-01-SUMMARY.md" }],
        parked: [],
        counts: { openIssues: 0, openAnnotations: 1, deferred: 1, parked: 0, total: 2 },
      },
      productSurfaceWarn: [],
      debtWarn: [],
      telemetry: { series: [], byTool: {}, total: 0, empty: true },
      reqGraph: {
        nodes: [
          { id: "REQ-01", text: "需求一", baseline: false, claimed: ["21-01 T1"], phase: "21", group: "21", note: "" },
          { id: "REQ-02", text: "需求二", baseline: false, claimed: ["22-01 T1"], phase: "22", group: "22", note: "" },
        ],
        edges: [{ from: "REQ-02", to: "REQ-01", kind: "ticket-dep", via: ["22-01", "21-01"] }],
      },
    };

    const st = normalizeProjectState(raw);
    assert.equal(st.name, "projA");
    assert.equal(st.issuesOpen, 0);

    const kpis = computeBoardKpis(st);
    assert.equal(kpis.claimableCount, 3);
    assert.equal(kpis.claimedCount, 2);
    assert.equal(kpis.unclaimedCount, 1);
    assert.equal(kpis.phaseShipped, 1);
    assert.equal(kpis.debtTotal, 2);

    assert.equal(getPhaseStatus(st.phases[0]), "shipped");
    assert.equal(getPhaseStatus(st.phases[1]), "active");

    const p22Steps = getPhaseFiveSteps(st.phases[1]);
    assert.equal(p22Steps.find((s) => s.key === "verify")?.state, "warn");
    assert.equal(p22Steps.find((s) => s.key === "ship")?.state, "warn");
  });

  it("computes topological DAG layers & discards phantom/cycle edges deterministically", () => {
    const st = normalizeProjectState({
      phases: [
        { phase: "01", title: "A", done: false, level: 0, depends_on: [], context: null, plans: [], debt: 0 },
        { phase: "02", title: "B", done: false, level: 1, depends_on: ["01"], context: null, plans: [], debt: 0 },
        { phase: "03", title: "C", done: false, level: 2, depends_on: ["02"], context: null, plans: [], debt: 1 },
      ],
    });
    const dag = computePhaseDag(st.phases, [
      ["01", "02"],
      ["02", "03"],
      ["03", "01"],
      ["02", "99"],
    ]);
    assert.equal(dag.maxDepth, 3);
    assert.equal(dag.brokenCycleEdges.length, 1);
    assert.deepEqual(dag.validEdges, [["01", "02"], ["02", "03"]]);
    assert.equal(filterPhases(st.phases, "debt").length, 1);
  });

  it("filters REQs, builds neighborhood, validates and deduplicates annotations", () => {
    const reqs = [
      { id: "REQ-01", baseline: false, text: "热缓存", claimed: ["01-01 T1"] },
      { id: "REQ-02", baseline: false, text: "三级路由", claimed: [] },
      { id: "REQ-00", baseline: true, text: "旧功能", claimed: [] },
    ];
    assert.equal(filterReqs(reqs, "热缓存", "all").length, 1);
    assert.equal(filterReqs(reqs, "", "unclaimed").length, 1);
    assert.equal(filterReqs(reqs, "", "baseline").length, 1);

    const nb = computeReqNeighborhood(
      [
        { id: "REQ-01", text: "a", baseline: false, claimed: [], phase: "01", group: "01", note: "" },
        { id: "REQ-02", text: "b", baseline: false, claimed: [], phase: "02", group: "02", note: "" },
      ],
      [{ from: "REQ-02", to: "REQ-01", kind: "ticket-dep", via: ["02-01", "01-01"] }],
      "REQ-02"
    );
    assert.equal(nb.dependsOn.length, 1);
    assert.equal(nb.dependsOn[0].reqId, "REQ-01");

    assert.equal(validateAnnotationInput({ target: "", type: "备注", text: "" }).ok, false);
    assert.equal(validateAnnotationInput({ target: "REQ-01", type: "备注", text: "ok" }).ok, true);

    const dup = findDuplicateOpenAnnotation(
      [{ id: "a-1", ts: "", target: "phase:01", type: "备注", text: "hi", status: "open", action: "diagnose" }],
      "phase:01",
      "diagnose"
    );
    assert.equal(dup?.id, "a-1");

    const key = debtItemKey({ text: "hello  world", kind: "未分类", condition: "", owner: "", source: "01-SUMMARY.md" });
    assert.equal(key, "01-SUMMARY.md#hello world");
    assert.match(buildDebtPrompt({ text: "x", kind: "未分类", condition: "条件A", owner: "人", source: "01-SUMMARY.md" }), /条件A/);
  });

  it("matches Phase and REQ annotations across open/digested/diagnose states and target formats", () => {
    assert.equal(normalizeAnnotationTarget("REQ:REQ-01"), "REQ-01");
    assert.equal(normalizeAnnotationTarget("req-02"), "REQ-02");
    assert.equal(normalizeAnnotationTarget("Phase:01"), "phase:01");

    const annotations = [
      { id: "a-1", ts: "2026-11-19T00:00:00Z", target: "phase:01", type: "备注", text: "diag p1", status: "open", action: "diagnose" },
      { id: "a-2", ts: "2026-11-19T00:01:00Z", target: "ticket:01-02", type: "备注", text: "ticket note", status: "digested" },
      { id: "a-3", ts: "2026-11-19T00:02:00Z", target: "REQ:REQ-01", type: "备注", text: "diag r1", status: "open", action: "diagnose" },
      { id: "a-4", ts: "2026-11-19T00:03:00Z", target: "REQ-02", type: "需求遗漏", text: "done r2", status: "digested" },
    ];

    const p1 = getAnnotationsForPhase(annotations, "01");
    assert.equal(p1.total, 2);
    assert.equal(p1.open, 1);
    assert.equal(p1.digested, 1);
    assert.equal(p1.hasOpenDiagnose, true);

    const p2 = getAnnotationsForPhase(annotations, "02");
    assert.equal(p2.total, 0);
    assert.equal(p2.hasOpenDiagnose, false);

    const r1 = getAnnotationsForReq(annotations, "REQ-01");
    assert.equal(r1.total, 1);
    assert.equal(r1.open, 1);
    assert.equal(r1.hasOpenDiagnose, true);

    const r2 = getAnnotationsForReq(annotations, "REQ-02");
    assert.equal(r2.total, 1);
    assert.equal(r2.open, 0);
    assert.equal(r2.digested, 1);
    assert.equal(r2.hasOpenDiagnose, false);

    assert.equal(findDuplicateOpenAnnotation(annotations, "REQ-01", "diagnose")?.id, "a-3");
    assert.equal(formatAnnotationAction("diagnose"), "诊断");

    const reqs = [
      { id: "REQ-01", baseline: false, text: "a", claimed: ["01-01 T1"] },
      { id: "REQ-02", baseline: false, text: "b", claimed: ["02-01 T1"] },
      { id: "REQ-03", baseline: false, text: "c", claimed: [] },
    ];
    assert.deepEqual(
      filterReqs(reqs, "", "annotated", annotations).map((r) => r.id),
      ["REQ-01", "REQ-02"]
    );

    const rel = getPhaseRelatedAnnotations(
      annotations,
      { phase: "01", title: "P1", done: false, level: 0, depends_on: [], context: null, plans: [], verification: null, ship: null, debt: 0 },
      reqs
    );
    assert.deepEqual(
      rel.map((a) => a.id),
      ["a-1", "a-2", "a-3"]
    );
  });

  it("validates annotation edit patches strictly for id, target, type, text, action, and status", () => {
    assert.equal(
      validateAnnotationPatch({ id: "", target: "phase:01", type: "备注", text: "ok" }).ok,
      false
    );
    assert.equal(
      validateAnnotationPatch({ id: "a-1", target: " ", type: "备注", text: "ok" }).ok,
      false
    );
    assert.equal(
      validateAnnotationPatch({ id: "a-1", target: "phase:01", type: "无效", text: "ok" }).ok,
      false
    );
    assert.equal(
      validateAnnotationPatch({ id: "a-1", target: "phase:01", type: "备注", text: "" }).ok,
      false
    );
    assert.equal(
      validateAnnotationPatch({
        id: "a-1",
        target: "phase:01",
        type: "备注",
        text: "ok",
        action: "invalid",
      }).ok,
      false
    );
    assert.equal(
      validateAnnotationPatch({
        id: "a-1",
        target: "phase:01",
        type: "备注",
        text: "ok",
        status: "archived",
      }).ok,
      false
    );
    assert.equal(
      validateAnnotationPatch({
        id: "a-1",
        target: "REQ-01",
        type: "验收不过",
        text: "已更新描述",
        action: "",
        status: "digested",
      }).ok,
      true
    );
  });
});
