import { createHash } from "node:crypto";
import { reserveModelRequestCharge, settleModelRequestCharge, type ModelChargeReceipt } from "@/lib/billing/model-charge";
import type { ModelBillingIdentity } from "@/lib/billing/context";
import { inputCharacterCount } from "@/lib/billing/usage";
import { configureProductionRequest } from "@/lib/production-configuration/request";
import { currentProductionConfiguration } from "@/lib/production-configuration/context";
import type { ProductionFallbackProvider } from "@/lib/production-configuration/request";

import { z } from "zod";

import { fetchWithProviderRetry } from "@/lib/providers/http";
import type { RenderedPrompt } from "@/lib/prompts";
import {
  generateStructuredOutput,
  StructuredOutputError,
  type StructuredMessage,
  type StructuredValidationIssue,
} from "./structured-output";

export type StructuredOutputMode = "text" | "json_object" | "json_schema";

export type PromptTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type PromptCharacterUsage = {
  inputCharacters: number;
  outputCharacters: number;
  totalCharacters: number;
};

export type PromptExecutionTrace = {
  promptId: string;
  agentId: string;
  promptVersion: number;
  promptVersionHash: string;
  systemHash: string;
  model: string;
  channelId?: string;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  fallbackPriceCompatibility?: "same" | "different" | "unknown";
  structuredOutputMode: StructuredOutputMode;
  repaired: boolean;
  correctionAttempts: number;
  tokenUsage: PromptTokenUsage | null;
  characterUsage: PromptCharacterUsage;
  requestCount: number;
  billing: ModelChargeReceipt[];
  outputHash: string;
  configurationSources?: Array<{ scopeKey: string; version: number }>;
};

export async function requestOpenAiText(input: {
  billing?: ModelBillingIdentity;
  provider?: string;
  baseUrl: string;
  apiKeys: string[];
  model: string;
  channelId?: string;
  fallbackProvider?: ProductionFallbackProvider;
  prompt: RenderedPrompt;
  imageUrls?: string[];
  temperature?: number;
  timeoutMs?: number;
  stream?: boolean;
  maxTransportAttempts?: number;
  onOutputStart?: () => void;
  onTextDelta?: (delta: string) => void;
}) {
  input = await configureProductionRequest(input);
  let activeProvider: ProductionFallbackProvider = {
    provider: input.provider,
    channelId: input.channelId ?? "",
    baseUrl: input.baseUrl,
    apiKeys: input.apiKeys,
    model: input.model,
  };
  let fallbackUsed = false;
  let fallbackReason: string | undefined;
  let outputReceived = false;
  const messages = [
    ...(input.prompt.systemText
      ? [{ role: "system" as const, content: input.prompt.systemText }]
      : []),
    { role: "user" as const, content: input.prompt.text },
  ];
  const send = (provider: typeof activeProvider) => requestText({
    billing: input.billing,
    channelId: provider.channelId,
    provider: provider.provider,
    action: input.prompt.id,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKeys[0],
    model: provider.model,
    messages,
    imageUrls: input.imageUrls,
    temperature: input.temperature,
    timeoutMs: input.timeoutMs,
    stream: input.stream,
    maxTransportAttempts: input.maxTransportAttempts,
    onOutputStart: input.onOutputStart,
    onTextDelta: (delta) => {
      if (delta) outputReceived = true;
      input.onTextDelta?.(delta);
    },
  });
  let response: Awaited<ReturnType<typeof send>>;
  try {
    response = await send(activeProvider);
  } catch (error) {
    if (!canUseFallback(error, input.fallbackProvider, outputReceived)) throw error;
    assertFallbackCanPreserveInputs(input.fallbackProvider, input.imageUrls);
    fallbackUsed = true;
    fallbackReason = fallbackFailureReason(error);
    activeProvider = input.fallbackProvider;
    response = await send(activeProvider);
  }
  const outputText = response.text.trim();
  if (!outputText) throw new Error("STRUCTURED_PROVIDER_TEXT_MISSING");
  const trace: PromptExecutionTrace = {
    promptId: input.prompt.id,
    agentId: input.prompt.agentId,
    promptVersion: input.prompt.version,
    promptVersionHash: input.prompt.versionHash,
    systemHash: input.prompt.systemHash,
    model: activeProvider.model,
    channelId: activeProvider.channelId,
    fallbackUsed,
    fallbackReason,
    fallbackPriceCompatibility: fallbackUsed ? input.fallbackProvider?.priceCompatibility : undefined,
    structuredOutputMode: "text",
    repaired: false,
    correctionAttempts: 0,
    tokenUsage: response.tokenUsage,
    characterUsage: {
      inputCharacters: messages.reduce((total, message) => total + inputCharacterCount(message.content), 0),
      outputCharacters: inputCharacterCount(outputText),
      totalCharacters: messages.reduce((total, message) => total + inputCharacterCount(message.content), 0) + inputCharacterCount(outputText),
    },
    requestCount: 1,
    billing: response.billing ? [response.billing] : [],
    outputHash: sha256(outputText),
    configurationSources: currentProductionConfiguration()?.snapshot.sources,
  };
  return { text: outputText, outputText, trace };
}

export async function requestOpenAiStructured<T>(input: {
  billing?: ModelBillingIdentity;
  provider?: string;
  baseUrl: string;
  apiKeys: string[];
  model: string;
  channelId?: string;
  fallbackProvider?: ProductionFallbackProvider;
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
  maxCorrectionAttempts?: number;
  onOutputStart?: () => void;
  onTextDelta?: (delta: string) => void;
}) {
  input = await configureProductionRequest(input);
  let activeProvider: ProductionFallbackProvider = {
    provider: input.provider,
    channelId: input.channelId ?? "",
    baseUrl: input.baseUrl,
    apiKeys: input.apiKeys,
    model: input.model,
    structuredOutputMode: input.structuredOutputMode,
  };
  let fallbackUsed = false;
  let fallbackReason: string | undefined;
  let outputReceived = false;
  let tokenUsage: PromptTokenUsage | null = null;
  let apiKeyIndex = 0;
  let structuredOutputMode: StructuredOutputMode = "json_object";
  let requestCount = 0;
  let inputCharacters = 0;
  let outputCharacters = 0;
  const billing: ModelChargeReceipt[] = [];
  let lastOutputText: string | undefined;
  let result: Awaited<ReturnType<typeof generateStructuredOutput<T>>>;
  try {
    result = await generateStructuredOutput({
    schema: input.schema,
    prompt: input.prompt.text,
    systemPrompt: input.prompt.systemText,
    validate: input.validate,
    normalizeRaw: input.normalizeRaw,
    maxCorrectionAttempts: Math.max(
      0,
      Math.min(2, Math.floor(input.maxCorrectionAttempts ?? 0)),
    ),
    request: async (messages) => {
      requestCount += 1;
      inputCharacters += messages.reduce((total, message) => total + inputCharacterCount(message.content), 0);
      const send = async (provider: ProductionFallbackProvider) => {
        const responseFormat = buildStructuredResponseFormat({
          mode: provider.structuredOutputMode ?? "json_object",
          schema: input.schema,
          name: input.prompt.id,
        });
        structuredOutputMode = responseFormat.type;
        const candidateIndex = apiKeyIndex % provider.apiKeys.length;
        const response = await requestText({
          billing: input.billing,
          channelId: provider.channelId,
          provider: provider.provider,
          action: input.prompt.id,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKeys[candidateIndex],
          model: provider.model,
          messages,
          responseFormat,
          imageUrls: input.imageUrls,
          temperature: input.temperature,
          timeoutMs: input.timeoutMs,
          stream: input.stream,
          maxTransportAttempts: input.maxTransportAttempts,
          onOutputStart: input.onOutputStart,
          onTextDelta: (delta) => {
            if (delta) outputReceived = true;
            input.onTextDelta?.(delta);
          },
        });
        apiKeyIndex = candidateIndex;
        tokenUsage = addTokenUsage(tokenUsage, response.tokenUsage);
        lastOutputText = response.text;
        outputCharacters += inputCharacterCount(response.text);
        if (response.billing) billing.push(response.billing);
        return response.text;
      };
      try {
        return await send(activeProvider);
      } catch (error) {
        if (!canUseFallback(error, input.fallbackProvider, outputReceived)) throw error;
        assertFallbackCanPreserveInputs(input.fallbackProvider, input.imageUrls);
        fallbackUsed = true;
        fallbackReason = fallbackFailureReason(error);
        activeProvider = input.fallbackProvider;
        return send(activeProvider);
      }
    },
    });
  } catch (error) {
    if (error instanceof StructuredOutputError) {
      error.executionTrace = {
        promptId: input.prompt.id,
        agentId: input.prompt.agentId,
        promptVersion: input.prompt.version,
        promptVersionHash: input.prompt.versionHash,
        model: activeProvider.model,
        channelId: activeProvider.channelId,
        structuredOutputMode,
        correctionAttempts: Math.max(0, requestCount - 1),
        tokenUsage,
        characterUsage: { inputCharacters, outputCharacters, totalCharacters: inputCharacters + outputCharacters },
        requestCount,
        billing,
        ...(lastOutputText ? { outputHash: sha256(lastOutputText) } : {}),
        configurationSources: currentProductionConfiguration()?.snapshot.sources,
      };
    }
    throw error;
  }
  const trace: PromptExecutionTrace = {
    promptId: input.prompt.id,
    agentId: input.prompt.agentId,
    promptVersion: input.prompt.version,
    promptVersionHash: input.prompt.versionHash,
    systemHash: input.prompt.systemHash,
    model: activeProvider.model,
    channelId: activeProvider.channelId,
    fallbackUsed,
    fallbackReason,
    fallbackPriceCompatibility: fallbackUsed ? input.fallbackProvider?.priceCompatibility : undefined,
    structuredOutputMode,
    repaired: result.repaired,
    correctionAttempts: result.correctionAttempts,
    tokenUsage,
    characterUsage: { inputCharacters, outputCharacters, totalCharacters: inputCharacters + outputCharacters },
    requestCount,
    billing,
    outputHash: sha256(result.outputText),
    configurationSources: currentProductionConfiguration()?.snapshot.sources,
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
  billing?: ModelBillingIdentity;
  channelId?: string;
  provider?: string;
  action: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: StructuredMessage[];
  responseFormat?: ReturnType<typeof buildStructuredResponseFormat>;
  imageUrls?: string[];
  temperature?: number;
  timeoutMs?: number;
  stream?: boolean;
  maxTransportAttempts?: number;
  onOutputStart?: () => void;
  onTextDelta?: (delta: string) => void;
}) {
  let lastError: unknown;
  const startedAt = Date.now();
  const maxAttempts = Math.max(1, Math.min(5, Math.floor(input.maxTransportAttempts ?? 1)));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      input.onOutputStart?.();
      return await requestTextAttempt({ ...input, maxTransportAttempts: 1 });
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

async function requestTextAttempt(input: {
  billing?: ModelBillingIdentity;
  channelId?: string;
  provider?: string;
  action: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: StructuredMessage[];
  responseFormat?: ReturnType<typeof buildStructuredResponseFormat>;
  imageUrls?: string[];
  temperature?: number;
  timeoutMs?: number;
  stream?: boolean;
  maxTransportAttempts?: number;
  onOutputStart?: () => void;
  onTextDelta?: (delta: string) => void;
}) {
  const timeoutMs = input.timeoutMs ?? 120_000;
  let response: Response;
  let responseText: string;
  const startedAt = Date.now();
  const charge = await reserveModelRequestCharge({ identity: input.billing, channelId: input.channelId,
    provider: input.provider, model: input.model, capability: "text", action: input.action,
    usage: { requests: 1, inputCharacters: input.messages.reduce((total, message) => total + inputCharacterCount(message.content), 0) },
  });
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
          ...(input.responseFormat
            ? { response_format: input.responseFormat }
            : {}),
          stream: input.stream ?? true,
          ...((input.stream ?? true)
            ? { stream_options: { include_usage: true } }
            : {}),
          messages: buildOpenAiMessages(input.messages, input.imageUrls),
        }),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      },
      { maxAttempts: 1 },
    );
  } catch (error) {
    await settleModelRequestCharge(charge, false);
    throw buildProviderRequestError({
      error,
      stage: "request",
      startedAt,
      timeoutMs,
    });
  }
  try {
    responseText = await readResponseText(
      response,
      response.headers.get("content-type")?.includes("text/event-stream")
        ? input.onTextDelta
        : undefined,
    );
  } catch (error) {
    await settleModelRequestCharge(charge, false);
    throw buildProviderRequestError({
      error,
      stage: "response_body",
      startedAt,
      timeoutMs,
    });
  }
  const payload = parseJsonText(responseText);
  if (!response.ok) {
    await settleModelRequestCharge(charge, false);
    throw new Error(
      `STRUCTURED_PROVIDER_FAILED:${response.status}:${providerMessage(payload)}`,
    );
  }
  let parsed: { text: string; tokenUsage: PromptTokenUsage | null };
  try {
    if (isRecord(payload) && payload.error)
      throw new Error(`STRUCTURED_PROVIDER_FAILED:200:${providerMessage(payload)}`);
    if (isEventStreamResponse(response, responseText)) {
      parsed = parseOpenAiEventStream(responseText);
    } else {
      parsed = { text: extractText(payload), tokenUsage: normalizeTokenUsage(payload) };
    }
  } catch (error) {
    await settleModelRequestCharge(charge, false);
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
  // Settlement failures retain the successful-response marker for reconciliation.
  const billing = await settleModelRequestCharge(charge, true);
  if (!isEventStreamResponse(response, responseText)) input.onTextDelta?.(parsed.text);
  return { ...parsed, billing };
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

function canUseFallback(
  error: unknown,
  fallback: ProductionFallbackProvider | undefined,
  outputReceived: boolean,
): fallback is ProductionFallbackProvider {
  return Boolean(
    fallback?.apiKeys.length &&
      !outputReceived &&
      isRetryableStructuredProviderError(error),
  );
}

function assertFallbackCanPreserveInputs(
  fallback: ProductionFallbackProvider,
  imageUrls: string[] | undefined,
) {
  if (imageUrls?.length && fallback.supportsReferenceImages !== true)
    throw new Error("PRODUCTION_FALLBACK_INCOMPATIBLE:REFERENCE_IMAGES");
}

function fallbackFailureReason(error: unknown) {
  if (!(error instanceof Error)) return "transient_provider_failure";
  const status = error.message.match(/^STRUCTURED_PROVIDER_FAILED:(\d+):/);
  if (status) return `http_${status[1]}`;
  if (/TIMEOUT|timed out|TimeoutError/i.test(error.message)) return "timeout";
  if (/TRANSPORT|fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(error.message))
    return "transport";
  return "transient_provider_failure";
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

async function readResponseText(
  response: Response,
  onTextDelta?: (delta: string) => void,
) {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let eventBuffer = "";
  const append = (value: string) => {
    text += value;
    if (onTextDelta) {
      eventBuffer += value;
      eventBuffer = emitCompleteEventStreamDeltas(eventBuffer, onTextDelta);
    }
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        append(decoder.decode());
        if (onTextDelta) emitEventStreamDelta(eventBuffer, onTextDelta);
        return text;
      }
      append(decoder.decode(chunk.value, { stream: true }));
    }
  } catch (error) {
    append(decoder.decode());
    if (onTextDelta) emitEventStreamDelta(eventBuffer, onTextDelta);
    if (isCompleteInterruptedResponse(response, text)) return text;
    throw new ResponseBodyReadError(
      error,
      new TextEncoder().encode(text).byteLength,
    );
  } finally {
    reader.releaseLock();
  }
}

function emitCompleteEventStreamDeltas(
  buffer: string,
  onTextDelta: (delta: string) => void,
) {
  const events = buffer.split(/\r?\n\r?\n/);
  const remainder = events.pop() ?? "";
  for (const event of events) emitEventStreamDelta(event, onTextDelta);
  return remainder;
}

function emitEventStreamDelta(
  event: string,
  onTextDelta: (delta: string) => void,
) {
  const data = eventStreamData(event);
  if (!data || data === "[DONE]") return;
  const payload = parseJsonText(data);
  if (isRecord(payload) && payload.error) return;
  const delta = extractStreamText(payload);
  if (delta) onTextDelta(delta);
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
    const data = eventStreamData(event);
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

function eventStreamData(event: string) {
  return event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
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
