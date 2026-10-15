import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import { listOwnedProjectMediaAssets } from "@/lib/assets/project-store";
import { currentProductionConfiguration, withProductionConfiguration } from "@/lib/production-configuration/context";
import { resolveProductionConfiguration } from "@/lib/production-configuration/store";
import { soundPolicyInstructions } from "@/lib/production-configuration/contract";

import {
  compileAssetVisualProfile,
  parseAssetVisualProfile,
} from "@/lib/assets/visual-profile";
import { requestOpenAiText, requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { spatialAuditContentSchema, type SpatialAudit } from "./visual-review-contract";
import { getProjectArtStyleDirective } from "@/lib/projects/art-style";
import { PROMPT_IDS, renderPrompt, type PromptLocale } from "@/lib/prompts";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { decryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import { structuredRequestOptions } from "@/lib/settings/runtime-contract";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import { withProductionRules } from "@/lib/prompts/production-rules";
import { lockVideoAudioPerformance } from "./director-prompt-locks";

export type StoryboardMediaPromptKind = "image" | "video";
export type StoryboardVideoMode = "reference" | "first-last";
export type StoryboardMediaPromptDesign = {
  prompt: string;
  designNotes: string[];
  continuitySafeguards: string[];
  spatialAudit?: SpatialAudit;
};

export class StoryboardPromptDesignError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type StoryboardPromptInput = {
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
  capturedContext?: StoryboardPromptContext;
};

// Called by the workflow store at submission, never accepted from public request bodies.
export async function captureStoryboardPromptContext(input: {
  userId: string; projectId: string; episodeId: string; panelId: string;
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
      videoAssetId: true,
      linkedToNextPanel: true,
    },
  });
  if (!panel) throw new StoryboardPromptDesignError("分镜格不存在", 404);

  const [project, adjacent] = await Promise.all([
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
  return { userId: input.userId, projectId: input.projectId, episodeId: input.episodeId, panel, adjacent, project, assetProfiles };
}

export type StoryboardPromptContext = Awaited<ReturnType<typeof captureStoryboardPromptContext>>;

export async function resolveStoryboardPromptContext(input: {
  userId: string; projectId: string; episodeId: string; panelId: string;
  capturedContext?: StoryboardPromptContext;
}) {
  const context = input.capturedContext;
  if (!context) return captureStoryboardPromptContext(input);
  if (context.userId !== input.userId || context.projectId !== input.projectId ||
    context.episodeId !== input.episodeId || context.panel.id !== input.panelId)
    throw new StoryboardPromptDesignError("镜头快照范围不匹配", 403);
  // Recheck access, but do not reread mutable production facts or selected media IDs.
  const allowed = await prisma.storyboardPanel.findFirst({
    where: { id: input.panelId, storyboard: { projectId: input.projectId, episodeId: input.episodeId, project: { userId: input.userId } } },
    select: { id: true },
  });
  if (!allowed) throw new StoryboardPromptDesignError("分镜格不存在", 404);
  return context;
}

export async function designStoryboardMediaPrompt(input: StoryboardPromptInput) {
  const { panel, adjacent, project, assetProfiles } = await resolveStoryboardPromptContext(input);
  const provider = await resolvePromptDesignProvider(input);
  const configuration = currentProductionConfiguration()?.snapshot ?? await resolveProductionConfiguration(input.userId, input);
  const referenceAssetIds = input.kind === "video" ? promptReferenceAssetIds(panel, adjacent, input.mode) : [];
  const references = await listOwnedProjectMediaAssets(input.userId, input.projectId, referenceAssetIds, ["image"]);
  const imageUrls = referenceAssetIds.map((id) => references.find((asset) => asset.id === id)!.url);
  const locale = input.locale === "en" ? "en" : "zh";
  const mode = input.kind === "video" ? input.mode ?? "reference" : "keyframe";
  const currentPrompt =
    input.currentPrompt?.trim() ||
    (input.kind === "image"
      ? panel.imagePrompt
      : mode === "first-last"
        ? panel.firstLastFramePrompt || panel.videoPrompt
        : panel.videoPrompt) ||
    panel.description ||
    "";
  const basePrompt = renderPrompt({
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
      reference_frames_json: JSON.stringify(referenceAssetIds.map((assetId, index) => ({ imageNumber: index + 1, assetId, role: index === 0 ? "first_frame" : "last_frame" }))),
    },
  });
  const prompt = input.kind === "video"
    ? withProductionRules(basePrompt, "video-prompt-generation")
    : basePrompt;
  if (input.kind === "video") {
    const soundContract = soundPolicyInstructions(configuration.sound, locale);
    prompt.platformContract = [prompt.platformContract, soundContract].filter(Boolean).join("\n\n");
    prompt.text += `\n\n${soundContract}`;
  }
  const result = await withProductionConfiguration(input.userId, configuration, () => imageUrls.length
    ? requestOpenAiStructured({ ...provider, prompt, imageUrls, requireVisionModel: true, temperature: 0.35,
      schema: z.object({ prompt: z.string().trim().min(1).max(12000),
        designNotes: z.array(z.string().trim().min(1).max(600)).max(16),
        continuitySafeguards: z.array(z.string().trim().min(1).max(600)).max(16),
        spatialAudit: spatialAuditContentSchema }).strict(),
    })
    : requestOpenAiText({ ...provider, prompt, temperature: 0.35 }));
  const design: StoryboardMediaPromptDesign = "data" in result
    ? { ...result.data, spatialAudit: { ...result.data.spatialAudit, referenceAssetIds } }
    : parseStoryboardMediaPromptDesignText(result.text);
  if (input.kind === "video") design.prompt = lockVideoAudioPerformance(design.prompt, { ...panel, locale, soundPolicy: configuration.sound });
  return {
    design,
    rawOutput: result.outputText,
    trace: result.trace,
  };
}

export function promptReferenceAssetIds(
  panel: { panelIndex: number; imageAssetId: string | null },
  adjacent: { panelIndex: number; imageAssetId: string | null }[],
  mode?: StoryboardVideoMode,
) {
  const first = panel.imageAssetId;
  if (mode !== "first-last") return first ? [first] : [];
  const last = adjacent.find((item) => item.panelIndex === panel.panelIndex + 1)?.imageAssetId;
  if (!first || !last) throw new StoryboardPromptDesignError("首尾帧设计需要当前镜头和下一镜头已采用的关键帧", 409);
  return [first, last];
}

export function parseStoryboardMediaPromptDesignText(
  value: string,
): StoryboardMediaPromptDesign {
  const raw = value.trim();
  const parsed = parseDesignJson(raw);
  if (parsed) {
    const prompt = textValue(parsed.prompt);
    return {
      prompt: prompt || raw,
      designNotes: stringList(parsed.designNotes),
      continuitySafeguards: stringList(parsed.continuitySafeguards),
    };
  }
  return {
    prompt: stripMarkdownFence(raw),
    designNotes: [],
    continuitySafeguards: [],
  };
}

export async function resolvePromptDesignProvider(input: {
  userId: string;
  projectId?: string;
  episodeId?: string;
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
    billing: { userId: input.userId, projectId: input.projectId, episodeId: input.episodeId },
    channelId: input.channelId,
    apiKeys,
    model: input.model,
    ...structuredRequestOptions(settings),
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

export function serializePanel(panel: Record<string, unknown>) {
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

function parseDesignJson(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(jsonrepair(value.slice(start, end + 1)));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringList(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  return values.flatMap((item) =>
    typeof item === "string"
      ? item
          .split(/\r?\n|；/u)
          .map((entry) =>
            entry.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/u, "").trim(),
          )
          .filter(Boolean)
      : [],
  );
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stripMarkdownFence(value: string) {
  return value
    .replace(/^\s*```(?:json|text)?\s*/iu, "")
    .replace(/\s*```\s*$/u, "")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
