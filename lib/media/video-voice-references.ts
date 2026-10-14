import { prisma } from "@/lib/server/prisma";
import type { SoundPolicy } from "@/lib/production-configuration/contract";
import type { MediaReferenceAudio } from "@/lib/providers/media/types";
import type { VideoProductionCapabilities } from "./video-production-capabilities";
import { ConfigurationError } from "@/lib/production-configuration/store";

export async function resolveVideoVoiceReferences(
  userId: string,
  sound: SoundPolicy,
  capabilities: VideoProductionCapabilities,
) {
  if (
    sound.mode !== "native" ||
    !(sound.dialogue || sound.voiceover || sound.innerMonologue)
  )
    return [];
  const ids = [
    ...new Set(
      (sound.voiceProfiles ?? []).flatMap((profile) =>
        profile.voicePresetId ? [profile.voicePresetId] : [],
      ),
    ),
  ];
  if (!ids.length) return [];
  const presets = await prisma.voicePreset.findMany({
    where: { id: { in: ids }, userId },
    select: {
      id: true,
      sampleAsset: {
        select: {
          storageKey: true,
          url: true,
          mimeType: true,
          task: { select: { userId: true } },
        },
      },
    },
  });
  if (presets.length !== ids.length)
    throw new ConfigurationError("声音预设不存在或无权使用", 400);
  if (!capabilities.referenceAudio)
    throw new ConfigurationError(
      "当前视频模型没有已接线的参考音频能力，请移除声音预设选择或更换模型；声音文字要求仍可使用",
      400,
    );
  if (presets.length > capabilities.maxReferenceAudios)
    throw new ConfigurationError(
      `当前模型最多支持 ${capabilities.maxReferenceAudios} 个参考音频，请减少角色声音预设`,
      400,
    );
  return presets.map((preset) => {
    const asset = preset.sampleAsset;
    if (
      !asset ||
      asset.task.userId !== userId ||
      (!asset.storageKey && !asset.url)
    )
      throw new ConfigurationError(
        "所选声音预设缺少可访问的参考音频，视频模型无法直接使用独立配音的声音 ID",
        400,
      );
    return {
      url: asset.storageKey ? `stored:${asset.storageKey}` : asset.url!,
      ...(asset.storageKey ? { storageKey: asset.storageKey } : {}),
      ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
    } satisfies MediaReferenceAudio;
  });
}
