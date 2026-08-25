import { randomUUID } from "node:crypto";

import {
  BillingError,
  reserveMediaTaskCharge,
  settleMediaTaskCharge,
} from "@/lib/billing/service";
import {
  createMediaTask,
  transitionMediaTask,
} from "@/lib/media/task-contract";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";
import { createBailianVoiceDesign } from "@/lib/providers/voice-design";
import { decryptSecret } from "@/lib/server/crypto";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";

export async function POST(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const channelId = stringValue(body.channelId);
  const voicePrompt = stringValue(body.voicePrompt);
  const previewText = stringValue(body.previewText);
  const preferredName = stringValue(body.preferredName) || "custom_voice";
  const language = body.language === "en" ? "en" : "zh";
  const channel = await prisma.channel.findFirst({
    where: {
      id: channelId,
      userId: user.id,
      providerKey: "bailian",
      protocol: "openai-compatible",
    },
    include: { models: true },
  });
  if (!channel)
    return attachSessionCookie(
      Response.json({ message: "需要 providerKey=bailian 的有效渠道" }, { status: 400 }),
      sessionId,
    );
  const model = stringValue(body.model) || "qwen-voice-design";
  const configured = channel.models.some(
    (item) =>
      item.selected &&
      item.modelId === model &&
      (item.modelType === "voicedesign" ||
        item.capabilitiesJson.includes('"voicedesign"')),
  );
  if (!configured)
    return attachSessionCookie(
      Response.json({ message: "音色设计模型未配置或未选中" }, { status: 400 }),
      sessionId,
    );
  const apiKeys = JSON.parse(decryptSecret(channel.encryptedApiKeys)) as string[];
  const apiKey = apiKeys.find((item) => item.trim())?.trim();
  if (!apiKey)
    return attachSessionCookie(
      Response.json({ message: "渠道缺少 API Key" }, { status: 400 }),
      sessionId,
    );

  const task = createMediaTask({
    id: `media_task_${randomUUID()}`,
    channelId,
    targetType: "global_voice_design",
    targetId: user.id,
    kind: "voicedesign",
    provider: channel.providerKey,
    protocol: channel.protocol as "openai-compatible",
    model,
    request: { voicePrompt, previewText, preferredName, language },
    maxRetries: 0,
  });
  const store = createDatabaseMediaTaskStore(user.id);
  await store.create(task);
  let running = task;
  try {
    await reserveMediaTaskCharge(user.id, task);
    running = transitionMediaTask(task, { type: "start" });
    await store.update(running);
    const result = await createBailianVoiceDesign(
      { voicePrompt, previewText, preferredName, language },
      apiKey,
      channel.baseUrl,
    );
    const previewUrl = result.audioBase64
      ? `data:audio/${result.responseFormat || "wav"};base64,${result.audioBase64}`
      : undefined;
    const succeeded = transitionMediaTask(running, {
      type: "succeed",
      output: previewUrl
        ? [
            {
              id: `voice-preview-${randomUUID()}`,
              kind: "audio",
              url: previewUrl,
              mimeType: `audio/${result.responseFormat || "wav"}`,
              metadata: { requestId: result.requestId },
            },
          ]
        : [],
    });
    await store.update(succeeded);
    const voice = await prisma.globalVoice.create({
      data: {
        userId: user.id,
        name: preferredName,
        description: stringValue(body.description) || null,
        voiceId: result.voiceId,
        voiceType: "designed",
        customVoiceUrl: previewUrl,
        voicePrompt,
        gender: stringValue(body.gender) || null,
        language,
      },
    });
    await settleMediaTaskCharge(user.id, task.id, true);
    return attachSessionCookie(
      Response.json({ voice, task: succeeded }, { status: 201 }),
      sessionId,
    );
  } catch (error) {
    const failed = transitionMediaTask(running, {
      type: "fail",
      error: {
        code: error instanceof BillingError ? error.message : "VOICE_DESIGN_FAILED",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    });
    await store.update(failed);
    await settleMediaTaskCharge(user.id, task.id, false).catch(() => null);
    const status = error instanceof BillingError ? error.status : 400;
    return attachSessionCookie(
      Response.json({ message: error instanceof Error ? error.message : String(error) }, { status }),
      sessionId,
    );
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
