import { decryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import {
  isRetryableStructuredProviderError,
  requestOpenAiStructured,
} from "@/lib/llm/openai-structured";
import { PROMPT_IDS, renderPrompt, type PromptLocale } from "@/lib/prompts";
import {
  screenplayConversionSchema,
  voiceAnalysisSchema,
} from "@/lib/prompts/schemas";
import { validateVoiceAnalysis } from "@/lib/prompts/validators";
import { normalizeScreenplayDialogue } from "@/lib/novel/screenplay-dialogue";

export type VoiceAnalyzeInput = {
  userId: string;
  projectId: string;
  episodeId: string;
  channelId: string;
  model: string;
  locale?: PromptLocale;
};

export class VoiceAnalyzeError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function analyzeEpisodeVoices(input: VoiceAnalyzeInput) {
  const episode = await prisma.episode.findFirst({
    where: {
      id: input.episodeId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
    select: {
      id: true,
      novelText: true,
      storyboard: {
        select: {
          panels: {
            orderBy: { panelIndex: "asc" },
            select: {
              id: true,
              clipId: true,
              panelIndex: true,
              description: true,
              subtitleText: true,
              sourceEvidenceJson: true,
            },
          },
        },
      },
      clips: {
        orderBy: { clipIndex: "asc" },
        select: { id: true, screenplay: true },
      },
    },
  });
  if (!episode) throw new VoiceAnalyzeError("项目或剧集不存在", 404);
  if (!episode.novelText?.trim())
    throw new VoiceAnalyzeError("剧集没有可分析的文本");
  if (!episode.storyboard?.panels.length)
    throw new VoiceAnalyzeError("请先生成分镜后再分析台词");

  const channel = await prisma.channel.findFirst({
    where: { id: input.channelId, userId: input.userId },
    select: { protocol: true, baseUrl: true, encryptedApiKeys: true },
  });
  if (
    !channel ||
    !["openai-compatible", "volcengine-ark"].includes(channel.protocol)
  ) {
    throw new VoiceAnalyzeError("台词分析需要有效的 OpenAI 兼容或火山方舟渠道");
  }
  const model = await prisma.providerModel.findFirst({
    where: { channelId: input.channelId, modelId: input.model, selected: true },
    select: { modelId: true, capabilitiesJson: true },
  });
  if (!model) throw new VoiceAnalyzeError("分析模型未在该渠道中配置或未选中");
  const keys = parseKeys(channel.encryptedApiKeys);
  if (!keys.length) throw new VoiceAnalyzeError("渠道没有可用 API Key");

  const characters = await prisma.novelCharacter.findMany({
    where: { projectId: input.projectId },
    orderBy: { name: "asc" },
    select: {
      name: true,
      aliases: true,
      profileJson: true,
      introduction: true,
    },
  });
  const panelContext = episode.storyboard.panels.map((panel) => ({
    clipId: panel.clipId,
    panelIndex: panel.panelIndex,
    description: panel.description ?? "",
    subtitleText: panel.subtitleText ?? "",
    sourceEvidence: stringArray(parseStoredJson(panel.sourceEvidenceJson, [])),
  }));
  const characterContext = characters.map((character) => ({
    name: character.name,
    aliases: parseStoredJson(character.aliases, []),
    profile: parseStoredJson(character.profileJson, {}),
    introduction: character.introduction,
  }));
  const screenplayLines = buildScreenplayVoiceAnalysis({
    clips: episode.clips ?? [],
    panels: panelContext,
  });
  let analyzedData: Awaited<ReturnType<typeof requestVoiceAnalysis>>["data"];
  let trace:
    | Awaited<ReturnType<typeof requestVoiceAnalysis>>["trace"]
    | undefined;
  let fallbackReason: string | undefined;
  if (screenplayLines) {
    analyzedData = screenplayLines;
    const issues = validateVoiceAnalysis(analyzedData, {
      sourceText: episode.novelText,
      characters: characters.map((character) => character.name),
      panelIndices: panelContext.map((panel) => panel.panelIndex),
    });
    if (issues.length)
      throw new VoiceAnalyzeError(
        `剧本台词校验失败：${issues.map((item) => item.code).join(",")}`,
      );
  } else try {
    const analyzed = await requestVoiceAnalysis({
      baseUrl: channel.baseUrl,
      apiKeys: keys,
      model: input.model,
      locale: input.locale ?? "zh",
      sourceText: episode.novelText,
      characters: characterContext,
      panels: panelContext,
      structuredOutputMode: supportsStoredStructuredOutputs(
        model.capabilitiesJson,
      )
        ? "json_schema"
        : "json_object",
    });
    analyzedData = analyzed.data;
    trace = analyzed.trace;
  } catch (error) {
    if (isRetryableStructuredProviderError(error)) {
      analyzedData = buildDeterministicVoiceAnalysis({
        sourceText: episode.novelText,
        characters: characterContext,
        panels: panelContext,
      });
      fallbackReason = structuredProviderFailureCode(error);
    } else {
      throw new VoiceAnalyzeError(
        error instanceof Error ? error.message : "台词分析失败",
        502,
      );
    }
  }
  const panelIds = new Map(
    episode.storyboard.panels.map((panel) => [panel.panelIndex, panel.id]),
  );
  const lines = analyzedData.lines.map((line) => ({
    speaker: line.speaker,
    content: line.content,
    delivery: line.delivery,
    emotionPrompt: line.emotionPrompt ?? null,
    emotionStrength: line.emotionStrength,
    matchedPanelId:
      line.matchedPanelIndex === null
        ? null
        : (panelIds.get(line.matchedPanelIndex) ?? null),
  }));

  await prisma.$transaction(async (tx) => {
    await tx.voiceLine.deleteMany({
      where: { episodeId: input.episodeId },
    });
    if (lines.length) {
      await tx.voiceLine.createMany({
        data: lines.map((line, index) => ({
          id: crypto.randomUUID(),
          episodeId: input.episodeId,
          lineIndex: index,
          speaker: line.speaker,
          content: line.content,
          delivery: line.delivery,
          emotionPrompt: line.emotionPrompt,
          emotionStrength: line.emotionStrength,
          matchedPanelId: line.matchedPanelId,
          status: "draft",
        })),
      });
    }
  });
  const voiceLines = await prisma.voiceLine.findMany({
    where: { episodeId: input.episodeId },
    orderBy: { lineIndex: "asc" },
  });
  return {
    voiceLines,
    promptTraces: trace ? [trace] : [],
    degraded: Boolean(fallbackReason),
    fallbackReason,
  };
}

export function buildDeterministicVoiceAnalysis(input: {
  sourceText: string;
  characters: Array<{ name: string; aliases: unknown }>;
  panels: Array<{
    panelIndex: number;
    description: string;
    subtitleText: string;
    sourceEvidence?: string[];
  }>;
}) {
  const speakers = input.characters.flatMap((character) => [
    { spokenName: character.name, canonicalName: character.name },
    ...stringArray(character.aliases).map((alias) => ({
      spokenName: alias,
      canonicalName: character.name,
    })),
  ]);
  const matches = [...input.sourceText.matchAll(/[“\"]([^”\"\r\n]+)[”\"]/g)].slice(
    0,
    500,
  );
  const lines = matches.map((match) => {
    const content = match[1];
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = input.sourceText.slice(Math.max(0, start - 240), start);
    const after = input.sourceText.slice(end, end + 160);
    const speaker = inferDialogueSpeaker(speakers, before, after);
    const matchedPanelIndex = input.panels.find((panel) =>
      `${panel.description}\n${panel.subtitleText}\n${panel.sourceEvidence?.join("\n") ?? ""}`.includes(content),
    )?.panelIndex;
    return {
      speaker: speaker ?? "旁白",
      content,
      delivery: "dialogue" as const,
      emotionPrompt: null,
      emotionStrength: 0.5,
      matchedPanelIndex: matchedPanelIndex ?? null,
    };
  });
  return voiceAnalysisSchema.parse({ lines });
}

export function buildScreenplayVoiceAnalysis(input: {
  clips: Array<{ id: string; screenplay: string | null }>;
  panels: Array<{
    clipId: string | null;
    panelIndex: number;
    description: string;
    subtitleText: string;
    sourceEvidence?: string[];
  }>;
}) {
  const lines = input.clips.flatMap((clip) => {
    const parsed = parseScreenplay(clip.screenplay);
    if (!parsed) return [];
    const clipPanels = input.panels.filter((panel) => panel.clipId === clip.id);
    return normalizeScreenplayDialogue(parsed).scenes.flatMap((scene) =>
      scene.content.flatMap((content) => {
        if (content.type === "action") return [];
        const spokenContent =
          content.type === "dialogue" ? content.lines : content.text;
        const speaker =
          content.type === "dialogue"
            ? content.character
            : content.character ?? "旁白";
        const matchedPanelIndex = findDialoguePanel(
          spokenContent,
          clipPanels.length ? clipPanels : input.panels,
        );
        return [
          {
            speaker,
            content: spokenContent,
            delivery:
              content.type === "dialogue"
                ? ("dialogue" as const)
                : content.character
                  ? ("inner_monologue" as const)
                  : ("voiceover" as const),
            emotionPrompt: content.type === "dialogue" ? content.parenthetical : null,
            emotionStrength: 0.5,
            matchedPanelIndex,
          },
        ];
      }),
    );
  });
  return lines.length ? voiceAnalysisSchema.parse({ lines }) : null;
}

function parseScreenplay(value: string | null) {
  if (!value) return null;
  try {
    const parsed = screenplayConversionSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function findDialoguePanel(
  content: string,
  panels: Array<{
    panelIndex: number;
    description: string;
    subtitleText: string;
    sourceEvidence?: string[];
  }>,
) {
  return (
    panels.find((panel) =>
      `${panel.description}\n${panel.subtitleText}\n${panel.sourceEvidence?.join("\n") ?? ""}`.includes(content),
    )?.panelIndex ?? panels[0]?.panelIndex ?? null
  );
}

function inferDialogueSpeaker(
  speakers: Array<{ spokenName: string; canonicalName: string }>,
  before: string,
  after: string,
) {
  const speechVerb =
    "说(?:道)?|问(?:道)?|答(?:道)?|回答|喊(?:道)?|叫(?:道)?|喝(?:道)?|叹(?:道)?|笑(?:道)?|开口|回应|低声(?:说)?|轻声(?:说)?";
  const attributed = speakers.flatMap((candidate) => {
    const name = escapeRegex(candidate.spokenName);
    const beforeMatch = before.match(
      new RegExp(`${name}[^。！？!?“”\"]{0,28}(?:${speechVerb})[：:，,\s]*$`),
    );
    const afterMatch = after.match(
      new RegExp(`^[。！？!?，,\s]*(?:${name}[^。！？!?]{0,28}(?:${speechVerb})|(?:${speechVerb})[^。！？!?]{0,12}${name})`),
    );
    return beforeMatch || afterMatch ? [candidate.canonicalName] : [];
  });
  if (attributed.length) return attributed[0];

  return speakers
    .map((candidate) => ({
      ...candidate,
      beforeIndex: before.lastIndexOf(candidate.spokenName),
      afterIndex: after.indexOf(candidate.spokenName),
    }))
    .map((candidate) => ({
      ...candidate,
      distance:
        candidate.beforeIndex >= 0
          ? before.length - candidate.beforeIndex
          : candidate.afterIndex >= 0
            ? candidate.afterIndex + 1
            : Number.POSITIVE_INFINITY,
    }))
    .filter((candidate) => Number.isFinite(candidate.distance))
    .sort((left, right) => left.distance - right.distance)[0]?.canonicalName;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requestVoiceAnalysis(input: {
  baseUrl: string;
  apiKeys: string[];
  model: string;
  locale: PromptLocale;
  sourceText: string;
  characters: unknown[];
  panels: unknown[];
  structuredOutputMode: "json_object" | "json_schema";
}) {
  return requestOpenAiStructured({
    baseUrl: input.baseUrl,
    apiKeys: input.apiKeys,
    model: input.model,
    temperature: 0.1,
    structuredOutputMode: input.structuredOutputMode,
    prompt: renderPrompt({
      id: PROMPT_IDS.STORY_VOICE_ANALYSIS,
      locale: input.locale,
      variables: {
        source_text: input.sourceText,
        characters_json: JSON.stringify(input.characters),
        panels_json: JSON.stringify(input.panels),
      },
    }),
    schema: voiceAnalysisSchema,
    validate: (data) =>
      validateVoiceAnalysis(data, {
        sourceText: input.sourceText,
        characters: input.characters.flatMap((value) =>
          value &&
          typeof value === "object" &&
          typeof (value as { name?: unknown }).name === "string"
            ? [(value as { name: string }).name]
            : [],
        ),
        panelIndices: input.panels.flatMap((value) =>
          value &&
          typeof value === "object" &&
          typeof (value as { panelIndex?: unknown }).panelIndex === "number"
            ? [(value as { panelIndex: number }).panelIndex]
            : [],
        ),
      }),
  });
}

function parseKeys(value: string) {
  try {
    const parsed: unknown = JSON.parse(decryptSecret(value));
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is string =>
              typeof item === "string" && Boolean(item.trim()),
          )
          .map((item) => item.trim())
      : [];
  } catch {
    return [];
  }
}

function parseStoredJson(value: string | null, fallback: unknown) {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function structuredProviderFailureCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const status = message.match(/^STRUCTURED_PROVIDER_FAILED:(\d{3}):/)?.[1];
  if (status) return `PROVIDER_HTTP_${status}`;
  if (message.startsWith("STRUCTURED_PROVIDER_TIMEOUT:"))
    return "PROVIDER_TIMEOUT";
  return "PROVIDER_TEMPORARY_FAILURE";
}
