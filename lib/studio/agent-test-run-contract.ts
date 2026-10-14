import { z } from "zod";
import { managementConfigurationPatchSchema } from "@/lib/production-configuration/management";

export const studioAgentTestRunRequestSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  locale: z.enum(["en", "zh-CN"]).default("zh-CN"),
  context: z.object({
    view: z.enum(["workflow", "canvas"]).optional(),
    canvasNodeId: z.string().max(200).optional(),
    episodeId: z.string().max(200).optional(),
    selection: z.object({
      id: z.string().min(1).max(200),
      kind: z.string().min(1).max(100),
      label: z.string().max(300),
      metadata: z.record(z.string(), z.union([z.boolean(), z.number(), z.string(), z.null()])).optional(),
    }).optional(),
    stageId: z.enum(["writing", "assets", "storyboard", "shots", "audio", "delivery"]),
  }).strict(),
  draft: managementConfigurationPatchSchema.pick({ agents: true }).strict().optional(),
}).strict();

export type StudioAgentTestRunRequest = z.infer<typeof studioAgentTestRunRequestSchema>;
