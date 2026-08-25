import { decryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import { fetchWithProviderRetry } from "@/lib/providers/http";

export type VoiceAnalyzeInput = {
  userId: string;
  projectId: string;
  episodeId: string;
  channelId: string;
  model: string;
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
              panelIndex: true,
              description: true,
              subtitleText: true,
            },
          },
        },
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
    select: { modelId: true },
  });
  if (!model) throw new VoiceAnalyzeError("分析模型未在该渠道中配置或未选中");
  const keys = parseKeys(channel.encryptedApiKeys);
  if (!keys.length) throw new VoiceAnalyzeError("渠道没有可用 API Key");

  const panelContext = episode.storyboard.panels.map((panel) => ({
    panelIndex: panel.panelIndex,
    description: panel.description ?? "",
    subtitleText: panel.subtitleText ?? "",
  }));
  const prompt = [
    "你是 AI 漫剧台词分析器。只返回严格 JSON，不要 Markdown，不要解释。",
    '返回格式：{"lines":[{"speaker":"角色名","content":"台词","emotionPrompt":"情绪","emotionStrength":0.5,"matchedPanelIndex":0}]}。',
    "只提取角色实际说出的对白，不要把旁白、动作描述写进 content。",
    "speaker 必须是角色名；matchedPanelIndex 必须对应提供的面板编号，无法匹配时可省略。",
    'emotionStrength 必须是 0 到 1 的数字；没有对白时返回 {"lines":[]}。',
    `剧集文本：\n${episode.novelText}`,
    `分镜面板：\n${JSON.stringify(panelContext)}`,
  ].join("\n\n");

  let lastError: unknown;
  for (const apiKey of keys) {
    try {
      const response = await fetchWithProviderRetry(
        `${channel.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: input.model,
            temperature: 0.1,
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: prompt }],
          }),
          signal: AbortSignal.timeout(120_000),
          cache: "no-store",
        },
      );
      const payload = await readJson(response);
      if (!response.ok)
        throw new Error(providerMessage(payload, response.status));
      const lines = normalizeLines(
        extractText(payload),
        episode.storyboard.panels,
      );
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
              emotionPrompt: line.emotionPrompt,
              emotionStrength: line.emotionStrength,
              matchedPanelId: line.matchedPanelId,
              status: "draft",
            })),
          });
        }
      });
      return prisma.voiceLine.findMany({
        where: { episodeId: input.episodeId },
        orderBy: { lineIndex: "asc" },
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw new VoiceAnalyzeError(
    lastError instanceof Error ? lastError.message : "台词分析失败",
    502,
  );
}

function parseKeys(value: string) {
  try {
    const parsed: unknown = JSON.parse(decryptSecret(value));
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is string => typeof item === "string" && Boolean(item.trim()),
          )
          .map((item) => item.trim())
      : [];
  } catch {
    return [];
  }
}

function normalizeLines(
  text: string,
  panels: Array<{ id: string; panelIndex: number }>,
) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("台词分析返回的 JSON 无效");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { lines?: unknown }).lines)
  ) {
    throw new Error("台词分析返回缺少 lines 数组");
  }
  const panelIds = new Map(panels.map((panel) => [panel.panelIndex, panel.id]));
  return (parsed as { lines: unknown[] }).lines
    .flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const item = value as Record<string, unknown>;
      const speaker =
        typeof item.speaker === "string" ? item.speaker.trim() : "";
      const content =
        typeof item.content === "string" ? item.content.trim() : "";
      if (!speaker || !content) return [];
      const rawStrength =
        typeof item.emotionStrength === "number" ? item.emotionStrength : 0.5;
      const panelIndex =
        typeof item.matchedPanelIndex === "number" &&
        Number.isInteger(item.matchedPanelIndex)
          ? item.matchedPanelIndex
          : undefined;
      return [
        {
          speaker,
          content,
          emotionPrompt:
            typeof item.emotionPrompt === "string"
              ? item.emotionPrompt.trim() || null
              : null,
          emotionStrength: Math.min(1, Math.max(0, rawStrength)),
          matchedPanelId:
            panelIndex === undefined
              ? null
              : (panelIds.get(panelIndex) ?? null),
        },
      ];
    })
    .slice(0, 500);
}

function extractText(payload: unknown) {
  const choice =
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { choices?: unknown }).choices)
      ? (payload as { choices: unknown[] }).choices[0]
      : undefined;
  const message =
    choice && typeof choice === "object"
      ? (choice as { message?: unknown }).message
      : undefined;
  const content =
    message && typeof message === "object"
      ? (message as { content?: unknown }).content
      : undefined;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
  throw new Error("台词分析响应为空");
}

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function providerMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    if (typeof value.message === "string") return value.message;
    if (
      value.error &&
      typeof value.error === "object" &&
      typeof (value.error as { message?: unknown }).message === "string"
    )
      return (value.error as { message: string }).message;
  }
  return `台词分析服务请求失败 (${status})`;
}
