import { z } from "zod";

import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import {
  StructuredOutputError,
  type StructuredValidationIssue,
} from "@/lib/llm/structured-output";
import { listVoiceLines } from "@/lib/production/domain-store";
import { PROMPT_IDS, renderPrompt, type PromptLocale } from "@/lib/prompts";
import { voicePerformanceDesignSchema } from "@/lib/prompts/schemas";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { decryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import { structuredRequestOptions } from "@/lib/settings/runtime-contract";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";

type VoicePerformanceDesign = z.infer<typeof voicePerformanceDesignSchema>;

export class VoiceDesignError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function designEpisodeVoicePerformance(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  channelId: string;
  model: string;
  locale?: PromptLocale;
}) {
  const episode = await prisma.episode.findFirst({
    where: {
      id: input.episodeId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
    select: { novelText: true },
  });
  if (!episode) throw new VoiceDesignError("项目或剧集不存在", 404);

  const [voiceLines, characters, panels, provider] = await Promise.all([
    prisma.voiceLine.findMany({
      where: { episodeId: input.episodeId },
      orderBy: { lineIndex: "asc" },
      select: {
        id: true,
        lineIndex: true,
        speaker: true,
        content: true,
        delivery: true,
        matchedPanelId: true,
      },
    }),
    prisma.novelCharacter.findMany({
      where: { projectId: input.projectId },
      orderBy: { name: "asc" },
      select: {
        name: true,
        aliases: true,
        introduction: true,
        profileJson: true,
      },
    }),
    prisma.storyboardPanel.findMany({
      where: {
        storyboard: {
          projectId: input.projectId,
          episodeId: input.episodeId,
        },
      },
      orderBy: { panelIndex: "asc" },
      select: {
        id: true,
        panelIndex: true,
        sceneNumber: true,
        description: true,
        speakingCharacter: true,
        lipSyncText: true,
        voiceoverText: true,
        actingNotesJson: true,
        motionBeatsJson: true,
        startStateJson: true,
        endStateJson: true,
        sourceEvidenceJson: true,
      },
    }),
    resolveVoiceDesignProvider(input),
  ]);
  if (!voiceLines.length)
    throw new VoiceDesignError("请先分析并确认台词，再进行 AI 配音设计");

  const panelIndices = new Map(panels.map((panel) => [panel.id, panel.panelIndex]));
  const prompt = renderPrompt({
    id: PROMPT_IDS.STORY_VOICE_PERFORMANCE_DESIGN,
    locale: input.locale,
    variables: {
      source_text: episode.novelText ?? "",
      characters_json: JSON.stringify(
        characters.map((character) => ({
          name: character.name,
          aliases: parseStoredJson(character.aliases, []),
          introduction: character.introduction,
          profile: parseStoredJson(character.profileJson, {}),
        })),
        null,
        2,
      ),
      panels_json: JSON.stringify(
        panels.map((panel) => ({
          panelIndex: panel.panelIndex,
          sceneNumber: panel.sceneNumber,
          description: panel.description,
          speakingCharacter: panel.speakingCharacter,
          lipSyncText: panel.lipSyncText,
          voiceoverText: panel.voiceoverText,
          actingNotes: parseStoredJson(panel.actingNotesJson, []),
          motionBeats: parseStoredJson(panel.motionBeatsJson, []),
          startState: parseStoredJson(panel.startStateJson, null),
          endState: parseStoredJson(panel.endStateJson, null),
          sourceEvidence: parseStoredJson(panel.sourceEvidenceJson, []),
        })),
        null,
        2,
      ),
      voice_lines_json: JSON.stringify(
        voiceLines.map((line) => ({
          lineId: line.id,
          lineIndex: line.lineIndex,
          speaker: line.speaker,
          content: line.content,
          delivery: line.delivery,
          matchedPanelIndex: line.matchedPanelId
            ? (panelIndices.get(line.matchedPanelId) ?? null)
            : null,
        })),
        null,
        2,
      ),
    },
  });

  let result: Awaited<
    ReturnType<typeof requestOpenAiStructured<VoicePerformanceDesign>>
  >;
  try {
    result = await requestOpenAiStructured({
      ...provider,
      prompt,
      schema: voicePerformanceDesignSchema,
      temperature: 0.35,
      validate: (design) =>
        validateVoicePerformanceDesign(design, {
          lineIds: voiceLines.map((line) => line.id),
          speakers: [...new Set(voiceLines.map((line) => line.speaker))],
        }),
    });
  } catch (error) {
    if (
      error instanceof StructuredOutputError &&
      error.code === "STRUCTURED_SEMANTIC_INVALID"
    )
      throw new VoiceDesignError(
        input.locale === "en"
          ? `The model did not provide exact speaker and line coverage after correction: ${error.details.join("; ")}`
          : `模型定向修正后仍未完整覆盖角色与台词：${error.details.join("；")}`,
        422,
      );
    throw error;
  }

  const profileBySpeaker = new Map(
    result.data.speakers.map((item) => [item.speaker, item.voiceProfilePrompt]),
  );
  const designByLineId = new Map(
    result.data.lines.map((item) => [item.lineId, item]),
  );
  await prisma.$transaction(async (tx) => {
    const current = await tx.voiceLine.findMany({
      where: { episodeId: input.episodeId },
      orderBy: { lineIndex: "asc" },
      select: {
        id: true,
        lineIndex: true,
        speaker: true,
        content: true,
        delivery: true,
        matchedPanelId: true,
      },
    });
    if (!sameVoiceLineContract(voiceLines, current))
      throw new VoiceDesignError(
        "AI 设计期间台词已被修改，请基于最新台词重新设计",
        409,
      );
    await Promise.all(
      current.map((line) => {
        const lineDesign = designByLineId.get(line.id)!;
        return tx.voiceLine.update({
          where: { id: line.id },
          data: {
            voiceProfilePrompt: profileBySpeaker.get(line.speaker)!,
            emotionPrompt: lineDesign.emotionPrompt,
            emotionStrength: lineDesign.emotionStrength,
          },
        });
      }),
    );
  });

  return {
    voiceLines: await listVoiceLines(
      input.userId,
      input.projectId,
      input.episodeId,
    ),
    promptTrace: result.trace,
  };
}

export function validateVoicePerformanceDesign(
  design: VoicePerformanceDesign,
  expected: { lineIds: string[]; speakers: string[] },
): StructuredValidationIssue[] {
  return [
    ...exactCoverageIssues(
      design.speakers.map((item) => item.speaker),
      expected.speakers,
      "speakers",
    ),
    ...exactCoverageIssues(
      design.lines.map((item) => item.lineId),
      expected.lineIds,
      "lines",
    ),
  ];
}

function exactCoverageIssues(
  actual: string[],
  expected: string[],
  path: string,
): StructuredValidationIssue[] {
  const actualCounts = new Map<string, number>();
  for (const value of actual)
    actualCounts.set(value, (actualCounts.get(value) ?? 0) + 1);
  const expectedSet = new Set(expected);
  const missing = expected.filter((value) => !actualCounts.has(value));
  const unexpected = actual.filter((value) => !expectedSet.has(value));
  const duplicated = [...actualCounts]
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
  return [
    ...(missing.length
      ? [{ code: "VOICE_DESIGN_COVERAGE_MISSING", path, message: `Missing: ${missing.join(", ")}` }]
      : []),
    ...(unexpected.length
      ? [{ code: "VOICE_DESIGN_COVERAGE_UNEXPECTED", path, message: `Unexpected: ${unexpected.join(", ")}` }]
      : []),
    ...(duplicated.length
      ? [{ code: "VOICE_DESIGN_COVERAGE_DUPLICATE", path, message: `Duplicated: ${duplicated.join(", ")}` }]
      : []),
  ];
}

function sameVoiceLineContract(
  left: Array<{
    id: string;
    lineIndex: number;
    speaker: string;
    content: string;
    delivery: string;
    matchedPanelId: string | null;
  }>,
  right: Array<{
    id: string;
    lineIndex: number;
    speaker: string;
    content: string;
    delivery: string;
    matchedPanelId: string | null;
  }>,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function resolveVoiceDesignProvider(input: {
  userId: string;
  channelId: string;
  model: string;
}) {
  const channel = await prisma.channel.findFirst({
    where: accessibleChannelWhere(input.userId, input.channelId),
  });
  if (!channel) throw new VoiceDesignError("分析渠道不存在", 404);
  if (
    channel.protocol !== "openai-compatible" &&
    channel.protocol !== "volcengine-ark"
  )
    throw new VoiceDesignError("AI 配音设计需要 OpenAI 兼容或火山方舟渠道");
  const configuredModel = await prisma.providerModel.findFirst({
    where: { channelId: input.channelId, modelId: input.model, selected: true },
  });
  if (!configuredModel) throw new VoiceDesignError("分析模型未配置");
  const apiKeys = parseApiKeys(channel.encryptedApiKeys);
  if (!apiKeys.length) throw new VoiceDesignError("分析渠道缺少 API Key");
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

function parseApiKeys(value: string) {
  try {
    const parsed = JSON.parse(decryptSecret(value));
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string" && Boolean(key.trim()))
      : [];
  } catch {
    return [];
  }
}

function parseStoredJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
