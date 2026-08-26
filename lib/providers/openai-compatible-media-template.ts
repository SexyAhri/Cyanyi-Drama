import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { MediaAsset } from "@/lib/media/task-contract";
import { fetchWithProviderRetry } from "@/lib/providers/http";

export type TemplateBodyValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: TemplateBodyValue }
  | TemplateBodyValue[];

export type TemplateEndpoint = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  contentType?:
    | "application/json"
    | "multipart/form-data"
    | "application/x-www-form-urlencoded";
  headers?: Record<string, string>;
  bodyTemplate?: TemplateBodyValue;
  omitEmptyBodyFields?: string[];
};

export type OpenAiCompatibleMediaTemplate = {
  version: 1;
  mediaType: "image" | "video";
  mode: "sync" | "async";
  create: TemplateEndpoint;
  status?: TemplateEndpoint;
  content?: TemplateEndpoint;
  response: {
    taskIdPath?: string;
    statusPath?: string;
    outputUrlPath?: string;
    outputUrlsPath?: string;
    errorPath?: string;
  };
  polling?: {
    intervalMs: number;
    timeoutMs: number;
    doneStates: string[];
    failStates: string[];
  };
};

type TemplateVariables = Record<string, TemplateBodyValue | undefined>;

const endpointSchema = z
  .object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().trim().min(1).max(2_000),
    contentType: z
      .enum([
        "application/json",
        "multipart/form-data",
        "application/x-www-form-urlencoded",
      ])
      .optional(),
    headers: z.record(z.string(), z.string()).optional(),
    bodyTemplate: z.json().optional(),
    omitEmptyBodyFields: z.array(z.string().trim().min(1)).max(100).optional(),
  })
  .strict()
  .superRefine((endpoint, context) => {
    if (
      (endpoint.method === "GET" || endpoint.method === "DELETE") &&
      endpoint.bodyTemplate !== undefined
    )
      context.addIssue({
        code: "custom",
        path: ["bodyTemplate"],
        message: `${endpoint.method} template endpoints cannot send a body`,
      });
  });

const mediaTemplateSchema = z
  .object({
    version: z.literal(1),
    mediaType: z.enum(["image", "video"]),
    mode: z.enum(["sync", "async"]),
    create: endpointSchema,
    status: endpointSchema.optional(),
    content: endpointSchema.optional(),
    response: z
      .object({
        taskIdPath: z.string().optional(),
        statusPath: z.string().optional(),
        outputUrlPath: z.string().optional(),
        outputUrlsPath: z.string().optional(),
        errorPath: z.string().optional(),
      })
      .strict(),
    polling: z
      .object({
        intervalMs: z.number().int().min(100).max(60_000),
        timeoutMs: z.number().int().min(1_000).max(3_600_000),
        doneStates: z.array(z.string().trim().min(1)).min(1).max(20),
        failStates: z.array(z.string().trim().min(1)).min(1).max(20),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((template, context) => {
    if (template.mode === "async" && !template.status)
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Async media templates require a status endpoint",
      });
    if (template.mode === "async" && !template.response.taskIdPath)
      context.addIssue({
        code: "custom",
        path: ["response", "taskIdPath"],
        message: "Async media templates require taskIdPath",
      });
    if (!template.response.outputUrlPath && !template.response.outputUrlsPath)
      context.addIssue({
        code: "custom",
        path: ["response"],
        message: "A media output URL mapping is required",
      });
  });

export function parseOpenAiCompatibleMediaTemplate(
  value: unknown,
  expectedMediaType?: "image" | "video",
): OpenAiCompatibleMediaTemplate {
  const parsed = mediaTemplateSchema.parse(value) as OpenAiCompatibleMediaTemplate;
  if (expectedMediaType && parsed.mediaType !== expectedMediaType)
    throw new Error(
      `OPENAI_COMPAT_TEMPLATE_MEDIA_TYPE_MISMATCH:${expectedMediaType}:${parsed.mediaType}`,
    );
  return parsed;
}

export async function executeOpenAiCompatibleMediaTemplate(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  kind: "image" | "video";
  request: Record<string, unknown>;
  template: OpenAiCompatibleMediaTemplate;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<MediaAsset[]> {
  const template = parseOpenAiCompatibleMediaTemplate(
    input.template,
    input.kind,
  );
  const variables = buildTemplateVariables({
    ...input.request,
    model: input.model,
    api_key: input.apiKey,
  });
  const created = await requestEndpoint({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    endpoint: template.create,
    variables,
  });
  if (!created.response.ok)
    throw new Error(templateProviderError(template, created.payload, created.response.status));

  if (template.mode === "sync")
    return toMediaAssets(
      template.mediaType,
      input.model,
      extractOutputUrls(template, created.payload),
      { mode: "sync" },
    );

  const taskId = stringValue(readJsonPath(created.payload, template.response.taskIdPath));
  if (!taskId) throw new Error("OPENAI_COMPAT_TEMPLATE_TASK_ID_MISSING");
  variables.task_id = taskId;
  const polling = template.polling ?? {
    intervalMs: 3_000,
    timeoutMs: 10 * 60_000,
    doneStates: ["succeeded", "completed", "success", "done"],
    failStates: ["failed", "error", "canceled", "cancelled"],
  };
  const doneStates = normalizedSet(polling.doneStates);
  const failStates = normalizedSet(polling.failStates);
  const sleep = input.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = Date.now();
  while (Date.now() - startedAt <= polling.timeoutMs) {
    await sleep(polling.intervalMs);
    const statusResult = await requestEndpoint({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      endpoint: template.status!,
      variables,
    });
    if (!statusResult.response.ok)
      throw new Error(
        templateProviderError(
          template,
          statusResult.payload,
          statusResult.response.status,
        ),
      );
    const state = stringValue(
      readJsonPath(statusResult.payload, template.response.statusPath),
    )?.toLocaleLowerCase();
    const statusUrls = extractOutputUrls(template, statusResult.payload, false);
    if (state && failStates.has(state))
      throw new Error(`OPENAI_COMPAT_TEMPLATE_TASK_FAILED:${state}`);
    if (!state && statusUrls.length)
      return toMediaAssets(template.mediaType, input.model, statusUrls, {
        mode: "async",
        providerTaskId: taskId,
      });
    if (state && doneStates.has(state)) {
      if (statusUrls.length)
        return toMediaAssets(template.mediaType, input.model, statusUrls, {
          mode: "async",
          providerTaskId: taskId,
        });
      if (!template.content)
        throw new Error("OPENAI_COMPAT_TEMPLATE_OUTPUT_MISSING");
      const content = await requestEndpoint({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        endpoint: template.content,
        variables,
      });
      if (!content.response.ok)
        throw new Error(
          templateProviderError(template, content.payload, content.response.status),
        );
      return toMediaAssets(
        template.mediaType,
        input.model,
        extractOutputUrls(template, content.payload),
        { mode: "async", providerTaskId: taskId },
      );
    }
  }
  throw new Error("OPENAI_COMPAT_TEMPLATE_POLL_TIMEOUT");
}

export function renderTemplateBody(
  endpoint: TemplateEndpoint,
  variables: TemplateVariables,
) {
  if (endpoint.bodyTemplate === undefined) return undefined;
  const rendered = renderValue(endpoint.bodyTemplate, variables);
  for (const path of endpoint.omitEmptyBodyFields ?? [])
    omitEmptyPath(rendered, path);
  return rendered;
}

export function readJsonPath(payload: unknown, path: string | undefined) {
  if (!path || (!path.startsWith("$.") && path !== "$")) return undefined;
  if (path === "$") return payload;
  const segments: Array<string | number> = [];
  for (const part of path.slice(2).split(".")) {
    const matcher = /([^\[\]]+)|\[(\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(part)) !== null)
      segments.push(match[1] ?? Number(match[2]));
  }
  let current = payload;
  for (const segment of segments) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      if (!isRecord(current)) return undefined;
      current = current[segment];
    }
  }
  return current;
}

async function requestEndpoint(input: {
  baseUrl: string;
  apiKey: string;
  endpoint: TemplateEndpoint;
  variables: TemplateVariables;
}) {
  const url = resolveEndpointUrl(
    input.baseUrl,
    renderString(input.endpoint.path, input.variables),
  );
  const headers = Object.fromEntries(
    Object.entries(input.endpoint.headers ?? {}).map(([key, value]) => [
      key,
      renderString(value, input.variables),
    ]),
  );
  if (!hasHeader(headers, "authorization"))
    headers.Authorization = `Bearer ${input.apiKey}`;
  const renderedBody = renderTemplateBody(input.endpoint, input.variables);
  const body = buildBody(input.endpoint, renderedBody, headers);
  const response = await fetchWithProviderRetry(url, {
    method: input.endpoint.method,
    headers,
    ...(body !== undefined ? { body } : {}),
    cache: "no-store",
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    payload = text;
  }
  return { response, payload };
}

function buildBody(
  endpoint: TemplateEndpoint,
  value: TemplateBodyValue | undefined,
  headers: Record<string, string>,
): BodyInit | undefined {
  if (value === undefined) return undefined;
  const contentType = endpoint.contentType ?? "application/json";
  if (contentType === "application/json") {
    setHeader(headers, "Content-Type", contentType);
    return JSON.stringify(value);
  }
  if (!isRecord(value))
    throw new Error("OPENAI_COMPAT_TEMPLATE_FORM_BODY_INVALID");
  if (contentType === "application/x-www-form-urlencoded") {
    setHeader(headers, "Content-Type", contentType);
    const params = new URLSearchParams();
    appendFormValues(params, "", value);
    return params;
  }
  deleteHeader(headers, "content-type");
  const form = new FormData();
  appendFormData(form, "", value);
  return form;
}

function renderValue(
  value: TemplateBodyValue,
  variables: TemplateVariables,
): TemplateBodyValue {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/);
    if (exact) {
      if (!(exact[1] in variables))
        throw new Error(`OPENAI_COMPAT_TEMPLATE_VARIABLE_MISSING:${exact[1]}`);
      return cloneJsonValue(variables[exact[1]] ?? "");
    }
    return renderString(value, variables);
  }
  if (Array.isArray(value)) return value.map((item) => renderValue(item, variables));
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        renderValue(item as TemplateBodyValue, variables),
      ]),
    );
  return value;
}

function renderString(value: string, variables: TemplateVariables) {
  return value.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    if (!(key in variables))
      throw new Error(`OPENAI_COMPAT_TEMPLATE_VARIABLE_MISSING:${key}`);
    const resolved = variables[key];
    return Array.isArray(resolved) || isRecord(resolved)
      ? JSON.stringify(resolved)
      : resolved === null || resolved === undefined
        ? ""
        : String(resolved);
  });
}

function buildTemplateVariables(
  request: Record<string, unknown>,
): TemplateVariables {
  const variables: TemplateVariables = {};
  for (const [key, value] of Object.entries(request)) {
    const converted = jsonValue(value);
    if (converted !== undefined) {
      variables[key] = converted;
      variables[toSnakeCase(key)] ??= converted;
    }
  }
  const references = Array.isArray(request.referenceImages)
    ? request.referenceImages.flatMap((item) => {
        if (typeof item === "string") return [item];
        return isRecord(item) && typeof item.url === "string" ? [item.url] : [];
      })
    : [];
  variables.model = stringValue(request.model) ?? "";
  variables.prompt = stringValue(request.prompt) ?? "";
  variables.images = references;
  variables.image = references[0] ?? "";
  variables.aspect_ratio = stringValue(request.ratio) ?? "";
  variables.size = stringValue(request.size) ?? "";
  variables.resolution = stringValue(request.resolution) ?? "";
  variables.duration = jsonValue(request.duration) ?? null;
  variables.task_id ??= "";
  variables.api_key = stringValue(request.api_key) ?? "";
  return variables;
}

function extractOutputUrls(
  template: OpenAiCompatibleMediaTemplate,
  payload: unknown,
  required = true,
) {
  const urls: string[] = [];
  collectUrls(readJsonPath(payload, template.response.outputUrlsPath), urls);
  collectUrls(readJsonPath(payload, template.response.outputUrlPath), urls);
  const unique = [...new Set(urls)];
  if (!unique.length && required)
    throw new Error("OPENAI_COMPAT_TEMPLATE_OUTPUT_MISSING");
  return unique;
}

function collectUrls(value: unknown, output: string[]) {
  if (typeof value === "string") {
    if (value.trim()) output.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, output));
    return;
  }
  if (isRecord(value) && typeof value.url === "string" && value.url.trim())
    output.push(value.url.trim());
}

function toMediaAssets(
  kind: "image" | "video",
  model: string,
  urls: string[],
  metadata: Record<string, unknown>,
) {
  if (!urls.length) throw new Error("OPENAI_COMPAT_TEMPLATE_OUTPUT_MISSING");
  return urls.map((url) => ({
    id: `${kind}-${randomUUID()}`,
    kind,
    url,
    metadata: { model, templateVersion: 1, ...metadata },
  })) satisfies MediaAsset[];
}

function templateProviderError(
  template: OpenAiCompatibleMediaTemplate,
  payload: unknown,
  status: number,
) {
  const mapped = readJsonPath(payload, template.response.errorPath);
  if (typeof mapped === "string" && mapped.trim())
    return `OPENAI_COMPAT_TEMPLATE_PROVIDER_FAILED:${status}:${mapped.trim()}`;
  const fallback = isRecord(payload) && isRecord(payload.error)
    ? payload.error.message
    : isRecord(payload)
      ? payload.message
      : payload;
  return `OPENAI_COMPAT_TEMPLATE_PROVIDER_FAILED:${status}:${String(fallback ?? "unknown").slice(0, 500)}`;
}

function resolveEndpointUrl(baseUrl: string, path: string) {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const resolved = new URL(path.replace(/^\/+/, ""), base);
  if (resolved.origin !== base.origin)
    throw new Error("OPENAI_COMPAT_TEMPLATE_CROSS_ORIGIN_PATH_REJECTED");
  const basePath = base.pathname.replace(/\/+$/, "");
  if (
    basePath.endsWith("/v1") &&
    resolved.pathname.startsWith(`${basePath}/v1/`)
  )
    resolved.pathname = resolved.pathname.replace(`${basePath}/v1/`, `${basePath}/`);
  return resolved.toString();
}

function omitEmptyPath(root: TemplateBodyValue, path: string) {
  if (!isRecord(root)) return;
  const segments = path.replace(/^\$\.?/, "").split(".").filter(Boolean);
  if (!segments.length) return;
  let parent: Record<string, TemplateBodyValue> = root;
  for (const segment of segments.slice(0, -1)) {
    const next = parent[segment];
    if (!isRecord(next)) return;
    parent = next as Record<string, TemplateBodyValue>;
  }
  const key = segments[segments.length - 1];
  if (isEmpty(parent[key])) delete parent[key];
}

function isEmpty(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (isRecord(value) && Object.keys(value).length === 0)
  );
}

function appendFormValues(
  params: URLSearchParams,
  prefix: string,
  value: TemplateBodyValue,
) {
  if (Array.isArray(value)) {
    value.forEach((item) => appendFormValues(params, prefix, item));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) =>
      appendFormValues(params, prefix ? `${prefix}[${key}]` : key, item as TemplateBodyValue),
    );
    return;
  }
  params.append(prefix, value === null ? "" : String(value));
}

function appendFormData(form: FormData, prefix: string, value: TemplateBodyValue) {
  if (Array.isArray(value)) {
    value.forEach((item) => appendFormData(form, prefix, item));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) =>
      appendFormData(form, prefix ? `${prefix}[${key}]` : key, item as TemplateBodyValue),
    );
    return;
  }
  form.append(prefix, value === null ? "" : String(value));
}

function jsonValue(value: unknown): TemplateBodyValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (Array.isArray(value)) {
    const values = value.map(jsonValue);
    return values.some((item) => item === undefined)
      ? undefined
      : (values as TemplateBodyValue[]);
  }
  if (!isRecord(value)) return undefined;
  const entries: Array<[string, TemplateBodyValue]> = [];
  for (const [key, item] of Object.entries(value)) {
    const converted = jsonValue(item);
    if (converted !== undefined) entries.push([key, converted]);
  }
  return Object.fromEntries(entries);
}

function cloneJsonValue(value: TemplateBodyValue | undefined): TemplateBodyValue {
  if (value === undefined) return "";
  return JSON.parse(JSON.stringify(value)) as TemplateBodyValue;
}

function normalizedSet(values: string[]) {
  return new Set(values.map((value) => value.trim().toLocaleLowerCase()));
}

function toSnakeCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLocaleLowerCase();
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasHeader(headers: Record<string, string>, key: string) {
  return Object.keys(headers).some((header) => header.toLocaleLowerCase() === key);
}

function setHeader(headers: Record<string, string>, key: string, value: string) {
  if (!hasHeader(headers, key.toLocaleLowerCase())) headers[key] = value;
}

function deleteHeader(headers: Record<string, string>, key: string) {
  for (const header of Object.keys(headers))
    if (header.toLocaleLowerCase() === key) delete headers[header];
}
