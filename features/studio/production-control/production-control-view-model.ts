import {
  parseProductionAcceptance,
  parseProductionControl,
  type ProductionAcceptance,
  type ProductionControl,
} from "@/lib/production/acceptance-contract";
import {
  MASTER_QC_KEYS,
  parsePostMasterPackage,
  parseSoundPostPackage,
  SOUND_QC_KEYS,
} from "@/lib/production/post-contract";

import type {
  ProductionDeliverableCatalog,
  ProductionDeliverableRecord,
  StudioStageState,
  StudioUsageCost,
  WorkspaceSnapshot,
} from "../types";

const CONTROL_TYPE = "production_control";
const ACCEPTANCE_TYPE = "production_acceptance";

export function buildDefaultProductionControl(
  projectId: string,
): ProductionControl {
  return {
    schemaVersion: 1,
    projectId,
    budget: { currency: "CNY", limit: 0, contingencyPercent: 10 },
    milestones: [],
    notes: "",
  };
}

export function getCurrentDeliverables(
  deliverables: ProductionDeliverableRecord[],
) {
  const current = new Map<string, ProductionDeliverableRecord>();
  for (const deliverable of [...deliverables].sort(
    (left, right) => right.version - left.version,
  )) {
    const key = `${deliverable.scopeType}:${deliverable.scopeId}:${deliverable.deliverableType}`;
    if (!current.has(key)) current.set(key, deliverable);
  }
  return [...current.values()].filter((item) => item.status !== "superseded");
}

export function getProductionControlVersions(
  deliverables: ProductionDeliverableRecord[],
  projectId: string,
) {
  return deliverables
    .filter(
      (item) =>
        item.deliverableType === CONTROL_TYPE &&
        item.scopeType === "project" &&
        item.scopeId === projectId,
    )
    .sort((left, right) => right.version - left.version)
    .map((deliverable) => {
      const parsed = parseProductionControl(deliverable.payload);
      return { deliverable, package: parsed.success ? parsed.data : null };
    });
}

export function getAcceptanceVersions(
  deliverables: ProductionDeliverableRecord[],
  projectId: string,
) {
  return deliverables
    .filter(
      (item) =>
        item.deliverableType === ACCEPTANCE_TYPE &&
        item.scopeType === "project" &&
        item.scopeId === projectId,
    )
    .sort((left, right) => right.version - left.version)
    .map((deliverable) => {
      const parsed = parseProductionAcceptance(deliverable.payload);
      return { deliverable, report: parsed.success ? parsed.data : null };
    });
}

export function summarizeDepartments(catalog: ProductionDeliverableCatalog) {
  const current = getCurrentDeliverables(catalog.deliverables).filter(
    (item) => ![CONTROL_TYPE, ACCEPTANCE_TYPE].includes(item.deliverableType),
  );
  return catalog.departments.map((department) => {
    const owned = current.filter((item) => item.department === department.id);
    return {
      id: department.id,
      agents: department.agents,
      current: owned.length,
      approved: owned.filter((item) => item.status === "approved").length,
      locked: owned.filter((item) => item.status === "locked").length,
      blocked: owned.filter(
        (item) => item.status === "stale" || hasDependencyBlocker(item),
      ).length,
      pendingGates: owned.reduce(
        (total, item) =>
          total +
          item.approvalGates.filter((gate) => gate.status === "pending").length,
        0,
      ),
    };
  });
}

export function getBatchApprovalCandidates(
  deliverables: ProductionDeliverableRecord[],
) {
  return getCurrentDeliverables(deliverables).filter(
    (item) =>
      item.status === "review" &&
      item.approvalGates.some((gate) => gate.status === "pending") &&
      !hasDependencyBlocker(item),
  );
}

export function summarizeProjectCost(costs: StudioUsageCost[]) {
  return costs.reduce((total, item) => {
    const value = Number(item.cost);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

export function buildProductionAcceptance(input: {
  catalog: ProductionDeliverableCatalog;
  control: ProductionControl;
  costs: StudioUsageCost[];
  episodeId?: string;
  generatedAt: string;
  stages: StudioStageState[];
  snapshot: WorkspaceSnapshot;
}): ProductionAcceptance {
  const current = getCurrentDeliverables(input.catalog.deliverables);
  const departments = summarizeDepartments(input.catalog).map((department) => ({
    id: department.id,
    current: department.current,
    approved: department.approved,
    locked: department.locked,
    blocked: department.blocked,
    pendingGates: department.pendingGates,
  }));
  const actual = summarizeProjectCost(input.costs);
  const contingency =
    input.control.budget.limit *
    (input.control.budget.contingencyPercent / 100);
  const forecast = actual;
  const variance = input.control.budget.limit + contingency - forecast;
  const checks: ProductionAcceptance["checks"] = [];

  const failedRuntime =
    input.snapshot.tasks.filter((task) => task.status === "failed").length +
    input.snapshot.workflows.filter((run) => run.status === "failed").length;
  const activeRuntime =
    input.snapshot.tasks.filter((task) =>
      ["queued", "running"].includes(task.status),
    ).length +
    input.snapshot.workflows.filter((run) =>
      ["queued", "running", "canceling"].includes(run.status),
    ).length;
  checks.push({
    id: "runtime",
    category: "workflow",
    status: failedRuntime ? "fail" : activeRuntime ? "pending" : "pass",
    evidence: `${failedRuntime} failed, ${activeRuntime} active`,
  });

  const failedStages = input.stages.filter((stage) =>
    ["failed", "blocked"].includes(stage.status),
  ).length;
  const incompleteStages = input.stages.filter(
    (stage) => stage.status !== "completed",
  ).length;
  checks.push({
    id: "stage-readiness",
    category: "workflow",
    status: failedStages
      ? "fail"
      : input.stages.length && !incompleteStages
        ? "pass"
        : "pending",
    evidence: `${input.stages.length} stages, ${incompleteStages} incomplete, ${failedStages} failed or blocked`,
  });

  const approvalItems = current.filter(
    (item) => ![CONTROL_TYPE, ACCEPTANCE_TYPE].includes(item.deliverableType),
  );
  const stale = approvalItems.filter((item) => item.status === "stale").length;
  const unlocked = approvalItems.filter(
    (item) => item.status !== "locked",
  ).length;
  checks.push({
    id: "approval-chain",
    category: "approval",
    status: stale
      ? "fail"
      : approvalItems.length && !unlocked
        ? "pass"
        : "pending",
    evidence: `${approvalItems.length} current, ${unlocked} unlocked, ${stale} stale`,
  });

  checks.push({
    id: "budget",
    category: "budget",
    status:
      input.control.budget.limit <= 0
        ? "pending"
        : variance >= 0
          ? "pass"
          : "fail",
    evidence: `${input.control.budget.currency} ${forecast.toFixed(6)} / ${(input.control.budget.limit + contingency).toFixed(6)}`,
  });

  const today = input.generatedAt.slice(0, 10);
  const overdue = input.control.milestones.filter(
    (item) => item.dueDate < today && item.status !== "completed",
  ).length;
  const blockedMilestones = input.control.milestones.filter(
    (item) => item.status === "blocked",
  ).length;
  const incomplete = input.control.milestones.filter(
    (item) => item.status !== "completed",
  ).length;
  checks.push({
    id: "schedule",
    category: "schedule",
    status:
      overdue || blockedMilestones
        ? "fail"
        : input.control.milestones.length && !incomplete
          ? "pass"
          : "pending",
    evidence: `${input.control.milestones.length} milestones, ${overdue} overdue, ${blockedMilestones} blocked`,
  });

  appendPostChecks(checks, current, input.episodeId);

  const blockers = checks
    .filter((check) => check.status !== "pass")
    .map((check) => `${check.id}: ${check.evidence}`);
  const overallStatus = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.every((check) => check.status === "pass")
      ? "pass"
      : "pending";

  return {
    schemaVersion: 1,
    projectId: input.control.projectId,
    episodeId: input.episodeId ?? null,
    generatedAt: input.generatedAt,
    overallStatus,
    stages: input.stages.map((stage) => ({
      id: stage.id,
      status: stage.status,
      completedTasks: stage.completedTasks,
      failedTasks: stage.failedTasks,
      totalTasks: stage.totalTasks,
    })),
    departments,
    finance: {
      currency: input.control.budget.currency,
      budget: input.control.budget.limit,
      actual,
      contingency,
      forecast,
      variance,
    },
    checks,
    blockers,
    audit: {
      deliverableIds: current
        .filter((item) => item.deliverableType !== ACCEPTANCE_TYPE)
        .map((item) => item.id),
      workflowIds: input.snapshot.workflows.map((item) => item.id),
      taskIds: input.snapshot.tasks.map((item) => item.id),
    },
  };
}

function appendPostChecks(
  checks: ProductionAcceptance["checks"],
  current: ProductionDeliverableRecord[],
  episodeId?: string,
) {
  const scoped = (type: string) =>
    current
      .filter(
        (item) =>
          item.deliverableType === type &&
          (!episodeId || item.episodeId === episodeId),
      )
      .sort((left, right) => right.version - left.version)[0];
  const sound = scoped("sound_post_package");
  const parsedSound = sound ? parseSoundPostPackage(sound.payload) : null;
  for (const key of SOUND_QC_KEYS) {
    const check = parsedSound?.success ? parsedSound.data.qc[key] : null;
    checks.push({
      id: `sound-${key}`,
      category: "sound_qc",
      status: check?.status ?? "pending",
      evidence: check
        ? `${check.measured ?? "n/a"} ${check.unit} / ${check.target ?? "n/a"}`
        : "sound package missing",
    });
  }
  const master = scoped("post_master_package");
  const parsedMaster = master ? parsePostMasterPackage(master.payload) : null;
  for (const key of MASTER_QC_KEYS) {
    const check = parsedMaster?.success ? parsedMaster.data.qc[key] : null;
    checks.push({
      id: `master-${key}`,
      category: "master_qc",
      status: check?.status ?? "pending",
      evidence: check
        ? `${check.measured ?? "n/a"} ${check.unit} / ${check.target ?? "n/a"}`
        : "master package missing",
    });
  }
}

function hasDependencyBlocker(deliverable: ProductionDeliverableRecord) {
  return deliverable.dependencies.some(
    (dependency) =>
      !["approved", "locked"].includes(dependency.status) ||
      dependency.requiredVersion !== dependency.currentVersion,
  );
}
