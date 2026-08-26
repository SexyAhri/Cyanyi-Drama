import { randomUUID } from "node:crypto";

import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { decryptSecret, encryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import {
  getPrimaryModelCapability,
  inferModelCapabilities,
  type ChannelProtocol,
  type ModelCapabilities,
  type ModelCapability,
} from "@/lib/agent/provider-types";

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
  const channels = await prisma.channel.findMany({
    where: { userId: user.id },
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
        baseUrl: channel.baseUrl,
        apiKeys: JSON.parse(
          decryptSecret(channel.encryptedApiKeys),
        ) as string[],
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
  const { user, sessionId } = await ensureAnonymousUser();
  const body = (await request.json()) as ChannelInput;
  const name = body.name?.trim();
  const baseUrl = body.baseUrl?.trim();
  const protocol = body.protocol?.trim();
  const providerKey = body.providerKey?.trim() || providerKeyForProtocol(protocol);
  const apiKeys = [
    ...new Set((body.apiKeys ?? []).map((key) => key.trim()).filter(Boolean)),
  ];
  if (!name || !baseUrl || !protocol || apiKeys.length === 0)
    return Response.json(
      { message: "渠道名称、协议、Base URL 和 API Key 不能为空" },
      { status: 400 },
    );

  const id = body.id?.trim() || randomUUID();
  const selectedIds = new Set(body.modelIds ?? []);
  const models = body.models ?? [];
  const channel = await prisma.$transaction(async (tx) => {
    const existing = await tx.channel.findFirst({
      where: { id, userId: user.id },
    });
    const saved = existing
      ? await tx.channel.update({
          where: { id },
          data: {
            name,
            providerKey,
            protocol,
            baseUrl,
            encryptedApiKeys: encryptSecret(JSON.stringify(apiKeys)),
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
            encryptedApiKeys: encryptSecret(JSON.stringify(apiKeys)),
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
  return attachSessionCookie(
    Response.json({
      channel: {
        id: channel.id,
        name,
        providerKey,
        protocol,
        baseUrl,
        apiKeys,
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
  };
  const primary = getPrimaryModelCapability(capabilities);

  return {
    type: primary === "text" ? "llm" : primary,
    capabilities,
  };
}

function toModelCapability(value: string | undefined): ModelCapability | undefined {
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
    value === "volcengine-ark"
  ) {
    return value;
  }
  return "openai-compatible";
}

function providerKeyForProtocol(protocol?: string) {
  return protocol === "volcengine-ark" ? "volcengine-ark" : "custom";
}

export async function DELETE(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const id = new URL(request.url).searchParams.get("id");
  if (!id)
    return Response.json(
      { message: "Channel id is required." },
      { status: 400 },
    );
  await prisma.channel.deleteMany({ where: { id, userId: user.id } });
  return attachSessionCookie(Response.json({ ok: true }), sessionId);
}
