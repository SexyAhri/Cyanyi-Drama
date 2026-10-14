import { describe, expect, it } from "vitest";
import { DEFAULT_SOUND_POLICY } from "@/lib/production-configuration/contract";
import { normalizeVideoProductionParameters, resolveVideoProductionCapabilities, videoProductionIssues } from "./video-production-capabilities";

describe("implemented video production capabilities", () => {
  it("previews Agnes normalization and rejects reference audio in keyframe mode", () => {
    const input = { model: "agnes-video-2.5-flash", protocol: "openai-compatible" as const, capabilities: resolveVideoProductionCapabilities({ model: "agnes-video-2.5-flash", protocol: "openai-compatible" }), ratio: "16:9", resolution: "1080p", durationSeconds: 3 };
    expect(normalizeVideoProductionParameters(input)).toMatchObject({ duration: "4s", resolution: "720P" });
    expect(() => normalizeVideoProductionParameters({ ...input, mode: "first-last", referenceAudioCount: 1 })).toThrow("不接受参考音频");
    expect(() => normalizeVideoProductionParameters({ ...input, ratio: "2:3" })).toThrow("不支持比例");
  });
  it("reports actual AutoDL duration, images, references and audio control", () => {
    const result = resolveVideoProductionCapabilities({ model: "minimax_h3_image_audio_to_video_v2", protocol: "autodl-comfyui" });
    expect(result).toMatchObject({ nativeAudio: "supported", audioControl: "prompt", referenceAudio: true, maxReferenceAudios: 3, maxReferenceImages: 9, maxDurationSeconds: 10, resolutions: ["480p", "768p", "1080p"] });
  });
  it("accepts AutoDL resolution after the adapter adds the aspect orientation", () => {
    const capabilities = resolveVideoProductionCapabilities({ model: "minimax_h3_lightx2v_v5_15s", protocol: "autodl-comfyui" });
    expect(normalizeVideoProductionParameters({ model: "minimax_h3_lightx2v_v5_15s", protocol: "autodl-comfyui", capabilities, ratio: "16:9", resolution: "768p", durationSeconds: 5 })).toMatchObject({ resolution: "768p横", duration: "5s" });
    expect(normalizeVideoProductionParameters({ model: "minimax_h3_lightx2v_v5_15s", protocol: "autodl-comfyui", capabilities, ratio: "9:16", resolution: "768p", durationSeconds: 5 })).toMatchObject({ resolution: "768p竖" });
    expect(normalizeVideoProductionParameters({ model: "minimax_h3_lightx2v_v5_15s", protocol: "autodl-comfyui", capabilities, ratio: "1:1", resolution: "768p", durationSeconds: 5 })).toMatchObject({ resolution: "768p(1:1)" });
  });
  it("does not advertise reference audio for generic unimplemented adapters", () => {
    expect(resolveVideoProductionCapabilities({ model: "unknown-video", protocol: "openai-compatible", capabilities: { supportsReferenceAudio: true, maxReferenceAudios: 8 } })).toMatchObject({ nativeAudio: "unknown", referenceAudio: false, maxReferenceAudios: 0 });
  });
  it("honors an explicit unsupported audio declaration and blocks native sound", () => {
    const capabilities = resolveVideoProductionCapabilities({ model: "video", protocol: "openai-compatible", capabilities: { supportsNativeAudio: false } });
    expect(videoProductionIssues(capabilities, DEFAULT_SOUND_POLICY).some(issue => issue.blocking)).toBe(true);
    expect(videoProductionIssues(capabilities, { ...DEFAULT_SOUND_POLICY, mode: "post" }).some(issue => issue.blocking)).toBe(false);
    expect(videoProductionIssues(capabilities, { ...DEFAULT_SOUND_POLICY, mode: "silent" }).some(issue => issue.blocking)).toBe(false);
  });
  it("explains unknown and prompt-only audio without pretending native type controls exist", () => {
    const result = videoProductionIssues(resolveVideoProductionCapabilities({ model: "video", protocol: "openai-compatible" }), DEFAULT_SOUND_POLICY);
    expect(result.map(issue => issue.code)).toEqual(["native_audio_unknown", "audio_prompt_control"]);
    expect(result.every(issue => !issue.blocking)).toBe(true);
  });
  it("bounds reference audio by both the adapter and configured restrictions", () => {
    expect(resolveVideoProductionCapabilities({ model: "agnes-video-2.5-flash", protocol: "openai-compatible", capabilities: { maxReferenceAudios: 1 } }).maxReferenceAudios).toBe(1);
    expect(resolveVideoProductionCapabilities({ model: "agnes-video-2.5-flash", protocol: "openai-compatible", capabilities: { supportsReferenceAudio: false } }).referenceAudio).toBe(false);
  });
  it("distinguishes native Ark parameters from reference support", () => {
    expect(resolveVideoProductionCapabilities({ model: "doubao-seedance-2-0-pro", protocol: "volcengine-ark" })).toMatchObject({ audioControl: "native_parameter", nativeAudio: "supported", referenceAudio: true });
    expect(resolveVideoProductionCapabilities({ model: "doubao-seedance-1-5-pro", protocol: "volcengine-ark" }).referenceAudio).toBe(false);
  });
});
