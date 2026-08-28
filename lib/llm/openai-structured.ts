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
  normalizeRaw?: (value: unknown) => unknown;
  structuredOutputMode?: StructuredOutputMode;
  imageUrls?: string[];
  temperature?: number;
  timeoutMs?: number;
  stream?: boolean;
  maxTransportAttempts?: number;
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
    normalizeRaw: input.normalizeRaw,
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
            stream: input.stream,
            maxTransportAttempts: input.maxTransportAttempts,
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
  stream?: boolean;
  maxTransportAttempts?: number;
}) {
  let lastError: unknown;
  const startedAt = Date.now();
  const maxAttempts = normalizeTransportAttempts(input.maxTransportAttempts);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestTextAttempt(input);
    } catch (error) {
      lastError = error;
      if (!isRetryableTextTransportError(error)) throw error;
      if (attempt >= maxAttempts)
        throw buildTransportRetryExhaustedError({
          attempt,
          error,
          startedAt,
          timeoutMs: input.timeoutMs ?? 120_000,
        });
      await new Promise((resolve) =>
        setTimeout(resolve, 250 * 2 ** (attempt - 1)),
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("STRUCTURED_PROVIDER_REQUEST_FAILED");
}

function normalizeTransportAttempts(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(10, Math.floor(value)))
    : 3;
}

async function requestTextAttempt(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: StructuredMessage[];
  responseFormat: ReturnType<typeof buildStructuredResponseFormat>;
  imageUrls?: string[];
  temperature?: number;
  timeoutMs?: number;
  stream?: boolean;
  maxTransportAttempts?: number;
}) {
  const timeoutMs = input.timeoutMs ?? 120_000;
  let response: Response;
  let responseText: string;
  const startedAt = Date.now();
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
          stream: input.stream ?? true,
          ...((input.stream ?? true)
            ? { stream_options: { include_usage: true } }
            : {}),
          messages: buildOpenAiMessages(input.messages, input.imageUrls),
        }),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      },
    );
  } catch (error) {
    throw buildProviderRequestError({
      error,
      stage: "request",
      startedAt,
      timeoutMs,
    });
  }
  try {
    responseText = await readResponseText(response);
  } catch (error) {
    throw buildProviderRequestError({
      error,
      stage: "response_body",
      startedAt,
      timeoutMs,
    });
  }
  const payload = parseJsonText(responseText);
  if (!response.ok)
    throw new Error(
      `STRUCTURED_PROVIDER_FAILED:${response.status}:${providerMessage(payload)}`,
    );
  try {
    if (isEventStreamResponse(response, responseText))
      return parseOpenAiEventStream(responseText);
    return {
      text: extractText(payload),
      tokenUsage: normalizeTokenUsage(payload),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "STRUCTURED_PROVIDER_TEXT_MISSING"
    )
      throw new StructuredProviderTransportError(
        "response_payload",
        "empty structured response content",
        "STRUCTURED_PROVIDER_TEXT_MISSING",
        error,
      );
    throw error;
  }
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    (/^STRUCTURED_PROVIDER_TIMEOUT:/.test(error.message) ||
      error.name === "TimeoutError" ||
      /aborted due to timeout|timed out/i.test(error.message))
  );
}

export function isRetryableStructuredProviderError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    /^STRUCTURED_PROVIDER_TIMEOUT:/.test(error.message) ||
    /^STRUCTURED_PROVIDER_FAILED:(408|425|429|5\d\d):/.test(error.message) ||
    /^STRUCTURED_PROVIDER_TRANSPORT(?:_FAILED)?:/.test(error.message) ||
    error.message === "STRUCTURED_PROVIDER_TEXT_MISSING" ||
    isTimeoutError(error) ||
    /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|terminated|UND_ERR_SOCKET/i.test(
      error.message,
    )
  );
}

function isRetryableTextTransportError(error: unknown) {
  return (
    error instanceof Error &&
    !isTimeoutError(error) &&
    /STRUCTURED_PROVIDER_TRANSPORT|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|terminated|UND_ERR_SOCKET/i.test(
      `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`,
    )
  );
}

type ProviderRequestStage = "request" | "response_body" | "response_payload";

class StructuredProviderTransportError extends Error {
  constructor(
    readonly stage: ProviderRequestStage,
    readonly reason: string,
    readonly causeCode: string,
    cause: unknown,
  ) {
    super(
      `STRUCTURED_PROVIDER_TRANSPORT:stage=${stage};reason=${reason};causeCode=${causeCode}`,
    );
    this.name = "StructuredProviderTransportError";
    this.cause = cause;
  }
}

class ResponseBodyReadError extends Error {
  constructor(
    cause: unknown,
    readonly partialBytes: number,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ResponseBodyReadError";
    this.cause = cause;
  }
}

async function readResponseText(response: Response) {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) {
    text += decoder.decode();
    if (isCompleteInterruptedResponse(response, text)) return text;
    throw new ResponseBodyReadError(
      error,
      new TextEncoder().encode(text).byteLength,
    );
  } finally {
    reader.releaseLock();
  }
}

function isCompleteInterruptedResponse(response: Response, text: string) {
  if (!text.trim()) return false;
  if (!isEventStreamResponse(response, text)) return isCompleteJson(text);
  try {
    const assembled = parseOpenAiEventStream(text).text;
    return /data:\s*\[DONE\]/.test(text) || isCompleteJson(assembled);
  } catch {
    return false;
  }
}

function isCompleteJson(text: string) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function buildProviderRequestError(input: {
  error: unknown;
  stage: ProviderRequestStage;
  startedAt: number;
  timeoutMs: number;
}) {
  const elapsedMs = Math.max(0, Date.now() - input.startedAt);
  const reason = diagnosticErrorMessage(input.error);
  const causeCode = diagnosticErrorCode(input.error);
  if (isTimeoutError(input.error))
    return new Error(
      `STRUCTURED_PROVIDER_TIMEOUT:stage=${input.stage};timeoutMs=${input.timeoutMs};elapsedMs=${elapsedMs};reason=${reason};causeCode=${causeCode}`,
    );
  return new StructuredProviderTransportError(
    input.stage,
    reason,
    causeCode,
    input.error,
  );
}

function buildTransportRetryExhaustedError(input: {
  attempt: number;
  error: unknown;
  startedAt: number;
  timeoutMs: number;
}) {
  const transport =
    input.error instanceof StructuredProviderTransportError
      ? input.error
      : new StructuredProviderTransportError(
          "request",
          diagnosticErrorMessage(input.error),
          diagnosticErrorCode(input.error),
          input.error,
        );
  const error = new Error(
    `STRUCTURED_PROVIDER_TRANSPORT_FAILED:stage=${transport.stage};attempts=${input.attempt};timeoutMs=${input.timeoutMs};elapsedMs=${Math.max(0, Date.now() - input.startedAt)};reason=${transport.reason};causeCode=${transport.causeCode};partialBytes=${diagnosticPartialBytes(transport.cause)}`,
  );
  error.cause = input.error;
  return error;
}

function diagnosticPartialBytes(error: unknown): number {
  if (error instanceof ResponseBodyReadError) return error.partialBytes;
  if (isRecord(error) && error.cause && error.cause !== error)
    return diagnosticPartialBytes(error.cause);
  return 0;
}

function diagnosticErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeDiagnosticValue(message || "unknown");
}

function diagnosticErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string" && error.code.trim())
    return sanitizeDiagnosticValue(error.code);
  if (isRecord(error) && error.cause && error.cause !== error)
    return diagnosticErrorCode(error.cause);
  return "unknown";
}

function sanitizeDiagnosticValue(value: string) {
  return value.replace(/[;\r\n]+/g, " ").trim().slice(0, 240) || "unknown";
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
