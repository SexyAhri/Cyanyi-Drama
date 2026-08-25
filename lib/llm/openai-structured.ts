import { z } from "zod";

import { fetchWithProviderRetry } from "@/lib/providers/http";
import type { RenderedPrompt } from "@/lib/prompts";
import {
  generateStructuredOutput,
  type StructuredMessage,
} from "./structured-output";

export async function requestOpenAiStructured<T>(input: {
  baseUrl: string;
  apiKeys: string[];
  model: string;
  prompt: RenderedPrompt;
  schema: z.ZodType<T>;
  temperature?: number;
  timeoutMs?: number;
  maxCorrectionAttempts?: number;
}) {
  let lastError: unknown;
  for (const apiKey of input.apiKeys) {
    try {
      const result = await generateStructuredOutput({
        schema: input.schema,
        prompt: input.prompt.text,
        maxCorrectionAttempts: input.maxCorrectionAttempts,
        request: (messages) =>
          requestText({
            baseUrl: input.baseUrl,
            apiKey,
            model: input.model,
            messages,
            temperature: input.temperature,
            timeoutMs: input.timeoutMs,
          }),
      });
      return {
        ...result,
        promptId: input.prompt.id,
        promptVersion: input.prompt.version,
        promptVersionHash: input.prompt.versionHash,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("STRUCTURED_PROVIDER_REQUEST_FAILED");
}

async function requestText(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: StructuredMessage[];
  temperature?: number;
  timeoutMs?: number;
}) {
  const response = await fetchWithProviderRetry(
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
        response_format: { type: "json_object" },
        messages: input.messages,
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 120_000),
      cache: "no-store",
    },
  );
  const payload = await readJson(response);
  if (!response.ok)
    throw new Error(
      `STRUCTURED_PROVIDER_FAILED:${response.status}:${providerMessage(payload)}`,
    );
  return extractText(payload);
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

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function providerMessage(payload: unknown) {
  if (isRecord(payload) && typeof payload.message === "string")
    return payload.message;
  if (
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.message === "string"
  )
    return payload.error.message;
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
