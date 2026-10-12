import { jsonrepair } from "jsonrepair";
import { z } from "zod";

export type StructuredMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type StructuredValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export class StructuredOutputError extends Error {
  constructor(
    readonly code:
      | "STRUCTURED_JSON_INVALID"
      | "STRUCTURED_SCHEMA_INVALID"
      | "STRUCTURED_SEMANTIC_INVALID",
    readonly details: string[],
    readonly rawText: string,
  ) {
    super(`${code}:${details.join(";")}`);
  }
}

export function parseStructuredOutput<T>(
  text: string,
  schema: z.ZodType<T>,
  normalizeRaw?: (value: unknown) => unknown,
) {
  const extracted = extractJson(stripMarkdownFence(text));
  let value: unknown;
  let repaired = false;
  try {
    value = JSON.parse(extracted) as unknown;
  } catch (parseError) {
    try {
      value = repairStructuredJson(extracted, parseError);
      repaired = true;
    } catch (repairError) {
      throw new StructuredOutputError(
        "STRUCTURED_JSON_INVALID",
        [message(parseError), message(repairError)],
        text,
      );
    }
  }
  const result = schema.safeParse(normalizeRaw ? normalizeRaw(value) : value);
  if (!result.success)
    throw new StructuredOutputError(
      "STRUCTURED_SCHEMA_INVALID",
      result.error.issues.slice(0, 12).map((issue) => {
        const path = issue.path.length ? issue.path.join(".") : "root";
        return `${path}: ${issue.message}`;
      }),
      text,
    );
  return { data: result.data, repaired };
}

function repairStructuredJson(
  text: string,
  initialParseError: unknown,
): unknown {
  let candidate = text;
  let lastError = initialParseError;
  for (let attempt = 0; attempt < 17; attempt += 1) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch (parseError) {
      lastError = parseError;
      const position = expectedArraySeparatorPosition(parseError);
      const repaired =
        position === null
          ? null
          : insertMissingArraySeparator(candidate, position);
      if (repaired !== null) {
        candidate = repaired;
        continue;
      }
    }

    try {
      return JSON.parse(jsonrepair(candidate)) as unknown;
    } catch (error) {
      lastError = error;
      const position = unexpectedCharacterPosition(error);
      const repaired =
        position === null
          ? null
          : insertMissingArraySeparator(candidate, position);
      if (repaired === null) throw error;
      candidate = repaired;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to repair structured JSON");
}

function expectedArraySeparatorPosition(error: unknown) {
  if (!(error instanceof Error)) return null;
  if (!/Expected\s+['"]?,['"]?\s+or\s+['"]?\]['"]?/i.test(error.message))
    return null;
  const match = /\bposition\s+(\d+)/i.exec(error.message);
  if (!match) return null;
  const position = Number(match[1]);
  return Number.isSafeInteger(position) ? position : null;
}

function unexpectedCharacterPosition(error: unknown) {
  if (!(error instanceof Error)) return null;
  const position = (error as Error & { position?: unknown }).position;
  if (typeof position === "number" && Number.isSafeInteger(position))
    return position;
  const match = /\bat position\s+(\d+)/i.exec(error.message);
  if (!match) return null;
  const parsedPosition = Number(match[1]);
  return Number.isSafeInteger(parsedPosition) ? parsedPosition : null;
}

function insertMissingArraySeparator(text: string, position: number) {
  if (position <= 0 || position >= text.length) return null;
  const previous = text.slice(0, position).trimEnd();
  if (!isCompletedJsonValue(previous)) return null;
  let nextIndex = position;
  while (/\s/.test(text[nextIndex] ?? "")) nextIndex += 1;
  if (!isJsonValueStart(text[nextIndex] ?? "")) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < position; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === "{") stack.push("}");
    else if (character === "[") stack.push("]");
    else if (
      (character === "}" || character === "]") &&
      stack.at(-1) === character
    )
      stack.pop();
  }
  if (stack.at(-1) !== "]") return null;
  return text.slice(0, position) + "," + text.slice(position);
}

function isCompletedJsonValue(text: string) {
  const last = text.at(-1);
  return (
    last === "}" ||
    last === "]" ||
    last === '"' ||
    (last !== undefined && /[0-9]/.test(last)) ||
    /(?:^|[\s,\[])(?:true|false|null)$/i.test(text)
  );
}

function isJsonValueStart(character: string) {
  return (
    character === "{" ||
    character === "[" ||
    character === '"' ||
    character === "-" ||
    /[0-9tfn]/i.test(character)
  );
}

export async function generateStructuredOutput<T>(input: {
  schema: z.ZodType<T>;
  request: (messages: StructuredMessage[]) => Promise<string>;
  prompt: string;
  systemPrompt?: string;
  validate?: (data: T) => StructuredValidationIssue[];
  normalizeRaw?: (value: unknown) => unknown;
  maxCorrectionAttempts?: number;
}) {
  const maxCorrectionAttempts = Math.max(
    0,
    Math.floor(input.maxCorrectionAttempts ?? 1),
  );
  const messages: StructuredMessage[] = [];
  if (input.systemPrompt)
    messages.push({ role: "system", content: input.systemPrompt });
  messages.push({ role: "user", content: input.prompt });
  let correctionAttempts = 0;
  while (true) {
    const outputText = await input.request(messages.slice());
    try {
      const parsed = parseStructuredOutput(
        outputText,
        input.schema,
        input.normalizeRaw,
      );
      const semanticIssues = input.validate?.(parsed.data) ?? [];
      if (semanticIssues.length)
        throw new StructuredOutputError(
          "STRUCTURED_SEMANTIC_INVALID",
          semanticIssues.slice(0, 20).map(
            (issue) => `${issue.path}: [${issue.code}] ${issue.message}`,
          ),
          outputText,
        );
      return { ...parsed, correctionAttempts, outputText };
    } catch (error) {
      if (
        !(error instanceof StructuredOutputError) ||
        correctionAttempts >= maxCorrectionAttempts
      )
        throw error;
      correctionAttempts += 1;
      messages.push(
        { role: "assistant", content: outputText.slice(0, 30_000) },
        {
          role: "user",
          content: [
            "Your previous response failed the required JSON contract.",
            ...error.details.map((detail) => `- ${detail}`),
            "Return the corrected JSON only. Do not add markdown or explanation.",
          ].join("\n"),
        },
      );
    }
  }
}

function stripMarkdownFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJson(value: string) {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");
  if (objectStart < 0 && arrayStart < 0) return value;
  const start =
    arrayStart < 0 || (objectStart >= 0 && objectStart < arrayStart)
      ? objectStart
      : arrayStart;
  const open = value[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const current = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (current === "\\") {
      escaped = true;
      continue;
    }
    if (current === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (current === open) depth += 1;
    if (current === close) depth -= 1;
    if (depth === 0) return value.slice(start, index + 1);
  }
  return value.slice(start);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
