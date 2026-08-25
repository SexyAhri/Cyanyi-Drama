import { randomUUID } from "node:crypto";

import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { decryptSecret, encryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";

type ChannelInput = {
  id?: string;
  name?: string;
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
        protocol: channel.protocol,
        baseUrl: channel.baseUrl,
        apiKeys: JSON.parse(
          decryptSecret(channel.encryptedApiKeys),
        ) as string[],
        models: channel.models.map((model) => ({
          id: model.id,
          modelId: model.modelId,
          name: model.name,
          type: model.modelType,
          capabilities: JSON.parse(model.capabilitiesJson),
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
        await tx.providerModel.upsert({
          where: { channelId_modelId: { channelId: id, modelId } },
          create: {
            id: model.id || `${id}::${modelId}`,
            channelId: id,
            modelId,
            name: model.name.trim(),
            modelType: model.type || "llm",
            capabilitiesJson: JSON.stringify(model.capabilities ?? {}),
            selected: selectedIds.has(model.id) || selectedIds.has(modelId),
          },
          update: {
            id: model.id || `${id}::${modelId}`,
            name: model.name.trim(),
            modelType: model.type || "llm",
            capabilitiesJson: JSON.stringify(model.capabilities ?? {}),
            selected: selectedIds.has(model.id) || selectedIds.has(modelId),
          },
        });
      }
    }
    return saved;
  });
  return attachSessionCookie(
    Response.json({
      channel: { id: channel.id, name, protocol, baseUrl, apiKeys, models },
    }),
    sessionId,
  );
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
