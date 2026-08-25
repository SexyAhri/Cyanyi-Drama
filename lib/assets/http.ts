export async function readJsonObject(request: Request) {
  const value: unknown = await request.json().catch(() => ({}));
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function assetError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = /REQUIRED|NOT_FOUND|HISTORY_EMPTY|CANDIDATE/.test(message)
    ? 400
    : 500;
  return Response.json({ message }, { status });
}
