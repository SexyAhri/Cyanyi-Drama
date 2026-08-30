import type { MediaAsset } from "@/lib/media/task-contract";
import { stripAudioFromVideoUrl } from "@/lib/providers/local/ffmpeg-video";
import { downloadAndStoreMedia, storeMediaBytes } from "@/lib/storage";

export async function storeGeneratedMediaAsset(input: {
  asset: MediaAsset;
  storageKey: string;
  stripVideoAudio: boolean;
}) {
  if (!input.stripVideoAudio)
    return downloadAndStoreMedia(
      input.asset.url,
      input.storageKey,
      input.asset.mimeType,
    );
  if (input.asset.kind !== "video")
    throw new Error(`VIDEO_AUDIO_STRIP_KIND_INVALID:${input.asset.kind}`);
  const bytes = await stripAudioFromVideoUrl(input.asset.url);
  return storeMediaBytes(
    bytes,
    input.storageKey,
    input.asset.mimeType ?? "video/mp4",
  );
}
