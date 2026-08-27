import { describe, expect, it } from "vitest";

import type { MediaTask } from "@/lib/media/task-contract";
import type { VoiceLineRecord } from "../types";
import {
  buildSoundPostPackage,
  getCurrentSoundPostVersion,
  getSoundPostVersions,
  latestFailedVoiceTasks,
  latestVoiceTask,
  voiceLineAsset,
} from "./audio-view-model";

describe("audio view model", () => {
  it("uses only the latest task for each voice line", () => {
    const tasks = [task("old", "failed", "01"), task("new", "running", "02")];
    expect(latestVoiceTask("line-1", tasks)?.id).toBe("new");
    expect(latestFailedVoiceTasks(["line-1"], tasks)).toEqual([]);
  });

  it("retries only each selected line's latest failed task", () => {
    const tasks = [
      task("old-1", "failed", "01", "line-1"),
      task("new-1", "failed", "02", "line-1"),
      task("new-2", "succeeded", "03", "line-2"),
    ];
    expect(
      latestFailedVoiceTasks(["line-1", "line-2"], tasks).map(
        (item) => item.id,
      ),
    ).toEqual(["new-1"]);
  });

  it("prefers the voice line's persisted audio asset", () => {
    const line = voiceLine({ audioAssetId: "asset-current" });
    const asset = {
      id: "asset-current",
      kind: "audio",
      url: "/audio.mp3",
      mimeType: "audio/mpeg",
      metadata: {},
      references: [],
      sourceTargetId: line.id,
      sourceTargetType: "voice_line",
      taskStatus: "succeeded",
      createdAt: "02",
    };
    expect(
      voiceLineAsset(line, [task("new", "succeeded", "03")], [asset]),
    ).toBe(asset);
  });

  it("builds ADR rows and a machine-readable sync check", () => {
    const result = buildSoundPostPackage("episode-1", [voiceLine()]);
    expect(result.dialogue[0]).toMatchObject({
      lineId: "line-1",
      adrStatus: "not_required",
      syncOffsetMs: 0,
    });
    expect(result.qc.dialogue_sync).toMatchObject({
      status: "pass",
      measured: 0,
      target: 80,
      unit: "ms",
    });
  });

  it("parses versioned sound packages and ignores superseded current rows", () => {
    const payload = buildSoundPostPackage("episode-1", []);
    const versions = getSoundPostVersions(
      [
        deliverable({ id: "v1", version: 1, status: "superseded", payload }),
        deliverable({ id: "v2", version: 2, status: "draft", payload }),
      ],
      "episode-1",
    );
    expect(versions.map((item) => item.deliverable.id)).toEqual(["v2", "v1"]);
    expect(getCurrentSoundPostVersion(versions)?.deliverable.id).toBe("v2");
  });
});

function deliverable(overrides: Record<string, unknown>) {
  return {
    department: "sound",
    deliverableType: "sound_post_package",
    scopeType: "episode",
    scopeId: "episode-1",
    payload: {},
    ...overrides,
  } as never;
}

function task(
  id: string,
  status: MediaTask["status"],
  updatedAt: string,
  targetId = "line-1",
): MediaTask {
  return {
    id,
    traceId: `${id}-trace`,
    spanId: `${id}-span`,
    targetType: "voice_line",
    targetId,
    kind: "audio",
    status,
    provider: "test",
    protocol: "openai-compatible",
    model: "test",
    request: {},
    output:
      status === "succeeded"
        ? [{ id: `${id}-asset`, kind: "audio", url: "/audio.mp3" }]
        : undefined,
    retryCount: 0,
    maxRetries: 2,
    progress: status === "succeeded" ? 100 : 0,
    createdAt: updatedAt,
    updatedAt,
  };
}

function voiceLine(input: Partial<VoiceLineRecord> = {}): VoiceLineRecord {
  return {
    id: "line-1",
    episodeId: "episode-1",
    lineIndex: 0,
    speaker: "Narrator",
    content: "Line",
    voicePresetId: null,
    audioAssetId: null,
    emotionPrompt: null,
    emotionStrength: null,
    delivery: "dialogue",
    matchedPanelId: null,
    durationSeconds: null,
    status: "draft",
    createdAt: "01",
    updatedAt: "01",
    ...input,
  };
}
