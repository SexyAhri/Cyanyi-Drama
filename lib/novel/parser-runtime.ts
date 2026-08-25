import { decryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import {
  saveStoryboard,
  upsertNovelCharacters,
  upsertNovelLocations,
} from "./domain-store";
import { upsertProductionProps } from "@/lib/production/domain-store";

export type NovelParseInput = {
  projectId: string;
  episodeId: string;
  channelId: string;
  model: string;
  sourceText?: string;
};

export type NovelParseOutput = {
  characters: Array<{
    name: string;
    aliases?: string[];
    profile?: Record<string, unknown>;
    introduction?: string | null;
  }>;
  locations: Array<{ name: string; summary?: string | null }>;
  props: Array<{ name: string; summary?: string | null }>;
  panels: Array<{
    panelIndex: number;
    shotType?: string | null;
    cameraMove?: string | null;
    description?: string | null;
    locationName?: string | null;
    characters?: string[];
    props?: string[];
    imagePrompt?: string | null;
    videoPrompt?: string | null;
  }>;
};

export async function parseNovelAndPersist(
  userId: string,
  input: NovelParseInput,
) {
  const episode = await prisma.episode.findFirst({
    where: {
      id: input.episodeId,
      projectId: input.projectId,
      project: { userId },
    },
    select: { novelText: true },
  });
  if (!episode) throw new Error("NOVEL_EPISODE_NOT_FOUND");
  const sourceText = input.sourceText?.trim() || episode.novelText?.trim();
  if (!sourceText) throw new Error("NOVEL_SOURCE_TEXT_REQUIRED");

  const parsed = await requestNovelParse(userId, input, sourceText);
  const characters = await upsertNovelCharacters(
    userId,
    input.projectId,
    parsed.characters,
  );
  const locations = await upsertNovelLocations(
    userId,
    input.projectId,
    parsed.locations,
  );
  const props = await upsertProductionProps(userId, input.projectId, parsed.props);
  const storyboard = await saveStoryboard(
    userId,
    input.projectId,
    input.episodeId,
    {
      status: "draft",
      sourceHash: createSourceHash(sourceText),
      panels: parsed.panels,
    },
  );
  if (!characters || !locations || !props || !storyboard)
    throw new Error("NOVEL_PARSE_PERSIST_FAILED");
  return { characters, locations, props, storyboard, sourceLength: sourceText.length };
}

async function requestNovelParse(
  userId: string,
  input: NovelParseInput,
  sourceText: string,
) {
  const channel = await prisma.channel.findFirst({
    where: { id: input.channelId, userId },
  });
  if (!channel) throw new Error("NOVEL_CHANNEL_NOT_FOUND");
  const configuredModel = await prisma.providerModel.findFirst({
    where: { channelId: input.channelId, modelId: input.model, selected: true },
  });
  if (!configuredModel) throw new Error("NOVEL_MODEL_NOT_CONFIGURED");
  if (
    channel.protocol !== "openai-compatible" &&
    channel.protocol !== "volcengine-ark"
  ) {
    throw new Error(`NOVEL_PROTOCOL_NOT_SUPPORTED:${channel.protocol}`);
  }
  const keys = JSON.parse(decryptSecret(channel.encryptedApiKeys)) as unknown;
  const apiKeys = Array.isArray(keys)
    ? keys
        .filter(
          (key): key is string =>
            typeof key === "string" && Boolean(key.trim()),
        )
        .map((key) => key.trim())
    : [];
  if (!apiKeys.length) throw new Error("NOVEL_CHANNEL_API_KEY_MISSING");
  const system = [
    "你是 AI 漫剧前期制片分析器。只返回严格 JSON，不要 Markdown，不要解释。",
    "输出字段必须是 characters、locations、props、panels。",
    "characters: [{name, aliases: string[], profile: object, introduction: string}]。",
    "locations: [{name, summary: string}]。",
    "props: [{name, summary: string}]。",
    "panels: [{panelIndex: number, shotType, cameraMove, description, locationName, characters: string[], props: string[], imagePrompt, videoPrompt}]。",
    "角色名和场景名必须稳定、简短且可复用；panels 从 0 开始按叙事顺序排列。",
  ].join("\n");
  const user = `请分析下面的剧集文本，生成可用于后续角色、场景和分镜制作的结构化草稿：\n\n${sourceText}`;
  let lastError: unknown;
  for (const apiKey of apiKeys) {
    try {
      const response = await fetch(
        `${channel.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: input.model,
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
          signal: AbortSignal.timeout(120_000),
          cache: "no-store",
        },
      );
      const payload = await readJson(response);
      if (!response.ok)
        throw new Error(providerMessage(payload, response.status));
      return normalizeParseOutput(extractText(payload));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("NOVEL_PARSE_PROVIDER_FAILED");
}

function extractText(payload: unknown) {
  const choice =
    isRecord(payload) && Array.isArray(payload.choices)
      ? payload.choices[0]
      : undefined;
  const message = isRecord(choice) ? choice.message : undefined;
  const content = isRecord(message) ? message.content : undefined;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        isRecord(part) && typeof part.text === "string" ? part.text : "",
      )
      .join("");
  throw new Error("NOVEL_PARSE_TEXT_MISSING");
}

function normalizeParseOutput(text: string): NovelParseOutput {
  const jsonText = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(jsonText);
  } catch {
    throw new Error("NOVEL_PARSE_INVALID_JSON");
  }
  if (!isRecord(value)) throw new Error("NOVEL_PARSE_INVALID_OUTPUT");
  const characters = Array.isArray(value.characters)
    ? value.characters.filter(isCharacter)
    : [];
  const locations = Array.isArray(value.locations)
    ? value.locations.filter(isLocation)
    : [];
  const props = Array.isArray(value.props)
    ? value.props.filter(isLocation)
    : [];
  const panels = Array.isArray(value.panels)
    ? value.panels.filter(isPanel).map((panel, index) => ({
        ...panel,
        panelIndex: Number.isInteger(panel.panelIndex)
          ? panel.panelIndex
          : index,
      }))
    : [];
  if (!characters.length && !locations.length && !props.length && !panels.length)
    throw new Error("NOVEL_PARSE_EMPTY_OUTPUT");
  return { characters, locations, props, panels };
}

function isCharacter(
  value: unknown,
): value is NovelParseOutput["characters"][number] {
  return isRecord(value) && typeof value.name === "string";
}
function isLocation(
  value: unknown,
): value is NovelParseOutput["locations"][number] {
  return isRecord(value) && typeof value.name === "string";
}
function isPanel(value: unknown): value is NovelParseOutput["panels"][number] {
  return isRecord(value) && typeof value.description === "string";
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function providerMessage(payload: unknown, status: number) {
  if (isRecord(payload) && typeof payload.message === "string")
    return payload.message;
  if (
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.message === "string"
  )
    return payload.error.message;
  return `Novel parse provider failed (${status}).`;
}
async function readJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}
function createSourceHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
