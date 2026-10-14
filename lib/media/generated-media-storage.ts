import type { MediaAsset } from "@/lib/media/task-contract";
import { stripAudioFromVideoUrl, inspectVideoBytes } from "@/lib/providers/local/ffmpeg-video";
import { storeMediaBytes } from "@/lib/storage";

export async function storeGeneratedMediaAsset(input: {
  asset: MediaAsset;
  storageKey: string;
  stripVideoAudio: boolean;
  signal?: AbortSignal;
  videoValidation?: { requireAudio: boolean; expectedDurationSeconds?: number };
  onExecutionPhase?: (phase: "downloading" | "saving") => Promise<void>;
}) {
  if (input.asset.kind === "video" && input.videoValidation && !input.stripVideoAudio) {
    await input.onExecutionPhase?.("downloading");
    const response = await fetch(input.asset.url, { cache: "no-store", signal: input.signal ?? AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`VIDEO_OUTPUT_DOWNLOAD_FAILED:${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const inspection = await inspectVideoBytes(bytes, input.videoValidation);
    input.asset.durationSeconds = inspection.durationSeconds;
    input.asset.metadata = { ...input.asset.metadata, audioValidation: inspection };
    await input.onExecutionPhase?.("saving");
    return storeMediaBytes(bytes, input.storageKey, input.asset.mimeType ?? "video/mp4");
  }
  if (!input.stripVideoAudio) {
    const isDataUrl = input.asset.url.startsWith("data:");
    await input.onExecutionPhase?.(isDataUrl ? "saving" : "downloading");
    const response = isDataUrl
      ? null
      : await fetch(input.asset.url, { cache: "no-store", signal: input.signal });
    if (response && !response.ok)
      throw new Error(`MEDIA_DOWNLOAD_FAILED:${response.status}`);
    const bytes = isDataUrl
      ? dataUrlBytes(input.asset.url)
      : new Uint8Array(await response!.arrayBuffer());
    const contentType = input.asset.mimeType || response?.headers.get("content-type") || undefined;
    if (!isDataUrl) await input.onExecutionPhase?.("saving");
    return storeMediaBytes(bytes, input.storageKey, contentType);
  }
  if (input.asset.kind !== "video")
    throw new Error(`VIDEO_AUDIO_STRIP_KIND_INVALID:${input.asset.kind}`);
  await input.onExecutionPhase?.("downloading");
  const bytes = await stripAudioFromVideoUrl(input.asset.url);
  if (input.videoValidation) {
    const inspection = await inspectVideoBytes(bytes, { ...input.videoValidation, requireAudio: false });
    if (inspection.hasAudio) throw new Error("VIDEO_OUTPUT_AUDIO_NOT_REMOVED");
    input.asset.durationSeconds = inspection.durationSeconds;
    input.asset.metadata = { ...input.asset.metadata, audioValidation: inspection };
  }
  await input.onExecutionPhase?.("saving");
  return storeMediaBytes(
    bytes,
    input.storageKey,
    input.asset.mimeType ?? "video/mp4",
  );
}

function dataUrlBytes(value: string) {
  const match = value.match(/^data:([^,]*?),([\s\S]*)$/);
  if (!match) throw new Error("MEDIA_DATA_URL_INVALID");
  const encoded = match[2];
  return new Uint8Array(/;base64/i.test(match[1])
    ? Buffer.from(encoded, "base64")
    : Buffer.from(decodeURIComponent(encoded)));
}
