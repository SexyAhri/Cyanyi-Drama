import { randomUUID } from "node:crypto";

import {
  AdminRequiredError,
  attachSessionCookie,
  ensureAnonymousUser,
  requireAdmin,
} from "@/lib/server/auth";
import {
  accessibleChannelWhere,
  manageableChannelWhere,
} from "@/lib/server/channel-access";
import { decryptSecret, encryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import {
  getPrimaryModelCapability,
  inferModelCapabilities,
  type ChannelProtocol,
  type ModelCapabilities,
  type ModelCapability,
} from "@/lib/agent/provider-types";
import { parseOpenAiCompatibleMediaTemplate } from "@/lib/providers/openai-compatible-media-template";

type ChannelInput = {
  id?: string;
  name?: string;
  providerKey?: string;
  protocol?: string;
  baseUrl?: string;
  apiKeys?: string[];
  models?: Array<{
    id: string;
    name: string;
    modelId?: string;
    type?: string;
    capabilities?: unknown;
  }>;
  modelIds?: string[];
};

export async function GET() {
  const { user, sessionId } = await ensureAnonymousUser();
  const isAdmin = user.role === "ADMIN";
  const channels = await prisma.channel.findMany({
    where: isAdmin
      ? manageableChannelWhere(user.id)
      : accessibleChannelWhere(user.id),
    orderBy: { createdAt: "asc" },
    include: { models: { orderBy: { createdAt: "asc" } } },
  });
  return attachSessionCookie(
    Response.json({
      channels: channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        providerKey: channel.providerKey,
        protocol: channel.protocol,
        baseUrl: isAdmin ? channel.baseUrl : "",
        apiKeys: [],
        apiKeyCount: encryptedKeyCount(channel.encryptedApiKeys),
        models: channel.models.map((model) => ({
          ...normalizeStoredModel(model, channel.protocol),
          selected: model.selected,
          channelId: channel.id,
          channelName: channel.name,
          protocol: channel.protocol,
        })),
      })),
    }),
    sessionId,
  );
}

export async function PUT(request: Request) {
  let user;
  try {
    user = await requireAdmin();
  } catch (error) {
    return channelAdminError(error);
  }
  const sessionId = null;
  const body = (await request.json()) as ChannelInput;
  const name = body.name?.trim();
  const baseUrl = body.baseUrl?.trim();
  const protocol = body.protocol?.trim();
  const providerKey =
    body.providerKey?.trim() || providerKeyForProtocol(protocol);
  const apiKeys = [
    ...new Set((body.apiKeys ?? []).map((key) => key.trim()).filter(Boolean)),
  ];
  if (!name || !baseUrl || !protocol)
    return Response.json(
      { message: "渠道名称、协议、Base URL 和 API Key 不能为空" },
      { status: 400 },
    );

  const id = body.id?.trim() || randomUUID();
  const selectedIds = new Set(body.modelIds ?? []);
  const models = body.models ?? [];
  try {
    for (const model of models)
      normalizeModelMetadata(
        model.modelId?.trim() || model.id.trim(),
        protocol,
        model.type,
        model.capabilities,
      );
  } catch (error) {
    return attachSessionCookie(
      Response.json(
        {
          message:
            error instanceof Error
              ? `模型能力或媒体模板无效：${error.message}`
              : "模型能力或媒体模板无效",
        },
        { status: 400 },
      ),
      sessionId,
    );
  }
  let channel;
  try {
    channel = await prisma.$transaction(async (tx) => {
      const existing = await tx.channel.findFirst({
        where: manageableChannelWhere(user.id, id),
      });
      if (!existing && apiKeys.length === 0) {
        throw new Error("CHANNEL_API_KEYS_REQUIRED");
      }
      const encryptedApiKeys = apiKeys.length
        ? encryptSecret(JSON.stringify(apiKeys))
        : undefined;
      const saved = existing
        ? await tx.channel.update({
          where: { id },
          data: {
            name,
            providerKey,
            protocol,
            baseUrl,
            ...(encryptedApiKeys ? { encryptedApiKeys } : {}),
            scope: "SYSTEM",
            enabled: true,
          },
          })
        : await tx.channel.create({
          data: {
            id,
            userId: user.id,
            name,
            providerKey,
            protocol,
            baseUrl,
            encryptedApiKeys: encryptedApiKeys!,
            scope: "SYSTEM",
            enabled: true,
          },
          });
      if (body.models) {
        await tx.providerModel.deleteMany({
        where: {
          channelId: id,
          id: { notIn: models.map((model) => model.id) },
        },
        });
        for (const model of models) {
          const modelId = model.modelId?.trim() || model.id.trim();
          if (!modelId || !model.name.trim()) continue;
          const metadata = normalizeModelMetadata(
            modelId,
            protocol,
            model.type,
            model.capabilities,
          );
          await tx.providerModel.upsert({
          where: { channelId_modelId: { channelId: id, modelId } },
          create: {
            id: model.id || `${id}::${modelId}`,
            channelId: id,
            modelId,
            name: model.name.trim(),
            modelType: metadata.type,
            capabilitiesJson: JSON.stringify(metadata.capabilities),
            selected: selectedIds.has(model.id) || selectedIds.has(modelId),
          },
          update: {
            id: model.id || `${id}::${modelId}`,
            name: model.name.trim(),
            modelType: metadata.type,
            capabilitiesJson: JSON.stringify(metadata.capabilities),
            selected: selectedIds.has(model.id) || selectedIds.has(modelId),
          },
          });
        }
      }
      return saved;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CHANNEL_API_KEYS_REQUIRED") {
      return Response.json(
        { message: "新建渠道时至少需要一个 API Key" },
        { status: 400 },
      );
    }
    throw error;
  }
  return attachSessionCookie(
    Response.json({
      channel: {
        id: channel.id,
        name,
        providerKey,
        protocol,
        baseUrl,
        apiKeys: [],
        apiKeyCount: apiKeys.length || undefined,
        models,
      },
    }),
    sessionId,
  );
}

function normalizeStoredModel(
  model: {
    id: string;
    modelId: string;
    name: string;
    modelType: string;
    capabilitiesJson: string;
  },
  protocol: string,
) {
  const metadata = normalizeModelMetadata(
    model.modelId || model.id,
    protocol,
    model.modelType,
    parseCapabilities(model.capabilitiesJson),
  );

  return {
    id: model.id,
    modelId: model.modelId,
    name: model.name,
    type: metadata.type,
    capabilities: metadata.capabilities,
  };
}

function normalizeModelMetadata(
  modelId: string,
  protocolValue: string,
  declaredType: string | undefined,
  declaredCapabilities: unknown,
) {
  const protocol = normalizeProtocol(protocolValue);
  const inferred = inferModelCapabilities(modelId, protocol);
  const declared = isModelCapabilities(declaredCapabilities)
    ? declaredCapabilities
    : undefined;
  const declaredRecord = isRecord(declaredCapabilities)
    ? declaredCapabilities
    : undefined;
  const mediaTemplate =
    declaredRecord?.mediaTemplate === undefined
      ? undefined
      : parseOpenAiCompatibleMediaTemplate(declaredRecord.mediaTemplate);
  const declaredTypeCapability = toModelCapability(declaredType);
  const declaredModalities = declared?.modalities ?? [];
  const modalities = [
    ...new Set<ModelCapability>([
      ...inferred.modalities,
      ...declaredModalities,
      ...(declaredTypeCapability ? [declaredTypeCapability] : []),
    ]),
  ];
  const mediaModalities = modalities.filter((item) => item !== "text");
  const normalizedModalities: ModelCapability[] = mediaModalities.length
    ? [
        ...mediaModalities,
        ...(modalities.includes("text") ? (["text"] as const) : []),
      ]
    : ["text"];
  const capabilities: ModelCapabilities = {
    ...inferred,
    ...(declared ?? {}),
    modalities: normalizedModalities,
    supportsToolCalling: mediaModalities.length
      ? false
      : (declared?.supportsToolCalling ?? inferred.supportsToolCalling),
    supportsStructuredOutputs:
      declared?.supportsStructuredOutputs ?? inferred.supportsStructuredOutputs,
    ...(mediaTemplate ? { mediaTemplate } : {}),
  };
  const primary = getPrimaryModelCapability(capabilities);

  return {
    type: primary === "text" ? "llm" : primary,
    capabilities,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toModelCapability(
  value: string | undefined,
): ModelCapability | undefined {
  if (
    value === "text" ||
    value === "llm" ||
    value === "image" ||
    value === "video" ||
    value === "audio" ||
    value === "lipsync" ||
    value === "voicedesign"
  ) {
    return value === "llm" ? "text" : value;
  }
  return undefined;
}

function parseCapabilities(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isModelCapabilities(value: unknown): value is ModelCapabilities {
  if (!value || typeof value !== "object") return false;
  const modalities = (value as { modalities?: unknown }).modalities;
  return (
    Array.isArray(modalities) &&
    modalities.every((item) =>
      ["text", "image", "video", "audio", "lipsync", "voicedesign"].includes(
        item,
      ),
    )
  );
}

function normalizeProtocol(value: string): ChannelProtocol {
  if (
    value === "anthropic" ||
    value === "google-gemini" ||
    value === "volcengine-ark" ||
    value === "autodl-comfyui" ||
    value === "bailian-dashscope"
  ) {
    return value;
  }
  return "openai-compatible";
}

function providerKeyForProtocol(protocol?: string) {
  if (protocol === "volcengine-ark") return "volcengine-ark";
  if (protocol === "autodl-comfyui") return "autodl";
  if (protocol === "bailian-dashscope") return "alibaba-bailian";
  return "custom";
}

export async function DELETE(request: Request) {
  let user;
  try {
    user = await requireAdmin();
  } catch (error) {
    return channelAdminError(error);
  }
  const sessionId = null;
  const id = new URL(request.url).searchParams.get("id");
  if (!id)
    return Response.json(
      { message: "Channel id is required." },
      { status: 400 },
    );
  await prisma.channel.deleteMany({
    where: manageableChannelWhere(user.id, id),
  });
  return attachSessionCookie(Response.json({ ok: true }), sessionId);
}

function encryptedKeyCount(value: string) {
  try {
    const payload = JSON.parse(decryptSecret(value)) as unknown;
    return Array.isArray(payload)
      ? payload.filter((item) => typeof item === "string" && item.trim()).length
      : 0;
  } catch {
    return 0;
  }
}

function channelAdminError(error: unknown) {
  return Response.json(
    { message: "仅管理员可以管理模型渠道" },
    { status: error instanceof AdminRequiredError ? 403 : 500 },
  );
}
