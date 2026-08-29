import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithProviderRetry = vi.hoisted(() => vi.fn());

vi.mock("@/lib/providers/http", () => ({ fetchWithProviderRetry }));

import {
  assertTimelineDialogueAudioCoverage,
  assertTimelineRenderCoverage,
  assertVoiceLinePanelCoverage,
  mediaAssetMetadata,
  generateImage,
  isSourceMediaDownloadFailure,
  mediaAssetExtension,
} from "./media-runtime";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("image generation runtime", () => {
  it("distinguishes broken provider URLs from storage upload failures", () => {
    expect(
      isSourceMediaDownloadFailure(new Error("MEDIA_DOWNLOAD_FAILED:404")),
    ).toBe(true);
    expect(isSourceMediaDownloadFailure(new Error("fetch failed"))).toBe(true);
    expect(
      isSourceMediaDownloadFailure(new Error("S3_BUCKET must be configured.")),
    ).toBe(false);
  });

  it("uses the provider MIME type for generated media storage", () => {
    expect(
      mediaAssetExtension({
        kind: "audio",
        mimeType: "audio/wav",
        url: "https://provider.test/result",
      }),
    ).toBe("wav");
    expect(
      mediaAssetExtension({
        kind: "image",
        mimeType: "image/jpeg; charset=binary",
        url: "https://provider.test/result",
      }),
    ).toBe("jpg");
  });

  it("does not duplicate inline media bytes into asset metadata", () => {
    expect(
      mediaAssetMetadata({
        url: "data:audio/mpeg;base64,AQID",
        metadata: { operation: "merge_episode_audio" },
      }),
    ).toEqual({ operation: "merge_episode_audio" });
    expect(
      mediaAssetMetadata({
        url: "https://provider.test/result.mp4",
        metadata: { model: "video-1" },
      }),
    ).toEqual({
      model: "video-1",
      originalUrl: "https://provider.test/result.mp4",
    });
  });

  it("does not hide unrelated provider failures", async () => {
    fetchWithProviderRetry.mockResolvedValue(
      Response.json({ error: { message: "quota exhausted" } }, { status: 429 }),
    );

    await expect(
      generateImage(
        "https://provider.test/v1",
        "openai-compatible",
        "key-1",
        "gpt-image-2",
        {
          prompt: "shot",
          referenceImages: [{ url: "data:image/png;base64,AQID" }],
        },
      ),
    ).rejects.toThrow("quota exhausted");
    expect(fetchWithProviderRetry).toHaveBeenCalledTimes(1);
  });
});

describe("timeline render coverage", () => {
  it("fails instead of silently skipping a timeline panel without media", () => {
    expect(() =>
      assertTimelineRenderCoverage({
        sequenceIds: ["panel-1", "panel-2"],
        panelMedia: [
          { id: "panel-1", panelIndex: 0, url: "https://media.test/1.png" },
          { id: "panel-2", panelIndex: 1, url: null },
        ],
      }),
    ).toThrow("TIMELINE_RENDER_PANEL_MEDIA_MISSING:1");
  });

  it("fails when a saved timeline points to a missing storyboard panel", () => {
    expect(() =>
      assertTimelineRenderCoverage({
        sequenceIds: ["panel-1", "deleted-panel"],
        panelMedia: [
          { id: "panel-1", panelIndex: 0, url: "https://media.test/1.png" },
        ],
      }),
    ).toThrow("TIMELINE_RENDER_TRACK_PANEL_MISSING:deleted-panel");
  });

  it("fails when a voice line is not bound to a storyboard panel", () => {
    expect(() =>
      assertVoiceLinePanelCoverage({
        panelIds: ["panel-1"],
        lines: [
          { id: "line-1", lineIndex: 0, matchedPanelId: "panel-1" },
          { id: "line-2", lineIndex: 1, matchedPanelId: null },
        ],
      }),
    ).toThrow("AUDIO_MERGE_LINE_PANEL_MISSING:1");
  });

  it("requires a merged dialogue track before rendering voiced panels", () => {
    expect(() => assertTimelineDialogueAudioCoverage(2, undefined)).toThrow(
      "TIMELINE_RENDER_DIALOGUE_AUDIO_MISSING",
    );
    expect(() =>
      assertTimelineDialogueAudioCoverage(2, "https://media.test/dialogue.mp3"),
    ).not.toThrow();
  });
});
