export type ChannelProtocol =
  | "openai-compatible"
  | "anthropic"
  | "google-gemini"
  | "volcengine-ark";

export type ModelCapability =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "lipsync"
  | "voicedesign";

export type ModelCapabilities = {
  modalities: ModelCapability[];
  supportsToolCalling: boolean;
  supportsStructuredOutputs: boolean;
  supportsReasoning: boolean;
  supportsAsync: boolean;
  supportsReferenceImages: boolean;
  supportsReferenceVideo: boolean;
  supportsReferenceAudio: boolean;
};

const MODEL_CAPABILITY_KEYWORDS: Record<ModelCapability, RegExp> = {
  text: /(?:^|[/_.:-])(gpt|claude|gemini|gemma|doubao|seed|qwen|deepseek|llama|mistral|ernie|chat|reason|prose|instruct)/i,
  image:
    /(?:image|img|seedream|flux|imagen|dall[-_. ]?e|stable[-_. ]?diffusion|recraft|ideogram|nano[-_. ]?banana)/i,
  video:
    /(?:video|seedance|veo|kling|runway|luma|hailuo|pixverse|wan[-_. ]?video|sora)/i,
  audio: /(?:audio|tts|speech|voice|eleven|fish[-_. ]?speech|cosyvoice|bark)/i,
  lipsync: /(?:lipsync|lip[-_. ]?sync|talking[-_. ]?head)/i,
  voicedesign: /(?:voice[-_. ]?design|voice[-_. ]?clone|custom[-_. ]?voice)/i,
};

export function inferModelCapabilities(
  modelId: string,
  protocol: ChannelProtocol = "openai-compatible",
): ModelCapabilities {
  const normalized = modelId.trim();
  const modalities: ModelCapability[] = (
    Object.keys(MODEL_CAPABILITY_KEYWORDS) as ModelCapability[]
  ).filter((capability) =>
    MODEL_CAPABILITY_KEYWORDS[capability].test(normalized),
  );

  if (protocol === "volcengine-ark") {
    if (/seedream/i.test(normalized)) {
      return {
        modalities: ["image"],
        supportsToolCalling: false,
        supportsStructuredOutputs: false,
        supportsReasoning: false,
        supportsAsync: false,
        supportsReferenceImages: true,
        supportsReferenceVideo: false,
        supportsReferenceAudio: false,
      };
    }
    if (/seedance/i.test(normalized)) {
      return {
        modalities: ["video"],
        supportsToolCalling: false,
        supportsStructuredOutputs: false,
        supportsReasoning: false,
        supportsAsync: true,
        supportsReferenceImages: true,
        supportsReferenceVideo: /2[-_. ]?0/i.test(normalized),
        supportsReferenceAudio: /2[-_. ]?0/i.test(normalized),
      };
    }
  }

  // Provider ids such as `gpt-image-2` or `seedream-*` can match a
  // generic text keyword (for example `gpt` or `seed`) as well as a media
  // keyword. Media models must remain in the media selector and must not be
  // routed through the normal conversation model list.
  const mediaModalities = modalities.filter((item) => item !== "text");
  const resolvedModalities: ModelCapability[] =
    mediaModalities.length > 0 ? mediaModalities : ["text"];
  const isMediaOnly = resolvedModalities.some((item) => item !== "text");

  return {
    modalities: resolvedModalities,
    supportsToolCalling: !isMediaOnly,
    supportsStructuredOutputs: false,
    supportsReasoning:
      !isMediaOnly && /reason|thinking|o[1-9]|r[1-9]/i.test(normalized),
    supportsAsync:
      resolvedModalities.includes("video") ||
      resolvedModalities.includes("audio"),
    supportsReferenceImages:
      resolvedModalities.includes("image") ||
      resolvedModalities.includes("video"),
    supportsReferenceVideo: resolvedModalities.includes("video"),
    supportsReferenceAudio:
      resolvedModalities.includes("video") ||
      resolvedModalities.includes("audio"),
  };
}

export function getPrimaryModelCapability(
  capabilities: ModelCapabilities,
): ModelCapability {
  const mediaCapability = capabilities.modalities.find(
    (capability) => capability !== "text",
  );
  return mediaCapability ?? capabilities.modalities[0] ?? "text";
}

export function supportsStoredStructuredOutputs(capabilitiesJson: string) {
  try {
    const value = JSON.parse(capabilitiesJson) as unknown;
    return (
      !!value &&
      typeof value === "object" &&
      (value as { supportsStructuredOutputs?: unknown })
        .supportsStructuredOutputs === true
    );
  } catch {
    return false;
  }
}
