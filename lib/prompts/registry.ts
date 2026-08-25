import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PROMPT_CATALOG } from "./catalog";
import type { PromptId } from "./ids";
import type { PromptLocale, RenderedPrompt } from "./types";

const PLACEHOLDER_PATTERN = /\{\{([A-Za-z0-9_]+)\}\}/g;
const templateCache = new Map<string, string>();

export class PromptContractError extends Error {
  constructor(
    readonly code: string,
    readonly promptId: PromptId,
    message: string,
  ) {
    super(`${code}:${promptId}:${message}`);
  }
}

export function renderPrompt(input: {
  id: PromptId;
  locale?: PromptLocale;
  variables: Record<string, string>;
}): RenderedPrompt {
  const locale = input.locale ?? "zh";
  const entry = PROMPT_CATALOG[input.id];
  if (!entry)
    throw new PromptContractError(
      "PROMPT_ID_UNREGISTERED",
      input.id,
      "Prompt is not registered",
    );
  const template = getPromptTemplate(input.id, locale);
  assertVariableContract(input.id, entry.variables, template, input.variables);
  const text = template.replace(
    PLACEHOLDER_PATTERN,
    (_placeholder, key: string) => input.variables[key],
  );
  const templateHash = sha256(template);
  return {
    id: input.id,
    locale,
    version: entry.version,
    templateHash,
    versionHash: sha256(
      `${input.id}\u0000${entry.version}\u0000${locale}\u0000${templateHash}`,
    ),
    text,
  };
}

export function getPromptTemplate(id: PromptId, locale: PromptLocale) {
  const entry = PROMPT_CATALOG[id];
  if (!entry)
    throw new PromptContractError(
      "PROMPT_ID_UNREGISTERED",
      id,
      "Prompt is not registered",
    );
  const cacheKey = `${id}:${locale}`;
  const cached = templateCache.get(cacheKey);
  if (cached) return cached;
  const filePath = join(
    process.cwd(),
    "lib",
    "prompts",
    `${entry.pathStem}.${locale}.txt`,
  );
  try {
    const template = readFileSync(filePath, "utf8").trim();
    templateCache.set(cacheKey, template);
    return template;
  } catch {
    throw new PromptContractError(
      "PROMPT_TEMPLATE_NOT_FOUND",
      id,
      `${locale}:${filePath}`,
    );
  }
}

function assertVariableContract(
  id: PromptId,
  expected: readonly string[],
  template: string,
  variables: Record<string, string>,
) {
  const declared = new Set(expected);
  const placeholders = new Set(
    Array.from(template.matchAll(PLACEHOLDER_PATTERN), (match) => match[1]),
  );
  for (const key of placeholders)
    if (!declared.has(key))
      throw new PromptContractError("PROMPT_PLACEHOLDER_UNDECLARED", id, key);
  for (const key of declared) {
    if (!placeholders.has(key))
      throw new PromptContractError("PROMPT_PLACEHOLDER_MISSING", id, key);
    if (!(key in variables))
      throw new PromptContractError("PROMPT_VARIABLE_MISSING", id, key);
    if (typeof variables[key] !== "string")
      throw new PromptContractError("PROMPT_VARIABLE_INVALID", id, key);
  }
  for (const key of Object.keys(variables))
    if (!declared.has(key))
      throw new PromptContractError("PROMPT_VARIABLE_UNEXPECTED", id, key);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
