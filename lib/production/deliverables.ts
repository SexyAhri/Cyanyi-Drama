import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/server/prisma";
import {
  departmentOwnsDeliverableType,
  getProductionDepartment,
} from "./departments";

export type ProductionDeliverableStatus =
  | "draft"
  | "review"
  | "approved"
  | "locked"
  | "stale"
  | "superseded";

export const PRODUCTION_DELIVERABLE_STATUSES = [
  "draft",
  "review",
  "approved",
  "locked",
  "stale",
  "superseded",
] as const satisfies readonly ProductionDeliverableStatus[];

export type ProductionDeliverableAction =
  | "submit"
  | "approve"
  | "reject"
  | "lock"
  | "supersede"
  | "restore";

export class ProductionDeliverableError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function createProductionDeliverable(
  userId: string,
  projectId: string,
  input: {
    department: string;
    deliverableType: string;
    title: string;
    scopeType: string;
    scopeId: string;
    episodeId?: string;
    payload: Record<string, unknown>;
    sourceRefs?: unknown[];
    promptTrace?: unknown;
    cost?: number | string;
    dependencyIds?: string[];
  },
) {
  const department = getProductionDepartment(input.department);
  if (!department)
    throw new ProductionDeliverableError("PRODUCTION_DEPARTMENT_INVALID");
  if (!departmentOwnsDeliverableType(input.department, input.deliverableType))
    throw new ProductionDeliverableError("PRODUCTION_DELIVERABLE_TYPE_INVALID");
  const title = input.title.trim();
  const scopeType = input.scopeType.trim();
  const scopeId = input.scopeId.trim();
  if (!title || !scopeType || !scopeId)
    throw new ProductionDeliverableError(
      "PRODUCTION_DELIVERABLE_INPUT_REQUIRED",
    );

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!project) throw new ProductionDeliverableError("项目不存在", 404);
  if (input.episodeId) {
    const episode = await prisma.episode.count({
      where: { id: input.episodeId, projectId },
    });
    if (!episode) throw new ProductionDeliverableError("剧集不存在", 404);
  }

  const dependencyIds = [...new Set(input.dependencyIds ?? [])];
  const dependencies = dependencyIds.length
    ? await prisma.productionDeliverable.findMany({
        where: { id: { in: dependencyIds }, projectId, userId },
        select: { id: true, version: true },
      })
    : [];
  if (dependencies.length !== dependencyIds.length)
    throw new ProductionDeliverableError("PRODUCTION_DEPENDENCY_INVALID");
  const cost = normalizeCost(input.cost);
  const dependencyHash = createDependencyHash(dependencies);

  return prisma.$transaction(async (tx) => {
    const previous = await tx.productionDeliverable.findFirst({
      where: {
        projectId,
        scopeType,
        scopeId,
        deliverableType: input.deliverableType,
      },
      orderBy: { version: "desc" },
      select: { id: true, version: true },
    });
    const now = new Date();
    if (previous) {
      await tx.productionDeliverable.update({
        where: { id: previous.id },
        data: { status: "superseded", supersededAt: now },
      });
      await markDependentDeliverablesStale(tx, previous.id);
    }
    const row = await tx.productionDeliverable.create({
      data: {
        id: randomUUID(),
        userId,
        projectId,
        episodeId: input.episodeId,
        scopeType,
        scopeId,
        department: input.department,
        deliverableType: input.deliverableType,
        title,
        status: "draft",
        version: (previous?.version ?? 0) + 1,
        payload: toJson(input.payload),
        sourceRefs: input.sourceRefs ? toJson(input.sourceRefs) : undefined,
        promptTrace:
          input.promptTrace === undefined
            ? undefined
            : toJson(input.promptTrace),
        cost,
        dependencyHash,
        approvalGates: {
          create: department.requiredGates.map((gateKey) => ({
            id: randomUUID(),
            gateKey,
            status: "pending",
          })),
        },
        dependencies: {
          create: dependencies.map((dependency) => ({
            id: randomUUID(),
            dependsOnId: dependency.id,
            requiredVersion: dependency.version,
          })),
        },
      },
      include: deliverableInclude,
    });
    return toDeliverable(row);
  });
}

export async function listProductionDeliverables(
  userId: string,
  projectId: string,
  filter?: { department?: string; episodeId?: string; status?: string },
) {
  const project = await prisma.project.count({
    where: { id: projectId, userId },
  });
  if (!project) throw new ProductionDeliverableError("项目不存在", 404);
  const rows = await prisma.productionDeliverable.findMany({
    where: {
      userId,
      projectId,
      ...(filter?.department ? { department: filter.department } : {}),
      ...(filter?.episodeId ? { episodeId: filter.episodeId } : {}),
      ...(filter?.status ? { status: filter.status } : {}),
    },
    include: deliverableInclude,
    orderBy: [{ updatedAt: "desc" }, { version: "desc" }],
  });
  return rows.map(toDeliverable);
}

export async function transitionProductionDeliverable(
  userId: string,
  projectId: string,
  deliverableId: string,
  input: {
    action: ProductionDeliverableAction;
    gateKey?: string;
    note?: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.productionDeliverable.findFirst({
      where: { id: deliverableId, projectId, userId },
      include: deliverableInclude,
    });
    if (!current) throw new ProductionDeliverableError("交付物不存在", 404);
    const now = new Date();
    if (input.action === "restore") {
      assertStatus(current.status, ["superseded"], input.action);
      const latest = await tx.productionDeliverable.findFirst({
        where: {
          projectId,
          userId,
          scopeType: current.scopeType,
          scopeId: current.scopeId,
          deliverableType: current.deliverableType,
        },
        orderBy: { version: "desc" },
        include: deliverableInclude,
      });
      if (!latest || latest.id === current.id)
        throw new ProductionDeliverableError(
          "PRODUCTION_DELIVERABLE_RESTORE_INVALID",
          409,
        );
      if (latest.status !== "superseded") {
        await tx.productionDeliverable.update({
          where: { id: latest.id },
          data: { status: "superseded", supersededAt: now },
        });
        await markDependentDeliverablesStale(tx, latest.id);
      }
      const restored = await tx.productionDeliverable.create({
        data: {
          id: randomUUID(),
          userId,
          projectId,
          episodeId: current.episodeId,
          scopeType: current.scopeType,
          scopeId: current.scopeId,
          department: current.department,
          deliverableType: current.deliverableType,
          title: current.title,
          status: "draft",
          version: latest.version + 1,
          payload: toJson(current.payload),
          sourceRefs:
            current.sourceRefs === null ? undefined : toJson(current.sourceRefs),
          promptTrace:
            current.promptTrace === null
              ? undefined
              : toJson(current.promptTrace),
          cost: current.cost,
          dependencyHash: current.dependencyHash,
          approvalGates: {
            create: current.approvalGates.map((gate) => ({
              id: randomUUID(),
              gateKey: gate.gateKey,
              status: "pending",
            })),
          },
          dependencies: {
            create: current.dependencies.map((dependency) => ({
              id: randomUUID(),
              dependsOnId: dependency.dependsOn.id,
              requiredVersion: dependency.requiredVersion,
            })),
          },
        },
        include: deliverableInclude,
      });
      return toDeliverable(restored);
    }
    if (input.action === "submit") {
      assertStatus(current.status, ["draft"], input.action);
      if (
        current.dependencies.some(
          (dependency) =>
            !["approved", "locked"].includes(dependency.dependsOn.status),
        )
      )
        throw new ProductionDeliverableError(
          "PRODUCTION_DEPENDENCY_NOT_APPROVED",
          409,
        );
      await tx.productionApprovalGate.updateMany({
        where: { deliverableId },
        data: {
          status: "pending",
          decidedAt: null,
          decidedByUserId: null,
          note: null,
        },
      });
      await tx.productionDeliverable.update({
        where: { id: deliverableId },
        data: {
          status: "review",
          submittedAt: now,
          approvedAt: null,
          approvedByUserId: null,
        },
      });
    } else if (input.action === "approve" || input.action === "reject") {
      assertStatus(current.status, ["review"], input.action);
      const gateKey = input.gateKey?.trim();
      if (
        !gateKey ||
        !current.approvalGates.some((gate) => gate.gateKey === gateKey)
      )
        throw new ProductionDeliverableError(
          "PRODUCTION_APPROVAL_GATE_INVALID",
        );
      const gate = current.approvalGates.find(
        (approvalGate) => approvalGate.gateKey === gateKey,
      );
      if (gate?.status !== "pending")
        throw new ProductionDeliverableError(
          "PRODUCTION_APPROVAL_GATE_ALREADY_DECIDED",
          409,
        );
      await tx.productionApprovalGate.update({
        where: { deliverableId_gateKey: { deliverableId, gateKey } },
        data: {
          status: input.action === "approve" ? "approved" : "rejected",
          decidedByUserId: userId,
          note: input.note?.trim() || null,
          decidedAt: now,
        },
      });
      if (input.action === "reject") {
        await tx.productionDeliverable.update({
          where: { id: deliverableId },
          data: {
            status: "draft",
            approvedAt: null,
            approvedByUserId: null,
          },
        });
      } else {
        const remaining = await tx.productionApprovalGate.count({
          where: { deliverableId, status: { not: "approved" } },
        });
        if (!remaining)
          await tx.productionDeliverable.update({
            where: { id: deliverableId },
            data: {
              status: "approved",
              approvedAt: now,
              approvedByUserId: userId,
            },
          });
      }
    } else if (input.action === "lock") {
      assertStatus(current.status, ["approved"], input.action);
      await tx.productionDeliverable.update({
        where: { id: deliverableId },
        data: { status: "locked", lockedAt: now },
      });
    } else {
      assertStatus(
        current.status,
        ["draft", "review", "approved", "locked", "stale"],
        input.action,
      );
      await tx.productionDeliverable.update({
        where: { id: deliverableId },
        data: { status: "superseded", supersededAt: now },
      });
      await markDependentDeliverablesStale(tx, deliverableId);
    }
    const updated = await tx.productionDeliverable.findUniqueOrThrow({
      where: { id: deliverableId },
      include: deliverableInclude,
    });
    return toDeliverable(updated);
  });
}

export function canTransitionProductionDeliverable(
  status: string,
  action: ProductionDeliverableAction,
) {
  if (action === "restore") return status === "superseded";
  if (action === "submit") return status === "draft";
  if (action === "approve" || action === "reject") return status === "review";
  if (action === "lock") return status === "approved";
  return ["draft", "review", "approved", "locked", "stale"].includes(status);
}

async function markDependentDeliverablesStale(
  tx: Prisma.TransactionClient,
  sourceId: string,
) {
  let frontier = [sourceId];
  const visited = new Set(frontier);
  while (frontier.length) {
    const edges = await tx.productionDeliverableDependency.findMany({
      where: { dependsOnId: { in: frontier } },
      select: { deliverableId: true },
    });
    const next = [...new Set(edges.map((edge) => edge.deliverableId))].filter(
      (id) => !visited.has(id),
    );
    if (!next.length) return;
    next.forEach((id) => visited.add(id));
    await tx.productionDeliverable.updateMany({
      where: { id: { in: next }, status: { not: "superseded" } },
      data: {
        status: "stale",
        approvedAt: null,
        approvedByUserId: null,
        lockedAt: null,
      },
    });
    frontier = next;
  }
}

function assertStatus(
  status: string,
  allowed: string[],
  action: ProductionDeliverableAction,
) {
  if (!allowed.includes(status))
    throw new ProductionDeliverableError(
      `PRODUCTION_DELIVERABLE_ACTION_INVALID:${status}:${action}`,
      409,
    );
}

const deliverableInclude = {
  approvalGates: { orderBy: { gateKey: "asc" as const } },
  dependencies: {
    orderBy: { createdAt: "asc" as const },
    include: {
      dependsOn: {
        select: { id: true, title: true, version: true, status: true },
      },
    },
  },
} as const;

type DeliverableRow = Prisma.ProductionDeliverableGetPayload<{
  include: typeof deliverableInclude;
}>;

function toDeliverable(row: DeliverableRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    episodeId: row.episodeId ?? undefined,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    department: row.department,
    deliverableType: row.deliverableType,
    title: row.title,
    status: row.status as ProductionDeliverableStatus,
    version: row.version,
    payload: row.payload as Record<string, unknown>,
    sourceRefs: (row.sourceRefs as unknown[] | null) ?? [],
    promptTrace: row.promptTrace ?? undefined,
    cost: row.cost.toFixed(6),
    dependencyHash: row.dependencyHash,
    approvedByUserId: row.approvedByUserId ?? undefined,
    approvalGates: row.approvalGates.map((gate) => ({
      key: gate.gateKey,
      status: gate.status,
      decidedByUserId: gate.decidedByUserId ?? undefined,
      note: gate.note ?? undefined,
      decidedAt: gate.decidedAt?.toISOString(),
    })),
    dependencies: row.dependencies.map((dependency) => ({
      id: dependency.dependsOn.id,
      title: dependency.dependsOn.title,
      status: dependency.dependsOn.status,
      requiredVersion: dependency.requiredVersion,
      currentVersion: dependency.dependsOn.version,
    })),
    submittedAt: row.submittedAt?.toISOString(),
    approvedAt: row.approvedAt?.toISOString(),
    lockedAt: row.lockedAt?.toISOString(),
    supersededAt: row.supersededAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizeCost(value: number | string | undefined) {
  try {
    const cost = new Prisma.Decimal(value ?? 0);
    if (cost.isNegative()) throw new Error("negative");
    return cost;
  } catch {
    throw new ProductionDeliverableError("PRODUCTION_COST_INVALID");
  }
}

export function createDependencyHash(
  dependencies: Array<{ id: string; version: number }>,
) {
  const canonical = dependencies
    .map((dependency) => `${dependency.id}:${dependency.version}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}
