import {
  getPrimaryModelCapability,
  inferModelCapabilities,
} from "@/lib/agent/provider-types";
import {
  AUTODL_COMFYUI_WORKFLOWS,
  autoDlModelCapabilities,
} from "@/lib/providers/media/autodl-comfyui-workflows";
import {
  BAILIAN_DASHSCOPE_MODELS,
  bailianDashScopeModelCapabilities,
} from "@/lib/providers/media/bailian-dashscope-models";
import { AdminRequiredError, requireAdmin } from "@/lib/server/auth";
import { manageableChannelWhere } from "@/lib/server/channel-access";
import { decryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import type { ChannelProtocol } from "@/lib/agent/provider-types";

type ModelsRequestBody = {
  apiKey?: string;
  baseUrl?: string;
  channelId?: string;
  protocol?: ChannelProtocol;
};

type OpenAIModel = {
  id?: string;
  object?: string;
};

type OpenAIModelsResponse = {
  data?: OpenAIModel[];
};

type ElevenLabsModel = {
  model_id?: string;
  name?: string;
};

type ElevenLabsModelsResponse =
  | ElevenLabsModel[]
  | { models?: ElevenLabsModel[] };

export async function POST(request: Request) {
  let user;
  try {
    user = await requireAdmin();
  } catch (error) {
    return Response.json(
      { message: "仅管理员可以读取上游模型列表" },
      { status: error instanceof AdminRequiredError ? 403 : 500 },
    );
  }
  const body = (await request.json()) as ModelsRequestBody;
  const storedChannel =
    body.channelId && !body.apiKey?.trim()
      ? await prisma.channel.findFirst({
          where: manageableChannelWhere(user.id, body.channelId.trim()),
          select: {
            baseUrl: true,
            encryptedApiKeys: true,
            protocol: true,
          },
        })
      : null;
  const baseUrl = body.baseUrl?.trim() || storedChannel?.baseUrl.trim();
  const apiKey = body.apiKey?.trim() || firstStoredApiKey(storedChannel?.encryptedApiKeys);
  const protocol = normalizeProtocol(body.protocol || storedChannel?.protocol);

  if (!protocol) {
    return Response.json({ message: "Unsupported channel protocol." }, { status: 400 });
  }

  if (!baseUrl || !apiKey) {
    return Response.json(
      { message: "Base URL and API Key are required." },
      { status: 400 },
    );
  }

  if (protocol === "autodl-comfyui") {
    return Response.json({
      models: AUTODL_COMFYUI_WORKFLOWS.map((workflow) => ({
        id: workflow.id,
        modelId: workflow.id,
        name: workflow.name,
        type: workflow.type,
        capabilities: autoDlModelCapabilities(workflow.id),
        protocol,
      })),
    });
  }

  if (protocol === "bailian-dashscope") {
    return Response.json({
      models: BAILIAN_DASHSCOPE_MODELS.map((model) => ({
        ...model,
        modelId: model.id,
        capabilities: bailianDashScopeModelCapabilities(model.id),
        protocol,
      })),
    });
  }

  try {
    const response = await fetch(
      createApiUrl(baseUrl, getModelsPath(protocol, baseUrl)),
      {
        headers: getModelRequestHeaders(protocol, apiKey),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return Response.json(
        { message: await response.text() },
        { status: response.status },
      );
    }

    const payload = (await response.json()) as
      | OpenAIModelsResponse
      | AnthropicModelsResponse
      | GoogleModelsResponse
      | ElevenLabsModelsResponse;
    const models = getModelEntries(protocol, payload)
      .filter((model): model is { id: string; name: string } => Boolean(model.id))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((model) => {
        const capabilities = inferModelCapabilities(model.id, protocol);
        return {
          id: model.id,
          modelId: model.id,
          name: model.name,
          type: getPrimaryModelCapability(capabilities),
          capabilities,
          protocol,
        };
      });

    return Response.json({ models });
  } catch (error) {
    return Response.json(
      {
        message:
          error instanceof Error ? error.message : "Failed to fetch models.",
      },
      { status: 500 },
    );
  }
}

type AnthropicModelsResponse = {
  data?: Array<{ id?: string; display_name?: string }>;
};

type GoogleModelsResponse = {
  models?: Array<{
    name?: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }>;
};

function getModelRequestHeaders(
  protocol: ModelsRequestBody["protocol"],
  apiKey: string,
): Record<string, string> {
  if (protocol === "anthropic") {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      Accept: "application/json",
    };
  }

  if (protocol === "google-gemini") {
    return {
      "x-goog-api-key": apiKey,
      Accept: "application/json",
    };
  }
  if (protocol === "elevenlabs") {
    return {
      "xi-api-key": apiKey,
      Accept: "application/json",
    };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

function getModelsPath(
  protocol: ModelsRequestBody["protocol"],
  baseUrl: string,
) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (protocol === "anthropic" && !/\/v1$/i.test(normalized)) {
    return "v1/models";
  }
  if (protocol === "google-gemini" && !/\/v1beta$/i.test(normalized)) {
    return "v1beta/models";
  }
  return "models";
}

function getModelEntries(
  protocol: ModelsRequestBody["protocol"],
  payload:
    | OpenAIModelsResponse
    | AnthropicModelsResponse
    | GoogleModelsResponse
    | ElevenLabsModelsResponse,
) {
  if (protocol === "anthropic") {
    return ((payload as AnthropicModelsResponse).data ?? []).map(
      (model) => ({
        id: model.id ?? "",
        name: model.display_name?.trim() || model.id || "",
      }),
    );
  }
  if (protocol === "google-gemini") {
    return ((payload as GoogleModelsResponse).models ?? [])
      .filter(
        (model) =>
          model.supportedGenerationMethods?.includes("generateContent") ?? true,
      )
      .map((model) => {
        const id = model.name?.replace(/^models\//, "") ?? "";
        return { id, name: model.displayName?.trim() || id };
      });
  }
  if (protocol === "elevenlabs") {
    const source = Array.isArray(payload)
      ? payload
      : ((payload as { models?: ElevenLabsModel[] }).models ?? []);
    const entries = source.map((model) => ({
      id: model.model_id?.trim() ?? "",
      name: model.name?.trim() || model.model_id?.trim() || "",
    }));
    if (!entries.some((model) => model.id === "eleven_text_to_sound_v2")) {
      entries.push({
        id: "eleven_text_to_sound_v2",
        name: "Eleven Text to Sound v2",
      });
    }
    return entries;
  }
  return ((payload as OpenAIModelsResponse).data ?? []).map(
    (model) => ({ id: model.id ?? "", name: model.id ?? "" }),
  );
}

function createApiUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function firstStoredApiKey(value?: string) {
  if (!value) return "";
  try {
    const parsed = JSON.parse(decryptSecret(value)) as unknown;
    if (!Array.isArray(parsed)) return "";
    return parsed.find(
      (item): item is string => typeof item === "string" && Boolean(item.trim()),
    )?.trim() ?? "";
  } catch {
    return "";
  }
}

function normalizeProtocol(value?: string): ChannelProtocol | undefined {
  if (
    value === "openai-compatible" ||
    value === "anthropic" ||
    value === "google-gemini" ||
    value === "volcengine-ark" ||
    value === "autodl-comfyui" ||
    value === "bailian-dashscope" ||
    value === "elevenlabs"
  ) {
    return value;
  }
  return undefined;
}
