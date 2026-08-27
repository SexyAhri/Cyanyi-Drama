import {
  getPrimaryModelCapability,
  inferModelCapabilities,
} from "@/lib/agent/provider-types";
import {
  AUTODL_COMFYUI_WORKFLOWS,
  autoDlModelCapabilities,
} from "@/lib/providers/media/autodl-comfyui-workflows";

type ModelsRequestBody = {
  apiKey?: string;
  baseUrl?: string;
  protocol?:
    | "openai-compatible"
    | "anthropic"
    | "google-gemini"
    | "volcengine-ark"
    | "autodl-comfyui";
};

type OpenAIModel = {
  id?: string;
  object?: string;
};

type OpenAIModelsResponse = {
  data?: OpenAIModel[];
};

export async function POST(request: Request) {
  const body = (await request.json()) as ModelsRequestBody;
  const baseUrl = body.baseUrl?.trim();
  const apiKey = body.apiKey?.trim();
  const protocol = body.protocol || "openai-compatible";

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
      | GoogleModelsResponse;
    const models = getModelIds(protocol, payload)
      .filter((id): id is string => Boolean(id))
      .sort((a, b) => a.localeCompare(b))
      .map((id) => {
        const capabilities = inferModelCapabilities(id, protocol);
        return {
          id,
          name: id,
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

function getModelIds(
  protocol: ModelsRequestBody["protocol"],
  payload:
    | OpenAIModelsResponse
    | AnthropicModelsResponse
    | GoogleModelsResponse,
) {
  if (protocol === "anthropic") {
    return ((payload as AnthropicModelsResponse).data ?? []).map(
      (model) => model.id,
    );
  }
  if (protocol === "google-gemini") {
    return ((payload as GoogleModelsResponse).models ?? [])
      .filter(
        (model) =>
          model.supportedGenerationMethods?.includes("generateContent") ?? true,
      )
      .map((model) => model.name?.replace(/^models\//, ""));
  }
  return ((payload as OpenAIModelsResponse).data ?? []).map(
    (model) => model.id,
  );
}

function createApiUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
