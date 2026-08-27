import { z } from "zod";

export const POST_QC_STATUSES = ["pending", "pass", "fail"] as const;
export const ADR_STATUSES = [
  "not_required",
  "required",
  "recorded",
  "approved",
] as const;
export const CUE_STATUSES = ["planned", "ready", "approved"] as const;
export const MUSIC_RIGHTS_STATUSES = [
  "unreviewed",
  "cleared",
  "restricted",
] as const;
export const SOUND_QC_KEYS = [
  "loudness",
  "true_peak",
  "dialogue_sync",
  "intelligibility",
] as const;
export const MASTER_QC_KEYS = [
  "frame_rate",
  "resolution",
  "color_space",
  "black_frames",
  "subtitle_coverage",
  "subtitle_safe_area",
] as const;

const qcCheck = z
  .object({
    status: z.enum(POST_QC_STATUSES),
    measured: z.number().finite().nullable(),
    target: z.number().finite().nullable(),
    unit: z.string().trim().max(32),
    note: z.string().trim().max(2_000),
  })
  .strict();

export const soundPostPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    episodeId: z.string().trim().min(1).max(191),
    dialogue: z
      .array(
        z
          .object({
            lineId: z.string().trim().min(1).max(191),
            speaker: z.string().trim().min(1).max(191),
            text: z.string().trim().min(1).max(10_000),
            adrStatus: z.enum(ADR_STATUSES),
            reason: z.string().trim().max(2_000),
            syncOffsetMs: z.number().finite().min(-10_000).max(10_000),
          })
          .strict(),
      )
      .max(2_000),
    effects: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(191),
            type: z.enum(["sfx", "foley"]),
            description: z.string().trim().min(1).max(2_000),
            inMs: z.number().finite().min(0),
            outMs: z.number().finite().min(0),
            status: z.enum(CUE_STATUSES),
          })
          .strict()
          .refine((cue) => cue.outMs >= cue.inMs, {
            message: "Cue out point must follow its in point",
            path: ["outMs"],
          }),
      )
      .max(2_000),
    music: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(191),
            title: z.string().trim().min(1).max(500),
            inMs: z.number().finite().min(0),
            outMs: z.number().finite().min(0),
            rightsStatus: z.enum(MUSIC_RIGHTS_STATUSES),
            notes: z.string().trim().max(2_000),
          })
          .strict()
          .refine((cue) => cue.outMs >= cue.inMs, {
            message: "Music out point must follow its in point",
            path: ["outMs"],
          }),
      )
      .max(500),
    mix: z
      .object({
        format: z.string().trim().min(1).max(96),
        sampleRate: z.number().int().min(8_000).max(384_000),
        bitDepth: z.number().int().min(8).max(64),
        targetLufs: z.number().finite().min(-70).max(0),
        truePeakDbtp: z.number().finite().min(-30).max(0),
      })
      .strict(),
    qc: z.record(z.enum(SOUND_QC_KEYS), qcCheck),
  })
  .strict();

const edlTrack = z
  .object({
    id: z.string().trim().min(1).max(191),
    reel: z.string().trim().min(1).max(191),
    shotIndex: z.number().int().min(0),
    sourceAssetId: z.string().trim().max(191).nullable(),
    inMs: z.number().finite().min(0),
    outMs: z.number().finite().min(0),
  })
  .strict()
  .refine((track) => track.outMs >= track.inMs, {
    message: "EDL out point must follow its in point",
    path: ["outMs"],
  });

export const postMasterPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    episodeId: z.string().trim().min(1).max(191),
    edl: z
      .object({
        title: z.string().trim().min(1).max(500),
        frameRate: z.number().finite().min(1).max(240),
        durationMs: z.number().finite().min(0),
        tracks: z.array(edlTrack).max(10_000),
      })
      .strict(),
    color: z
      .object({
        workingSpace: z.string().trim().min(1).max(191),
        outputSpace: z.string().trim().min(1).max(191),
        lookName: z.string().trim().max(500),
        lutName: z.string().trim().max(500),
        notes: z.string().trim().max(4_000),
      })
      .strict(),
    online: z
      .object({
        resolution: z.string().trim().min(1).max(96),
        aspectRatio: z.string().trim().min(1).max(32),
        codec: z.string().trim().min(1).max(96),
        frameRate: z.number().finite().min(1).max(240),
      })
      .strict(),
    subtitles: z
      .object({
        language: z.string().trim().min(1).max(32),
        format: z.enum(["srt", "vtt", "ttml"]),
        cueCount: z.number().int().min(0),
        missingCueCount: z.number().int().min(0),
      })
      .strict(),
    qc: z.record(z.enum(MASTER_QC_KEYS), qcCheck),
  })
  .strict();

export type PostQcStatus = (typeof POST_QC_STATUSES)[number];
export type SoundPostPackage = z.infer<typeof soundPostPackageSchema>;
export type PostMasterPackage = z.infer<typeof postMasterPackageSchema>;

export function parseSoundPostPackage(value: unknown) {
  return soundPostPackageSchema.safeParse(value);
}

export function parsePostMasterPackage(value: unknown) {
  return postMasterPackageSchema.safeParse(value);
}

export function emptyPostQc<T extends readonly string[]>(keys: T) {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      { status: "pending", measured: null, target: null, unit: "", note: "" },
    ]),
  ) as Record<T[number], z.infer<typeof qcCheck>>;
}
