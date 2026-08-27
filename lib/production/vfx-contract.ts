import { z } from "zod";

export const VFX_CATEGORIES = [
  "cleanup",
  "screen_replacement",
  "set_extension",
  "matte_painting",
  "simulation",
  "creature",
  "environment",
] as const;

export const VFX_COMPLEXITIES = ["low", "medium", "high"] as const;
export const VFX_QC_KEYS = [
  "edges",
  "motion",
  "lighting",
  "color",
  "grain",
  "integration",
] as const;
export const VFX_QC_STATUSES = ["pending", "pass", "fail"] as const;
export const VFX_TASK_STAGES = ["element", "composite"] as const;

const textList = z.array(z.string().trim().min(1).max(2_000)).max(50);
const assetIds = z.array(z.string().trim().min(1).max(191)).max(50);

export const vfxShotPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    panelId: z.string().trim().min(1).max(191),
    category: z.enum(VFX_CATEGORIES),
    complexity: z.enum(VFX_COMPLEXITIES),
    summary: z.string().trim().min(1).max(6_000),
    colorSpace: z.string().trim().min(1).max(160),
    plate: z.object({ requirements: textList, assetIds }),
    elements: z.object({ requirements: textList, assetIds }),
    trackingRequirements: textList,
    matteRequirements: textList,
    compositeNotes: textList,
    qc: z.record(
      z.enum(VFX_QC_KEYS),
      z.object({
        status: z.enum(VFX_QC_STATUSES),
        note: z.string().trim().max(2_000),
      }),
    ),
  })
  .strict();

export type VfxShotPackage = z.infer<typeof vfxShotPackageSchema>;
export type VfxTaskStage = (typeof VFX_TASK_STAGES)[number];

export function parseVfxShotPackage(value: unknown) {
  return vfxShotPackageSchema.safeParse(value);
}

export function emptyVfxQc(): VfxShotPackage["qc"] {
  return Object.fromEntries(
    VFX_QC_KEYS.map((key) => [key, { status: "pending", note: "" }]),
  ) as VfxShotPackage["qc"];
}
