import { createHash } from "node:crypto";

import { z } from "zod";

import { fetchWithProviderRetry } from "@/lib/providers/http";
import type { RenderedPrompt } from "@/lib/prompts";
import {
  generateStructuredOutput,
  type StructuredMessage,
  type StructuredValidationIssue,
} from "./structured-output";

export type StructuredOutputMode = "json_object" | "json_schema";

export type PromptTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type PromptExecutionTrace = {
  promptId: string;
  agentId: string;
  promptVersion: number;
  promptVersionHash: string;
  systemHash: string;
  model: string;
  structuredOutputMode: StructuredOutputMode;
  repaired: boolean;
  correctionAttempts: number;
  tokenUsage: PromptTokenUsage | null;
  outputHash: string;
};

export async function requestOpenAiStructured<T>(input: {
  baseUrl: string;
  apiKeys: string[];
  model: string;
  prompt: RenderedPrompt;
  schema: z.ZodType<T>;
  validate?: (data: T) => StructuredValidationIssue[];
  structuredOutputMode?: StructuredOutputMode;
  imageUrls?: string[];
  temperature?: number;
  timeoutMs?: number;
}) {
  let tokenUsage: PromptTokenUsage | null = null;
  let apiKeyIndex = 0;
  const responseFormat = buildStructuredResponseFormat({
    mode: input.structuredOutputMode ?? "json_object",
    schema: input.schema,
    name: input.prompt.id,
  });
  const structuredOutputMode = responseFormat.type;
  const result = await generateStructuredOutput({
    schema: input.schema,
    prompt: input.prompt.text,
    systemPrompt: input.prompt.systemText,
    validate: input.validate,
    maxCorrectionAttempts: input.prompt.maxSemanticCorrections,
    request: async (messages) => {
      let lastError: unknown;
      for (let offset = 0; offset < input.apiKeys.length; offset += 1) {
        const candidateIndex = (apiKeyIndex + offset) % input.apiKeys.length;
        try {
          const response = await requestText({
            baseUrl: input.baseUrl,
            apiKey: input.apiKeys[candidateIndex],
            model: input.model,
            messages,
            responseFormat,
            imageUrls: input.imageUrls,
            temperature: input.temperature,
            timeoutMs: input.timeoutMs,
          });
          apiKeyIndex = candidateIndex;
          tokenUsage = addTokenUsage(tokenUsage, response.tokenUsage);
          return response.text;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error("STRUCTURED_PROVIDER_REQUEST_FAILED");
    },
  });
  const trace: PromptExecutionTrace = {
    promptId: input.prompt.id,
    agentId: input.prompt.agentId,
    promptVersion: input.prompt.version,
    promptVersionHash: input.prompt.versionHash,
    systemHash: input.prompt.systemHash,
    model: input.model,
    structuredOutputMode,
    repaired: result.repaired,
    correctionAttempts: result.correctionAttempts,
    tokenUsage,
    outputHash: sha256(result.outputText),
  };
  return {
    ...result,
    promptId: input.prompt.id,
    promptVersion: input.prompt.version,
    promptVersionHash: input.prompt.versionHash,
    trace,
  };
}

async function requestText(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: StructuredMessage[];
  responseFormat: ReturnType<typeof buildStructuredResponseFormat>;
  imageUrls?: string[];
  temperature?: number;
  timeoutMs?: number;
}) {
  const timeoutMs = input.timeoutMs ?? 120_000;
  let response: Response;
  try {
    response = await fetchWithProviderRetry(
      `${input.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          temperature: input.temperature ?? 0.2,
          response_format: input.responseFormat,
          stream: true,
          stream_options: { include_usage: true },
          messages: buildOpenAiMessages(input.messages, input.imageUrls),
        }),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      },
    );
  } catch (error) {
    if (isTimeoutError(error))
      throw new Error(`STRUCTURED_PROVIDER_TIMEOUT:${timeoutMs}`);
    throw error;
  }
  const responseText = await response.text();
  const payload = parseJsonText(responseText);
  if (!response.ok)
    throw new Error(
      `STRUCTURED_PROVIDER_FAILED:${response.status}:${providerMessage(payload)}`,
    );
  if (isEventStreamResponse(response, responseText))
    return parseOpenAiEventStream(responseText);
  return {
    text: extractText(payload),
    tokenUsage: normalizeTokenUsage(payload),
  };
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" ||
      /aborted due to timeout|timed out/i.test(error.message))
  );
}

export function isRetryableStructuredProviderError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    /^STRUCTURED_PROVIDER_TIMEOUT:/.test(error.message) ||
    /^STRUCTURED_PROVIDER_FAILED:(408|425|429|5\d\d):/.test(error.message) ||
    /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(error.message)
  );
}

function buildOpenAiMessages(
  messages: StructuredMessage[],
  imageUrls: string[] | undefined,
) {
  const images = (imageUrls ?? []).map((url) => url.trim()).filter(Boolean);
  if (!images.length) return messages;
  const firstUserIndex = messages.findIndex(
    (message) => message.role === "user",
  );
  return messages.map((message, index) =>
    index === firstUserIndex
      ? {
          ...message,
          content: [
            { type: "text", text: message.content },
            ...images.map((url) => ({
              type: "image_url",
              image_url: { url },
            })),
          ],
        }
      : message,
  );
}

export function buildStructuredResponseFormat(input: {
  mode: StructuredOutputMode;
  schema: z.ZodType;
  name: string;
}) {
  if (input.mode === "json_object") return { type: "json_object" } as const;
  const schema = normalizeStrictJsonSchema(z.toJSONSchema(input.schema));
  if (!schema) return { type: "json_object" } as const;
  return {
    type: "json_schema",
    json_schema: {
      name: input.name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64),
      strict: true,
      schema,
    },
  } as const;
}

function normalizeStrictJsonSchema(value: unknown): unknown | null {
  if (Array.isArray(value)) {
    const normalized = value.map(normalizeStrictJsonSchema);
    return normalized.some((item) => item === null) ? null : normalized;
  }
  if (!isRecord(value)) return value;
  if ("additionalProperties" in value && value.additionalProperties !== false)
    return null;

  const normalized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "$schema" || key === "default" || key === "required") continue;
    const child = normalizeStrictJsonSchema(item);
    if (child === null) return null;
    normalized[key] = child;
  }
  if (isRecord(value.properties)) {
    normalized.required = Object.keys(value.properties);
    normalized.additionalProperties = false;
  }
  return normalized;
}

function extractText(payload: unknown) {
  const choices = isRecord(payload) ? payload.choices : undefined;
  const choice = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(choice) ? choice.message : undefined;
  const content = isRecord(message) ? message.content : undefined;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        isRecord(part) && typeof part.text === "string" ? part.text : "",
      )
      .join("");
  throw new Error("STRUCTURED_PROVIDER_TEXT_MISSING");
}

function parseJsonText(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function isEventStreamResponse(response: Response, text: string) {
  return (
    response.headers.get("content-type")?.includes("text/event-stream") ||
    text.trimStart().startsWith("data:")
  );
}

function parseOpenAiEventStream(text: string) {
  let content = "";
  let tokenUsage: PromptTokenUsage | null = null;
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") continue;
    const payload = parseJsonText(data);
    if (isRecord(payload) && payload.error)
      throw new Error(
        `STRUCTURED_PROVIDER_STREAM_FAILED:${providerMessage(payload)}`,
      );
    content += extractStreamText(payload);
    tokenUsage = normalizeTokenUsage(payload) ?? tokenUsage;
  }
  if (!content) throw new Error("STRUCTURED_PROVIDER_TEXT_MISSING");
  return { text: content, tokenUsage };
}

function extractStreamText(payload: unknown) {
  const choices = isRecord(payload) ? payload.choices : undefined;
  const choice = Array.isArray(choices) ? choices[0] : undefined;
  const delta = isRecord(choice) ? choice.delta : undefined;
  const content = isRecord(delta) ? delta.content : undefined;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        isRecord(part) && typeof part.text === "string" ? part.text : "",
      )
      .join("");
  return "";
}

function providerMessage(payload: unknown) {
  if (isRecord(payload) && typeof payload.message === "string")
    return sanitizeProviderMessage(payload.message);
  if (
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.message === "string"
  )
    return sanitizeProviderMessage(payload.error.message);
  return "unknown";
}

function sanitizeProviderMessage(message: string) {
  const normalized = message.trim();
  if (!normalized) return "unknown";
  if (/<(?:!doctype|html|head|body)\b/i.test(normalized)) {
    if (/a timeout occurred/i.test(normalized))
      return "Provider gateway timeout";
    return "Provider returned an HTML error page";
  }
  return normalized.slice(0, 1_000);
}

function normalizeTokenUsage(payload: unknown): PromptTokenUsage | null {
  const usage =
    isRecord(payload) && isRecord(payload.usage) ? payload.usage : null;
  if (!usage) return null;
  const inputTokens = tokenCount(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = tokenCount(
    usage.completion_tokens ?? usage.output_tokens,
  );
  const reportedTotal = tokenCount(usage.total_tokens);
  if (inputTokens === null && outputTokens === null && reportedTotal === null)
    return null;
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    totalTokens: reportedTotal ?? (inputTokens ?? 0) + (outputTokens ?? 0),
  };
}

function addTokenUsage(
  current: PromptTokenUsage | null,
  next: PromptTokenUsage | null,
): PromptTokenUsage | null {
  if (!next) return current;
  if (!current) return next;
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    totalTokens: current.totalTokens + next.totalTokens,
  };
}

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
