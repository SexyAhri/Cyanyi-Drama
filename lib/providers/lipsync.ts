import { fetchWithProviderRetry } from "./http";

export type LipSyncProviderResult = {
  url: string;
  providerTaskId: string;
};

export function supportsSpecializedLipSync(providerKey: string) {
  return ["fal", "vidu", "bailian"].includes(providerKey.toLowerCase());
}

export async function generateSpecializedLipSync(input: {
  providerKey: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  videoUrl: string;
  audioUrl: string;
}): Promise<LipSyncProviderResult> {
  const providerKey = input.providerKey.toLowerCase();
  if (providerKey === "fal") return generateFalLipSync(input);
  if (providerKey === "vidu") return generateViduLipSync(input);
  if (providerKey === "bailian") return generateBailianLipSync(input);
  throw new Error(`LIP_SYNC_PROVIDER_UNSUPPORTED:${input.providerKey}`);
}

async function generateFalLipSync(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  videoUrl: string;
  audioUrl: string;
}) {
  const baseUrl = trimUrl(input.baseUrl || "https://queue.fal.run");
  const [videoUrl, audioUrl] = await Promise.all([
    toDataUrl(input.videoUrl),
    toDataUrl(input.audioUrl),
  ]);
  const response = await fetchWithProviderRetry(`${baseUrl}/${trimPath(input.model)}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ video_url: videoUrl, audio_url: audioUrl }),
  });
  const payload = await readObject(response);
  if (!response.ok)
    throw new Error(
      `FAL_LIPSYNC_SUBMIT_FAILED:${response.status}:${message(payload)}`,
    );
  const requestId = stringAt(payload, "request_id");
  if (!requestId) throw new Error("FAL_LIPSYNC_TASK_ID_MISSING");
  const [owner, alias] = trimPath(input.model).split("/");
  if (!owner || !alias) throw new Error("FAL_LIPSYNC_MODEL_INVALID");

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await waitForPoll();
    const statusResponse = await fetchWithProviderRetry(
      `${baseUrl}/${owner}/${alias}/requests/${encodeURIComponent(requestId)}/status?logs=0`,
      { headers: { Authorization: `Key ${input.apiKey}` } },
    );
    if (!statusResponse.ok) continue;
    const statusPayload = await readObject(statusResponse);
    const status = stringAt(statusPayload, "status").toUpperCase();
    if (status === "FAILED")
      throw new Error(`FAL_LIPSYNC_FAILED:${message(statusPayload)}`);
    if (status !== "COMPLETED") continue;
    const responseUrl = stringAt(statusPayload, "response_url");
    const resultResponse = await fetchWithProviderRetry(
      responseUrl ||
        `${baseUrl}/${trimPath(input.model)}/requests/${encodeURIComponent(requestId)}`,
      {
        headers: {
          Authorization: `Key ${input.apiKey}`,
          Accept: "application/json",
        },
      },
    );
    const result = await readObject(resultResponse);
    if (!resultResponse.ok)
      throw new Error(
        `FAL_LIPSYNC_RESULT_FAILED:${resultResponse.status}:${message(result)}`,
      );
    const url = nestedString(result, ["video", "url"]);
    if (!url) throw new Error("FAL_LIPSYNC_RESULT_URL_MISSING");
    return { url, providerTaskId: requestId };
  }
  throw new Error("FAL_LIPSYNC_POLL_TIMEOUT");
}

async function generateViduLipSync(input: {
  baseUrl: string;
  apiKey: string;
  videoUrl: string;
  audioUrl: string;
}) {
  const videoUrl = publicPullUrl(input.videoUrl, "video_url");
  const audioUrl = publicPullUrl(input.audioUrl, "audio_url");
  const apiBase = viduApiBase(input.baseUrl);
  const response = await fetchWithProviderRetry(`${apiBase}/lip-sync`, {
    method: "POST",
    headers: {
      Authorization: `Token ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ video_url: videoUrl, audio_url: audioUrl }),
  });
  const payload = await readObject(response);
  if (!response.ok)
    throw new Error(
      `VIDU_LIPSYNC_SUBMIT_FAILED:${response.status}:${message(payload)}`,
    );
  const taskId = stringAt(payload, "task_id");
  if (!taskId) throw new Error("VIDU_LIPSYNC_TASK_ID_MISSING");

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await waitForPoll();
    const statusResponse = await fetchWithProviderRetry(
      `${apiBase}/tasks/${encodeURIComponent(taskId)}/creations`,
      { headers: { Authorization: `Token ${input.apiKey}` } },
    );
    const statusPayload = await readObject(statusResponse);
    if (!statusResponse.ok)
      throw new Error(`VIDU_LIPSYNC_QUERY_FAILED:${statusResponse.status}`);
    const state = stringAt(statusPayload, "state").toLowerCase();
    if (state === "failed")
      throw new Error(
        `VIDU_LIPSYNC_FAILED:${stringAt(statusPayload, "err_code")}`,
      );
    if (state !== "success") continue;
    const creations = statusPayload.creations;
    const url =
      Array.isArray(creations) &&
      creations[0] &&
      typeof creations[0] === "object"
        ? stringAt(creations[0] as Record<string, unknown>, "url")
        : "";
    if (!url) throw new Error("VIDU_LIPSYNC_RESULT_URL_MISSING");
    return { url, providerTaskId: taskId };
  }
  throw new Error("VIDU_LIPSYNC_POLL_TIMEOUT");
}

async function generateBailianLipSync(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  videoUrl: string;
  audioUrl: string;
}) {
  const apiBase = dashscopeApiBase(input.baseUrl);
  const response = await fetchWithProviderRetry(
    `${apiBase}/services/aigc/image2video/video-synthesis`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
        "X-DashScope-OssResourceResolve": "enable",
      },
      body: JSON.stringify({
        model: input.model,
        input: {
          video_url: publicPullUrl(input.videoUrl, "video_url"),
          audio_url: publicPullUrl(input.audioUrl, "audio_url"),
        },
      }),
    },
  );
  const payload = await readObject(response);
  if (!response.ok)
    throw new Error(
      `BAILIAN_LIPSYNC_SUBMIT_FAILED:${response.status}:${message(payload)}`,
    );
  const taskId = nestedString(payload, ["output", "task_id"]);
  if (!taskId) throw new Error("BAILIAN_LIPSYNC_TASK_ID_MISSING");

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await waitForPoll();
    const statusResponse = await fetchWithProviderRetry(
      `${apiBase}/tasks/${encodeURIComponent(taskId)}`,
      { headers: { Authorization: `Bearer ${input.apiKey}` } },
    );
    const statusPayload = await readObject(statusResponse);
    if (!statusResponse.ok)
      throw new Error(`BAILIAN_LIPSYNC_QUERY_FAILED:${statusResponse.status}`);
    const status = (
      nestedString(statusPayload, ["output", "task_status"]) ||
      stringAt(statusPayload, "task_status")
    ).toUpperCase();
    if (["FAILED", "CANCELED", "UNKNOWN"].includes(status))
      throw new Error(`BAILIAN_LIPSYNC_FAILED:${message(statusPayload)}`);
    if (status !== "SUCCEEDED") continue;
    const url =
      nestedString(statusPayload, ["output", "video_url"]) ||
      firstResultUrl(statusPayload);
    if (!url) throw new Error("BAILIAN_LIPSYNC_RESULT_URL_MISSING");
    return { url, providerTaskId: taskId };
  }
  throw new Error("BAILIAN_LIPSYNC_POLL_TIMEOUT");
}

async function toDataUrl(url: string) {
  if (url.startsWith("data:")) return url;
  const response = await fetchWithProviderRetry(url, { cache: "no-store" });
  if (!response.ok)
    throw new Error(`LIPSYNC_INPUT_DOWNLOAD_FAILED:${response.status}`);
  const mimeType =
    response.headers.get("content-type") || "application/octet-stream";
  return `data:${mimeType};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
}

function publicPullUrl(value: string, field: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`LIPSYNC_INPUT_URL_INVALID:${field}`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    isPrivateHost(url.hostname)
  )
    throw new Error(`LIPSYNC_INPUT_URL_NOT_PUBLIC:${field}`);
  return url.toString();
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (
    ["localhost", "127.0.0.1", "::1"].includes(host) ||
    host.endsWith(".local")
  )
    return true;
  const octets = host.split(".").map((item) => Number.parseInt(item, 10));
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item)))
    return false;
  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function viduApiBase(baseUrl: string) {
  const trimmed = trimUrl(baseUrl || "https://api.vidu.cn");
  return trimmed.endsWith("/ent/v2") ? trimmed : `${trimmed}/ent/v2`;
}

function dashscopeApiBase(baseUrl: string) {
  const trimmed = trimUrl(baseUrl || "https://dashscope.aliyuncs.com");
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

function trimUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function trimPath(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

async function readObject(response: Response) {
  const value: unknown = await response.json().catch(() => ({}));
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringAt(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" ? value[key].trim() : "";
}

function nestedString(value: Record<string, unknown>, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current))
      return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current.trim() : "";
}

function firstResultUrl(value: Record<string, unknown>) {
  const output = value.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return "";
  const results = (output as Record<string, unknown>).results;
  if (!Array.isArray(results) || !results[0] || typeof results[0] !== "object")
    return "";
  const result = results[0] as Record<string, unknown>;
  return stringAt(result, "video_url") || stringAt(result, "url");
}

function message(value: Record<string, unknown>) {
  return (
    stringAt(value, "message") ||
    stringAt(value, "error") ||
    nestedString(value, ["output", "message"]) ||
    "unknown"
  );
}

function waitForPoll() {
  return new Promise((resolve) => setTimeout(resolve, 3000));
}
