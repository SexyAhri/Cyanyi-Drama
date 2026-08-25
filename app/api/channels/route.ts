import { randomUUID } from "node:crypto";

import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { decryptSecret, encryptSecret } from "@/lib/server/crypto";
import { getDatabase, persistDatabase, queryRows, runSql } from "@/lib/server/database";

type ChannelInput = {
  id?: string;
  name?: string;
  protocol?: string;
  baseUrl?: string;
  apiKeys?: string[];
  models?: Array<{
    id: string;
    name: string;
    modelId?: string;
    type?: string;
    capabilities?: unknown;
    protocol?: string;
  }>;
  modelIds?: string[];
};

export async function GET() {
  const { user, sessionId } = await ensureAnonymousUser();
  const database = await getDatabase();
  const rows = queryRows<{ id: string; name: string; protocol: string; base_url: string; encrypted_api_keys: string }>(database, "SELECT id, name, protocol, base_url, encrypted_api_keys FROM channels WHERE user_id = ? ORDER BY created_at", [user.id]);
  return attachSessionCookie(Response.json({
    channels: rows.map((row) => {
      const channelModels = queryRows<{
        id: string;
        model_id: string;
        name: string;
        model_type: string;
        capabilities_json: string;
        selected: number;
      }>(database, "SELECT id, model_id, name, model_type, capabilities_json FROM models WHERE channel_id = ? ORDER BY created_at", [row.id]);
      return {
        id: row.id,
        name: row.name,
        protocol: row.protocol,
        baseUrl: row.base_url,
        apiKeys: JSON.parse(decryptSecret(row.encrypted_api_keys)) as string[],
        models: channelModels.map((model) => ({
          id: model.id,
          modelId: model.model_id,
          name: model.name,
          type: model.model_type,
          capabilities: JSON.parse(model.capabilities_json),
          selected: Boolean(model.selected),
          channelId: row.id,
          channelName: row.name,
          protocol: row.protocol,
        })),
      };
    }),
  }), sessionId);
}

export async function PUT(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const body = (await request.json()) as ChannelInput;
  const name = body.name?.trim();
  const baseUrl = body.baseUrl?.trim();
  const protocol = body.protocol?.trim();
  const apiKeys = [...new Set((body.apiKeys ?? []).map((key) => key.trim()).filter(Boolean))];
  if (!name || !baseUrl || !protocol || apiKeys.length === 0) {
    return Response.json({ message: "渠道名称、协议、Base URL 和 API Key 不能为空" }, { status: 400 });
  }

  const database = await getDatabase();
  const id = body.id?.trim() || randomUUID();
  const now = new Date().toISOString();
  const existing = queryRows(database, "SELECT id FROM channels WHERE id = ? AND user_id = ?", [id, user.id]);
  const encryptedKeys = encryptSecret(JSON.stringify(apiKeys));
  if (existing.length) {
    runSql(database, "UPDATE channels SET name = ?, protocol = ?, base_url = ?, encrypted_api_keys = ?, updated_at = ? WHERE id = ? AND user_id = ?", [name, protocol, baseUrl, encryptedKeys, now, id, user.id]);
  } else {
    runSql(database, "INSERT INTO channels (id, user_id, name, protocol, base_url, encrypted_api_keys, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, user.id, name, protocol, baseUrl, encryptedKeys, now, now]);
  }
  const incomingModels = body.models ?? [];
  const selectedModelIds = new Set(body.modelIds ?? []);
  const incomingIds = new Set<string>();
  for (const model of incomingModels) {
    const modelId = model.modelId?.trim() || model.id.trim();
    const modelRecordId = model.id.trim() || `${id}::${modelId}`;
    if (!modelId || !modelRecordId || !model.name.trim()) continue;
    incomingIds.add(modelRecordId);
    runSql(database, `INSERT INTO models (id, channel_id, model_id, name, model_type, capabilities_json, selected, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id, model_id) DO UPDATE SET id = excluded.id, name = excluded.name, model_type = excluded.model_type, capabilities_json = excluded.capabilities_json, selected = excluded.selected, updated_at = excluded.updated_at`, [
      modelRecordId,
      id,
      modelId,
      model.name.trim(),
      model.type || "llm",
      JSON.stringify(model.capabilities ?? {}),
      selectedModelIds.has(modelRecordId) || selectedModelIds.has(modelId) ? 1 : 0,
      now,
      now,
    ]);
  }
  if (body.models) {
    const existingModels = queryRows<{ id: string }>(database, "SELECT id FROM models WHERE channel_id = ?", [id]);
    for (const model of existingModels) {
      if (!incomingIds.has(model.id)) {
        runSql(database, "DELETE FROM models WHERE id = ? AND channel_id = ?", [model.id, id]);
      }
    }
  }
  await persistDatabase();
  return attachSessionCookie(Response.json({ channel: { id, name, protocol, baseUrl, apiKeys, models: incomingModels } }), sessionId);
}

export async function DELETE(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ message: "Channel id is required." }, { status: 400 });
  const database = await getDatabase();
  runSql(database, "DELETE FROM channels WHERE id = ? AND user_id = ?", [id, user.id]);
  await persistDatabase();
  return attachSessionCookie(Response.json({ ok: true }), sessionId);
}
