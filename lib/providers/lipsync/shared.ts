import { fetchWithProviderRetry } from "@/lib/providers/http";

export async function toDataUrl(url: string) {
  if (url.startsWith("data:")) return url;
  const response = await fetchWithProviderRetry(url, { cache: "no-store" });
  if (!response.ok)
    throw new Error(`LIPSYNC_INPUT_DOWNLOAD_FAILED:${response.status}`);
  const mimeType =
    response.headers.get("content-type") || "application/octet-stream";
  return `data:${mimeType};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
}

export function publicPullUrl(value: string, field: string) {
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

export function trimUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function trimPath(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

export async function readObject(response: Response) {
  const value: unknown = await response.json().catch(() => ({}));
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stringAt(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" ? value[key].trim() : "";
}

export function nestedString(value: Record<string, unknown>, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current))
      return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current.trim() : "";
}

export function firstResultUrl(value: Record<string, unknown>) {
  const output = value.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return "";
  const results = (output as Record<string, unknown>).results;
  if (!Array.isArray(results) || !results[0] || typeof results[0] !== "object")
    return "";
  const result = results[0] as Record<string, unknown>;
  return stringAt(result, "video_url") || stringAt(result, "url");
}

export function message(value: Record<string, unknown>) {
  return (
    stringAt(value, "message") ||
    stringAt(value, "error") ||
    nestedString(value, ["output", "message"]) ||
    "unknown"
  );
}

export function waitForPoll() {
  return new Promise((resolve) => setTimeout(resolve, 3000));
}
