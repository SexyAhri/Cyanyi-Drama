import { describe, expect, it } from "vitest";

import {
  emptyPostQc,
  MASTER_QC_KEYS,
  parsePostMasterPackage,
  parseSoundPostPackage,
  SOUND_QC_KEYS,
} from "./post-contract";

describe("post-production contracts", () => {
  it("accepts a machine-readable sound package", () => {
    const result = parseSoundPostPackage({
      schemaVersion: 1,
      episodeId: "episode-1",
      dialogue: [
        {
          lineId: "line-1",
          speaker: "A",
          text: "Line",
          adrStatus: "required",
          reason: "Noise",
          syncOffsetMs: 42,
        },
      ],
      effects: [
        {
          id: "cue-1",
          type: "foley",
          description: "Footsteps",
          inMs: 100,
          outMs: 900,
          status: "planned",
        },
      ],
      music: [],
      mix: {
        format: "5.1 + stereo",
        sampleRate: 48_000,
        bitDepth: 24,
        targetLufs: -24,
        truePeakDbtp: -2,
      },
      qc: emptyPostQc(SOUND_QC_KEYS),
    });
    expect(result.success).toBe(true);
  });

  it("rejects inverted cue time ranges", () => {
    const result = parseSoundPostPackage({
      schemaVersion: 1,
      episodeId: "episode-1",
      dialogue: [],
      effects: [
        {
          id: "cue-1",
          type: "sfx",
          description: "Hit",
          inMs: 1_000,
          outMs: 500,
          status: "ready",
        },
      ],
      music: [],
      mix: {
        format: "stereo",
        sampleRate: 48_000,
        bitDepth: 24,
        targetLufs: -24,
        truePeakDbtp: -2,
      },
      qc: emptyPostQc(SOUND_QC_KEYS),
    });
    expect(result.success).toBe(false);
  });

  it("requires every master QC key", () => {
    const qc = emptyPostQc(MASTER_QC_KEYS);
    delete (qc as Partial<typeof qc>).color_space;
    const result = parsePostMasterPackage({
      schemaVersion: 1,
      episodeId: "episode-1",
      edl: { title: "Cut", frameRate: 24, durationMs: 1_000, tracks: [] },
      color: {
        workingSpace: "ACEScct",
        outputSpace: "Rec.709 Gamma 2.4",
        lookName: "Neutral",
        lutName: "",
        notes: "",
      },
      online: {
        resolution: "1920x1080",
        aspectRatio: "16:9",
        codec: "ProRes 422 HQ",
        frameRate: 24,
      },
      subtitles: {
        language: "zh-CN",
        format: "srt",
        cueCount: 0,
        missingCueCount: 0,
      },
      qc,
    });
    expect(result.success).toBe(false);
  });
});
