import { randomUUID } from "node:crypto";

import { createUploadedProjectAsset, ProjectAssetError } from "@/lib/assets/project-store";
import { deleteMediaAsset } from "@/lib/media/asset-actions";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";

type Context = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

const MAX_AUDIO_UPLOAD_BYTES = 100 * 1024 * 1024;
const TRACK_TYPES = ["ambience", "sfx", "music"] as const;
type TrackType = (typeof TRACK_TYPES)[number];

class EpisodeAudioTrackError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  let uploadedAssetId: string | null = null;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new EpisodeAudioTrackError("file 是必填项", 400);
    if (!file.type.toLowerCase().startsWith("audio/"))
      throw new EpisodeAudioTrackError("仅支持音频文件", 400);
    if (file.size <= 0 || file.size > MAX_AUDIO_UPLOAD_BYTES)
      throw new EpisodeAudioTrackError("音频文件大小必须在 1B 到 100MB 之间", 400);

    const trackType = parseTrackType(form.get("trackType"));
    const startSeconds = parseFiniteNumber(form.get("startSeconds"), 0);
    const endSeconds = parseOptionalNumber(form.get("endSeconds"));
    const volume = parseFiniteNumber(form.get("volume"), defaultVolume(trackType));
    const loop = parseBoolean(form.get("loop"), trackType !== "sfx");
    validateTrackTiming(startSeconds, endSeconds, volume);

    const asset = await createUploadedProjectAsset({
      userId: user.id,
      projectId,
      episodeId,
      kind: "audio",
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type,
      source: { sourceType: "upload", fileName: file.name },
      targetType: "episode",
      targetId: episodeId,
      role: `${trackType}_audio`,
    });
    uploadedAssetId = asset.id;
    const metadata = { fileName: file.name, loop };
    const track = await prisma.episodeAudioTrack.create({
      data: {
        id: `audio_track_${randomUUID()}`,
        episodeId,
        trackType,
        assetId: asset.id,
        startSeconds,
        endSeconds,
        volume,
        metadataJson: JSON.stringify(metadata),
      },
    });
    return attachSessionCookie(
      Response.json(
        { asset, track: serializeTrack(track, metadata) },
        { status: 201 },
      ),
      sessionId,
    );
  } catch (error) {
    if (uploadedAssetId)
      await deleteMediaAsset({ assetId: uploadedAssetId, userId: user.id }).catch(
        () => undefined,
      );
    if (
      error instanceof EpisodeAudioTrackError ||
      error instanceof ProjectAssetError
    )
      return attachSessionCookie(
        Response.json({ message: error.message }, { status: error.status }),
        sessionId,
      );
    throw error;
  }
}

export async function PATCH(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const id = stringValue(body.id);
    if (!id) throw new EpisodeAudioTrackError("id 是必填项", 400);
    const existing = await prisma.episodeAudioTrack.findFirst({
      where: {
        id,
        episodeId,
        trackType: { in: [...TRACK_TYPES] },
        episode: { projectId, project: { userId: user.id } },
      },
    });
    if (!existing) throw new EpisodeAudioTrackError("音轨不存在", 404);

    const currentMetadata = parseMetadata(existing.metadataJson);
    const startSeconds = hasOwn(body, "startSeconds")
      ? parseFiniteNumber(body.startSeconds, 0)
      : (existing.startSeconds ?? 0);
    const endSeconds = hasOwn(body, "endSeconds")
      ? parseOptionalNumber(body.endSeconds)
      : existing.endSeconds;
    const volume = hasOwn(body, "volume")
      ? parseFiniteNumber(body.volume, 1)
      : (existing.volume ?? 1);
    const loop = hasOwn(body, "loop")
      ? parseBoolean(body.loop, false)
      : currentMetadata.loop === true;
    validateTrackTiming(startSeconds, endSeconds, volume);
    const metadata = { ...currentMetadata, loop };
    const track = await prisma.episodeAudioTrack.update({
      where: { id: existing.id },
      data: {
        startSeconds,
        endSeconds,
        volume,
        metadataJson: JSON.stringify(metadata),
      },
    });
    return attachSessionCookie(
      Response.json({ track: serializeTrack(track, metadata) }),
      sessionId,
    );
  } catch (error) {
    if (error instanceof EpisodeAudioTrackError)
      return attachSessionCookie(
        Response.json({ message: error.message }, { status: error.status }),
        sessionId,
      );
    throw error;
  }
}

export async function DELETE(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id)
    return attachSessionCookie(
      Response.json({ message: "id 是必填项" }, { status: 400 }),
      sessionId,
    );
  const removed = await prisma.episodeAudioTrack.deleteMany({
    where: {
      id,
      episodeId,
      trackType: { in: [...TRACK_TYPES] },
      episode: { projectId, project: { userId: user.id } },
    },
  });
  return attachSessionCookie(
    removed.count
      ? Response.json({ ok: true })
      : Response.json({ message: "音轨不存在" }, { status: 404 }),
    sessionId,
  );
}

function parseTrackType(value: FormDataEntryValue | null): TrackType {
  if (typeof value === "string" && TRACK_TYPES.includes(value as TrackType))
    return value as TrackType;
  throw new EpisodeAudioTrackError("trackType 必须是 ambience、sfx 或 music", 400);
}

function parseFiniteNumber(value: unknown, fallback: number) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed))
    throw new EpisodeAudioTrackError("音轨参数必须是有效数字", 400);
  return parsed;
}

function parseOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return parseFiniteNumber(value, 0);
}

function parseBoolean(value: unknown, fallback: boolean) {
  if (value === null || value === undefined || value === "") return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new EpisodeAudioTrackError("loop 必须是布尔值", 400);
}

function validateTrackTiming(
  startSeconds: number,
  endSeconds: number | null,
  volume: number,
) {
  if (startSeconds < 0 || startSeconds > 10_800)
    throw new EpisodeAudioTrackError("音轨开始时间必须在 0 到 10800 秒之间", 400);
  if (endSeconds !== null && (endSeconds <= startSeconds || endSeconds > 10_800))
    throw new EpisodeAudioTrackError("音轨结束时间必须晚于开始时间", 400);
  if (volume < 0 || volume > 2)
    throw new EpisodeAudioTrackError("音轨音量必须在 0 到 2 之间", 400);
}

function defaultVolume(trackType: TrackType) {
  return trackType === "music" ? 0.2 : trackType === "ambience" ? 0.35 : 0.8;
}

function parseMetadata(value: string | null) {
  try {
    const parsed: unknown = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function serializeTrack(
  track: {
    id: string;
    episodeId: string;
    trackType: string;
    assetId: string | null;
    startSeconds: number | null;
    endSeconds: number | null;
    volume: number | null;
    createdAt: Date;
    updatedAt: Date;
  },
  metadata: Record<string, unknown>,
) {
  return {
    id: track.id,
    episodeId: track.episodeId,
    trackType: track.trackType,
    assetId: track.assetId,
    startSeconds: track.startSeconds,
    endSeconds: track.endSeconds,
    volume: track.volume,
    metadata,
    createdAt: track.createdAt.toISOString(),
    updatedAt: track.updatedAt.toISOString(),
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
