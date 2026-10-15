import { z } from "zod";

const note = z.string().trim().min(1).max(600);
const notes = z.array(note).max(12);

export const spatialAuditContentSchema = z.object({
  observations: notes.min(1),
  allowedMotion: notes.min(1),
  forbiddenAdditions: notes,
  conflicts: notes,
  timeBudget: note,
}).strict();

export const spatialAuditSchema = spatialAuditContentSchema.extend({
  referenceAssetIds: z.array(z.string().min(1)).min(1).max(2),
});
export type SpatialAudit = z.infer<typeof spatialAuditSchema>;

export const videoVisualReviewSchema = z.object({
  summary: note,
  findings: z.array(z.object({
    category: z.enum(["space", "identity", "action", "camera", "lighting", "continuity"]),
    frameNumbers: z.array(z.number().int().min(1).max(6)).min(1).max(6),
    observation: note,
    minimalRepair: note,
  }).strict()).max(12),
  limitations: notes.min(1),
}).strict();
export type VideoVisualReview = z.infer<typeof videoVisualReviewSchema>;
export type VideoVisualReviewResult = {
  review: VideoVisualReview;
  videoAssetId: string;
  referenceAssetIds: string[];
  frames: { frameNumber: number; second: number }[];
  durationSeconds: number;
  coverage: "sampled_frames_only";
  audio: "not_checked";
  continuousMotion: "not_checked";
};
