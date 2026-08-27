import type { ProductionDeliverableRecord } from "../types";

export function filterProductionDeliverables(
  deliverables: ProductionDeliverableRecord[],
  departments: string[],
  types?: string[],
) {
  const departmentSet = new Set(departments);
  const typeSet = types ? new Set(types) : null;
  return deliverables.filter(
    (deliverable) =>
      departmentSet.has(deliverable.department) &&
      (!typeSet || typeSet.has(deliverable.deliverableType)),
  );
}

export function getDeliverableBlockers(
  deliverable: ProductionDeliverableRecord,
) {
  return deliverable.dependencies.filter(
    (dependency) =>
      !["approved", "locked"].includes(dependency.status) ||
      dependency.requiredVersion !== dependency.currentVersion,
  );
}

export function getNextPendingGate(
  deliverable: ProductionDeliverableRecord,
) {
  return deliverable.approvalGates.find((gate) => gate.status === "pending");
}

export function payloadLines(value: unknown) {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string")
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  return [];
}
