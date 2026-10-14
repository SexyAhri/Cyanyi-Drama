import type { ChannelProtocol } from "@/lib/agent/provider-types";
import type { SoundPolicy } from "@/lib/production-configuration/contract";
import { getAutoDlWorkflow } from "@/lib/providers/media/autodl-comfyui-workflows";
import { resolveVideoModelLimits } from "./video-segment-plan";
import { autoDlResolution } from "@/lib/providers/media/autodl-comfyui";
import { ConfigurationError } from "@/lib/production-configuration/store";

export type VideoProductionCapabilities = ReturnType<
  typeof resolveVideoModelLimits
> & {
  nativeAudio: "supported" | "unsupported" | "unknown";
  audioControl: "native_parameter" | "prompt" | "unknown";
  referenceAudio: boolean;
  maxReferenceAudios: number;
  ratios: string[] | null;
  resolutions: string[] | null;
  exactSpeech: "prompt";
  consistentVoice: "prompt";
  modelSubtitles: "prompt";
  minDurationSeconds: number;
};
export function resolveVideoProductionCapabilities(input: {
  model: string;
  protocol: ChannelProtocol;
  capabilities?: unknown;
}): VideoProductionCapabilities {
  const declared =
    input.capabilities &&
    typeof input.capabilities === "object" &&
    !Array.isArray(input.capabilities)
      ? (input.capabilities as Record<string, unknown>)
      : {};
  const workflow =
    input.protocol === "autodl-comfyui"
      ? getAutoDlWorkflow(input.model)
      : undefined;
  const agnes =
    input.protocol === "openai-compatible" &&
    /^agnes-video-2\.5-flash$/i.test(input.model);
  const arkAudio =
    input.protocol === "volcengine-ark" &&
    /seedance.*(?:1[._-]5|2[._-]0)/i.test(input.model);
  const arkReference =
    input.protocol === "volcengine-ark" &&
    /seedance.*2[._-]0/i.test(input.model);
  const referenceLimit =
    workflow?.maxReferenceAudios ?? (agnes || arkReference ? 3 : 0);
  const nativeAudio =
    typeof declared.supportsNativeAudio === "boolean"
      ? declared.supportsNativeAudio
        ? "supported"
        : "unsupported"
      : workflow
        ? workflow.generatesNativeAudio
          ? "supported"
          : "unsupported"
        : agnes || arkAudio
          ? "supported"
          : "unknown";
  const stringList = (value: unknown) =>
    Array.isArray(value) && value.every((item) => typeof item === "string")
      ? (value as string[])
      : null;
  return {
    ...resolveVideoModelLimits(input),
    nativeAudio,
    audioControl:
      input.protocol === "volcengine-ark"
        ? "native_parameter"
        : workflow || agnes
          ? "prompt"
          : "unknown",
    referenceAudio:
      referenceLimit > 0 && declared.supportsReferenceAudio !== false,
    maxReferenceAudios:
      declared.supportsReferenceAudio === false
        ? 0
        : Math.min(
            referenceLimit,
            typeof declared.maxReferenceAudios === "number" &&
              declared.maxReferenceAudios >= 0
              ? Math.floor(declared.maxReferenceAudios)
              : referenceLimit,
          ),
    ratios:
      stringList(declared.ratios) ??
      (agnes
        ? ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]
        : workflow
          ? workflow.square
            ? ["16:9", "9:16", "1:1"]
            : ["16:9", "9:16"]
          : null),
    resolutions:
      stringList(declared.resolutions) ??
      workflow?.resolutions ??
      (agnes ? ["720p"] : null),
    exactSpeech: "prompt",
    consistentVoice: "prompt",
    modelSubtitles: "prompt",
    minDurationSeconds: agnes ? 4 : 1,
  };
}
export function normalizeVideoProductionParameters(input: {
  model: string;
  protocol: ChannelProtocol;
  capabilities: VideoProductionCapabilities;
  ratio: string;
  resolution: string;
  durationSeconds: number;
  mode?: string;
  referenceAudioCount?: number;
}) {
  const { capabilities } = input;
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0)
    throw new ConfigurationError("视频时长必须为有效正数", 400);
  if (capabilities.ratios && !capabilities.ratios.includes(input.ratio))
    throw new ConfigurationError(
      `当前模型不支持比例 ${input.ratio}，可选：${capabilities.ratios.join("、")}`,
      400,
    );
  const workflow =
    input.protocol === "autodl-comfyui"
      ? getAutoDlWorkflow(input.model)
      : undefined;
  const agnes =
    input.protocol === "openai-compatible" &&
    /^agnes-video-2\.5-flash$/i.test(input.model);
  if (agnes && input.mode === "first-last" && input.referenceAudioCount)
    throw new ConfigurationError(
      "当前 Agnes 首尾帧接口不接受参考音频，请改用参考图模式或移除声音预设",
      400,
    );
  const resolution = workflow
    ? autoDlResolution(workflow, input.ratio, input.resolution)
    : agnes
      ? "720P"
      : input.resolution;
  const capabilityResolution = workflow
    ? ((workflow.resolutions ?? []).find((value) =>
        resolution.toLowerCase().startsWith(value.toLowerCase()),
      ) ?? resolution)
    : resolution;
  if (
    capabilities.resolutions &&
    !capabilities.resolutions.some(
      (value) => value.toLowerCase() === capabilityResolution.toLowerCase(),
    )
  )
    throw new ConfigurationError(`当前模型不支持分辨率 ${resolution}`, 400);
  const durationSeconds = Math.max(
    capabilities.minDurationSeconds,
    Math.round(input.durationSeconds),
  );
  if (durationSeconds > capabilities.maxDurationSeconds)
    throw new ConfigurationError(
      `当前模型单次最多生成 ${capabilities.maxDurationSeconds} 秒`,
      400,
    );
  return {
    ratio: input.ratio,
    resolution,
    duration: `${durationSeconds}s`,
    durationSeconds,
  };
}
export function videoProductionIssues(
  capabilities: VideoProductionCapabilities,
  sound: SoundPolicy,
) {
  const issues: Array<{ blocking: boolean; code: string; message: string }> =
    [];
  if (sound.mode === "native" && capabilities.nativeAudio === "unsupported")
    issues.push({
      blocking: true,
      code: "native_audio_unsupported",
      message: "当前模型不支持原生声音，请选择其他模型、独立配音或静音制作方式",
    });
  else if (sound.mode === "native" && capabilities.nativeAudio === "unknown")
    issues.push({
      blocking: false,
      code: "native_audio_unknown",
      message:
        "当前渠道未声明可验证的原生声音能力；声音要求通过提示词表达，结果仍需检查音轨",
    });
  if (
    sound.mode === "native" &&
    capabilities.audioControl !== "native_parameter"
  )
    issues.push({
      blocking: false,
      code: "audio_prompt_control",
      message:
        "此渠道没有已接线的声音类型原生开关；对白、音色、口型、时间和字幕仅为提示词约束，不能保证精确生成",
    });
  return issues;
}
