import { z } from "zod";

import { POST_QC_STATUSES } from "./post-contract";

export const MILESTONE_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
  "blocked",
] as const;
export const ACCEPTANCE_STATUSES = ["pending", "pass", "fail"] as const;

export const productionControlSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().trim().min(1).max(191),
    budget: z
      .object({
        currency: z.string().trim().min(3).max(8),
        limit: z.number().finite().min(0),
        contingencyPercent: z.number().finite().min(0).max(100),
      })
      .strict(),
    milestones: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(191),
            name: z.string().trim().min(1).max(500),
            department: z.string().trim().min(1).max(64),
            dueDate: z.string().date(),
            status: z.enum(MILESTONE_STATUSES),
            note: z.string().trim().max(2_000),
          })
          .strict(),
      )
      .max(500),
    notes: z.string().trim().max(6_000),
  })
  .strict();

const acceptanceCheck = z
  .object({
    id: z.string().trim().min(1).max(191),
    category: z.enum([
      "workflow",
      "approval",
      "budget",
      "schedule",
      "sound_qc",
      "master_qc",
    ]),
    status: z.enum(POST_QC_STATUSES),
    evidence: z.string().trim().max(2_000),
  })
  .strict();

export const productionAcceptanceSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().trim().min(1).max(191),
    episodeId: z.string().trim().min(1).max(191).nullable(),
    generatedAt: z.string().datetime({ offset: true }),
    overallStatus: z.enum(ACCEPTANCE_STATUSES),
    stages: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(64),
            status: z.string().trim().min(1).max(64),
            completedTasks: z.number().int().min(0),
            failedTasks: z.number().int().min(0),
            totalTasks: z.number().int().min(0),
          })
          .strict(),
      )
      .max(32),
    departments: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(64),
            current: z.number().int().min(0),
            approved: z.number().int().min(0),
            locked: z.number().int().min(0),
            blocked: z.number().int().min(0),
            pendingGates: z.number().int().min(0),
          })
          .strict(),
      )
      .max(64),
    finance: z
      .object({
        currency: z.string().trim().min(3).max(8),
        budget: z.number().finite().min(0),
        actual: z.number().finite().min(0),
        contingency: z.number().finite().min(0),
        forecast: z.number().finite().min(0),
        variance: z.number().finite(),
      })
      .strict(),
    checks: z.array(acceptanceCheck).max(500),
    blockers: z.array(z.string().trim().min(1).max(2_000)).max(500),
    audit: z
      .object({
        deliverableIds: z.array(z.string().trim().min(1).max(191)).max(10_000),
        workflowIds: z.array(z.string().trim().min(1).max(191)).max(10_000),
        taskIds: z.array(z.string().trim().min(1).max(191)).max(10_000),
      })
      .strict(),
  })
  .strict();

export type ProductionControl = z.infer<typeof productionControlSchema>;
export type ProductionAcceptance = z.infer<typeof productionAcceptanceSchema>;

export function parseProductionControl(value: unknown) {
  return productionControlSchema.safeParse(value);
}

export function parseProductionAcceptance(value: unknown) {
  return productionAcceptanceSchema.safeParse(value);
}
