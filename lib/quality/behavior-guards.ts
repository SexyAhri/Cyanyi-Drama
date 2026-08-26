import type { MediaAsset, MediaTaskKind } from "@/lib/media/task-contract";
import type { RenderSpecification } from "@/lib/providers/local/render-spec";

export type GuardedTimelineSegment = {
  url: string;
  panelIndex: number;
  kind?: "image" | "video";
  durationSeconds?: number;
};

export function assertTimelineRenderBehavior(input: {
  segments: GuardedTimelineSegment[];
  specification: RenderSpecification;
}) {
  if (!input.segments.length) throw new Error("TIMELINE_RENDER_SEGMENTS_EMPTY");
  if (input.segments.length > 1000)
    throw new Error("TIMELINE_RENDER_SEGMENTS_LIMIT_EXCEEDED");
  const panels = new Set<number>();
  for (const segment of input.segments) {
    if (!Number.isInteger(segment.panelIndex) || segment.panelIndex < 0)
      throw new Error("TIMELINE_RENDER_PANEL_INDEX_INVALID");
    if (panels.has(segment.panelIndex))
      throw new Error(`TIMELINE_RENDER_PANEL_DUPLICATE:${segment.panelIndex}`);
    panels.add(segment.panelIndex);
    assertFetchableMediaUrl(segment.url);
    if (
      segment.durationSeconds !== undefined &&
      (!Number.isFinite(segment.durationSeconds) ||
        segment.durationSeconds < 0.1 ||
        segment.durationSeconds > 300)
    )
      throw new Error(`TIMELINE_RENDER_DURATION_INVALID:${segment.panelIndex}`);
  }
  if (
    input.specification.width % 2 ||
    input.specification.height % 2 ||
    input.specification.pixelFormat !== "yuv420p" ||
    input.specification.videoCodec !== "libx264"
  )
    throw new Error("TIMELINE_RENDER_SPECIFICATION_UNSAFE");
}

export function assertMediaTaskOutputBehavior(input: {
  taskKind: MediaTaskKind;
  output: MediaAsset[];
}) {
  if (!input.output.length) throw new Error("MEDIA_TASK_OUTPUT_EMPTY");
  const ids = new Set<string>();
  for (const asset of input.output) {
    if (!asset.id.trim()) throw new Error("MEDIA_TASK_ASSET_ID_REQUIRED");
    if (ids.has(asset.id)) throw new Error(`MEDIA_TASK_ASSET_ID_DUPLICATE:${asset.id}`);
    ids.add(asset.id);
    assertFetchableMediaUrl(asset.url);
    const compatible =
      asset.kind === input.taskKind ||
      (input.taskKind === "lipsync" && asset.kind === "video");
    if (!compatible)
      throw new Error(`MEDIA_TASK_ASSET_KIND_MISMATCH:${input.taskKind}:${asset.kind}`);
  }
}

function assertFetchableMediaUrl(value: string) {
  if (value.startsWith("data:")) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MEDIA_URL_INVALID");
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error(`MEDIA_URL_PROTOCOL_UNSUPPORTED:${url.protocol}`);
}
