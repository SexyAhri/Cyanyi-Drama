import { z } from "zod";

import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import {
  compileAssetVisualProfile,
  parseAssetVisualProfile,
} from "@/lib/assets/visual-profile";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { getProjectArtStyleDirective } from "@/lib/projects/art-style";
import { PROMPT_IDS, renderPrompt, type PromptLocale } from "@/lib/prompts";
import { storyboardMediaPromptDesignSchema } from "@/lib/prompts/schemas";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { decryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import { structuredRequestOptions } from "@/lib/settings/runtime-contract";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";

export type StoryboardMediaPromptKind = "image" | "video";
export type StoryboardVideoMode = "reference" | "first-last";
export type StoryboardMediaPromptDesign = z.infer<
  typeof storyboardMediaPromptDesignSchema
>;

export class StoryboardPromptDesignError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function designStoryboardMediaPrompt(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  panelId: string;
  channelId: string;
  model: string;
  kind: StoryboardMediaPromptKind;
  mode?: StoryboardVideoMode;
  currentPrompt?: string;
  locale?: PromptLocale;
}) {
  const panel = await prisma.storyboardPanel.findFirst({
    where: {
      id: input.panelId,
      storyboard: {
        projectId: input.projectId,
        episodeId: input.episodeId,
        project: { userId: input.userId },
      },
    },
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
      sceneNumber: true,
      shotType: true,
      cameraMove: true,
      description: true,
      locationName: true,
      charactersJson: true,
      propsJson: true,
      imagePrompt: true,
      videoPrompt: true,
      firstLastFramePrompt: true,
      durationSeconds: true,
      subtitleText: true,
      speakingCharacter: true,
      lipSyncText: true,
      voiceoverText: true,
      startStateJson: true,
      endStateJson: true,
      motionBeatsJson: true,
      worldContextJson: true,
      vfxCuesJson: true,
      sfxCuesJson: true,
      actingNotesJson: true,
      photographyRules: true,
      sourceEvidenceJson: true,
      imageAssetId: true,
      linkedToNextPanel: true,
    },
  });
  if (!panel) throw new StoryboardPromptDesignError("分镜格不存在", 404);

  const [project, adjacent, provider] = await Promise.all([
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: { config: { select: { artStyle: true } } },
    }),
    prisma.storyboardPanel.findMany({
      where: {
        storyboardId: panel.storyboardId,
        panelIndex: { in: [panel.panelIndex - 1, panel.panelIndex + 1] },
      },
      orderBy: { panelIndex: "asc" },
      select: {
        id: true,
        panelIndex: true,
        shotType: true,
        cameraMove: true,
        description: true,
        locationName: true,
        charactersJson: true,
        propsJson: true,
        startStateJson: true,
        endStateJson: true,
        imageAssetId: true,
      },
    }),
    resolvePromptDesignProvider(input),
  ]);
  if (!project) throw new StoryboardPromptDesignError("项目不存在", 404);

  const characters = parseStringList(panel.charactersJson);
  const props = parseStringList(panel.propsJson);
  const assetProfiles = await loadAssetProfiles({
    projectId: input.projectId,
    characters,
    props,
    locationName: panel.locationName,
  });
  const locale = input.locale === "en" ? "en" : "zh";
  const mode = input.kind === "video" ? input.mode ?? "reference" : "keyframe";
  const currentPrompt =
    input.currentPrompt?.trim() ||
    (input.kind === "image"
      ? panel.imagePrompt
      : mode === "first-last"
        ? panel.firstLastFramePrompt
        : panel.videoPrompt) ||
    panel.description ||
    "";
  const prompt = renderPrompt({
    id: PROMPT_IDS.STORYBOARD_MEDIA_PROMPT_DESIGN,
    locale,
    variables: {
      media_kind: input.kind === "image" ? (locale === "en" ? "image" : "图片") : locale === "en" ? "video" : "视频",
      generation_mode: localizedMode(mode, locale),
      project_style: getProjectArtStyleDirective(project.config?.artStyle, locale),
      current_shot_json: JSON.stringify(serializePanel(panel), null, 2),
      adjacent_shots_json: JSON.stringify(adjacent.map(serializePanel), null, 2),
      asset_profiles_json: JSON.stringify(assetProfiles, null, 2),
      current_prompt: currentPrompt || (locale === "en" ? "Not supplied" : "未提供"),
    },
  });
  const result = await requestOpenAiStructured({
    ...provider,
    prompt,
    schema: storyboardMediaPromptDesignSchema,
    temperature: 0.35,
  });
  return {
    design: result.data,
    trace: result.trace,
  };
}

async function resolvePromptDesignProvider(input: {
  userId: string;
  channelId: string;
  model: string;
}) {
  const channel = await prisma.channel.findFirst({
    where: accessibleChannelWhere(input.userId, input.channelId),
  });
  if (!channel) throw new StoryboardPromptDesignError("分析渠道不存在", 404);
  if (
    channel.protocol !== "openai-compatible" &&
    channel.protocol !== "volcengine-ark"
  )
    throw new StoryboardPromptDesignError("提示词设计需要 OpenAI 兼容渠道");
  const configuredModel = await prisma.providerModel.findFirst({
    where: { channelId: input.channelId, modelId: input.model, selected: true },
  });
  if (!configuredModel)
    throw new StoryboardPromptDesignError("分析模型未配置");
  const apiKeys = parseApiKeys(channel.encryptedApiKeys);
  if (!apiKeys.length)
    throw new StoryboardPromptDesignError("分析渠道缺少 API Key");
  const settings = await loadUserRuntimeSettings(input.userId);
  return {
    baseUrl: channel.baseUrl,
    apiKeys,
    model: input.model,
    ...structuredRequestOptions(settings),
    structuredOutputMode: supportsStoredStructuredOutputs(
      configuredModel.capabilitiesJson,
    )
      ? ("json_schema" as const)
      : ("json_object" as const),
  };
}

async function loadAssetProfiles(input: {
  projectId: string;
  characters: string[];
  props: string[];
  locationName: string | null;
}) {
  const [characters, location, props] = await Promise.all([
    input.characters.length
      ? prisma.novelCharacter.findMany({
          where: { projectId: input.projectId, name: { in: input.characters } },
          select: { name: true, visualProfileJson: true },
        })
      : [],
    input.locationName
      ? prisma.novelLocation.findFirst({
          where: { projectId: input.projectId, name: input.locationName },
          select: { name: true, visualProfileJson: true },
        })
      : null,
    input.props.length
      ? prisma.novelProp.findMany({
          where: { projectId: input.projectId, name: { in: input.props } },
          select: { name: true, visualProfileJson: true },
        })
      : [],
  ]);
  return {
    characters: characters.map(profileRecord),
    location: location ? profileRecord(location) : null,
    props: props.map(profileRecord),
  };
}

function profileRecord(input: { name: string; visualProfileJson: string | null }) {
  const profile = parseAssetVisualProfile(parseJson(input.visualProfileJson));
  return {
    name: input.name,
    confirmedVisualProfile: compileAssetVisualProfile(profile) || null,
  };
}

function serializePanel(panel: Record<string, unknown>) {
  return {
    id: panel.id,
    panelIndex: panel.panelIndex,
    sceneNumber: panel.sceneNumber,
    shotType: panel.shotType,
    cameraMove: panel.cameraMove,
    description: panel.description,
    locationName: panel.locationName,
    characters: parseStringList(valueString(panel.charactersJson)),
    props: parseStringList(valueString(panel.propsJson)),
    durationSeconds: panel.durationSeconds,
    subtitleText: panel.subtitleText,
    speakingCharacter: panel.speakingCharacter,
    lipSyncText: panel.lipSyncText,
    voiceoverText: panel.voiceoverText,
    startState: parseJson(valueString(panel.startStateJson)),
    endState: parseJson(valueString(panel.endStateJson)),
    motionBeats: parseJson(valueString(panel.motionBeatsJson)),
    worldContext: parseJson(valueString(panel.worldContextJson)),
    vfxCues: parseJson(valueString(panel.vfxCuesJson)),
    sfxCues: parseJson(valueString(panel.sfxCuesJson)),
    actingNotes: parseJson(valueString(panel.actingNotesJson)),
    photographyRules: panel.photographyRules,
    sourceEvidence: parseJson(valueString(panel.sourceEvidenceJson)),
    hasSelectedKeyframe: Boolean(panel.imageAssetId),
    linkedToNextPanel: panel.linkedToNextPanel,
  };
}

function localizedMode(mode: string, locale: PromptLocale) {
  if (locale === "en") {
    if (mode === "first-last") return "first and last frame";
    if (mode === "reference") return "reference image";
    return "shot keyframe";
  }
  if (mode === "first-last") return "首尾帧";
  if (mode === "reference") return "参考图";
  return "镜头关键帧";
}

function valueString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function parseStringList(value: string | null) {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed.flatMap((item) =>
        typeof item === "string" && item.trim() ? [item.trim()] : [],
      )
    : [];
}

function parseJson(value: string | null) {
  try {
    return value ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}

function parseApiKeys(value: string) {
  try {
    const parsed: unknown = JSON.parse(decryptSecret(value));
    return Array.isArray(parsed)
      ? parsed.flatMap((item) =>
          typeof item === "string" && item.trim() ? [item.trim()] : [],
        )
      : [];
  } catch {
    return [];
  }
}
