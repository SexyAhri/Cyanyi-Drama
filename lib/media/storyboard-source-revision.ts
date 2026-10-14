import { createHash } from "node:crypto";

type SourceReference = {
  assetId?: string;
  storageKey?: string;
  url?: string;
  mimeType?: string;
  role?: string;
};

function referenceIdentity(reference: SourceReference) {
  const url = reference.url ?? "";
  return {
    assetId: reference.assetId ?? null,
    storageKey: reference.storageKey ?? null,
    // A digest retains change detection without duplicating signed URLs or inline media.
    urlHash: url ? createHash("sha256").update(url).digest("hex") : null,
    mimeType: reference.mimeType ?? null,
    role: reference.role ?? null,
  };
}

export function storyboardSourceFingerprint(value: {
  episodeNovelText?: string | null;
  episodeActiveSourceId?: string | null;
  clipId: string | null;
  clipContent: string | null;
  screenplay: string | null;
  panel?: Record<string, unknown>;
  description: string | null;
  videoPrompt: string | null;
  voiceoverText: string | null;
  lipSyncText: string | null;
  voiceLines: Array<{ speaker: string; content: string; delivery: string }>;
  referenceImages?: SourceReference[];
  referenceAudios?: SourceReference[];
}) {
  const normalized = {
    ...value,
    referenceImages: value.referenceImages?.map(referenceIdentity) ?? [],
    referenceAudios: value.referenceAudios?.map(referenceIdentity) ?? [],
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function storyboardSourceRevisionMatches(input: {
  expected?: string;
  current?: string;
  publishedConfigurationChanged?: boolean;
  newerExecutionExists?: boolean;
}) {
  const changed = !input.expected || input.current !== input.expected;
  const fields = [
    ...(changed ? ["source.screenplay_prompt_or_references"] : []),
    ...(input.publishedConfigurationChanged ? ["production_configuration"] : []),
    ...(input.newerExecutionExists ? ["newer_execution"] : []),
  ];
  return { stale: fields.length > 0, fields };
}

export function storyboardSourceFingerprintForPanel(
  panel: {
    clipId: string | null;
    description: string | null;
    videoPrompt: string | null;
    voiceoverText: string | null;
    lipSyncText: string | null;
    imagePrompt?: string | null;
    imagePromptDesignJson?: string | null;
    videoPromptDesignJson?: string | null;
    firstLastFramePromptDesignJson?: string | null;
    firstLastFramePrompt?: string | null;
    startStateJson?: string | null;
    endStateJson?: string | null;
    motionBeatsJson?: string | null;
    worldContextJson?: string | null;
    imageAssetId?: string | null;
    videoAssetId?: string | null;
    charactersJson?: string | null;
    propsJson?: string | null;
    locationName?: string | null;
    clip: { content: string | null; screenplay: string | null } | null;
    voiceLines: Array<{ speaker: string; content: string; delivery: string }>;
    storyboard?: { episode?: { novelText?: string | null; activeSourceId?: string | null } | null };
  },
  request: { referenceImages?: SourceReference[]; referenceAudios?: SourceReference[] } = {},
) {
  return storyboardSourceFingerprintForPanelVersion(panel, request, 2);
}

/** Preserve the exact v1 source calculation for tasks already running before scoped invalidation. */
export function storyboardSourceFingerprintForPanelLegacy(
  panel: Parameters<typeof storyboardSourceFingerprintForPanelVersion>[0],
  request: Parameters<typeof storyboardSourceFingerprintForPanelVersion>[1] = {},
) {
  return storyboardSourceFingerprintForPanelVersion(panel, request, 1);
}

function storyboardSourceFingerprintForPanelVersion(
  panel: {
    clipId: string | null;
    description: string | null;
    videoPrompt: string | null;
    voiceoverText: string | null;
    lipSyncText: string | null;
    imagePrompt?: string | null;
    imagePromptDesignJson?: string | null;
    videoPromptDesignJson?: string | null;
    firstLastFramePromptDesignJson?: string | null;
    firstLastFramePrompt?: string | null;
    startStateJson?: string | null;
    endStateJson?: string | null;
    motionBeatsJson?: string | null;
    worldContextJson?: string | null;
    imageAssetId?: string | null;
    videoAssetId?: string | null;
    charactersJson?: string | null;
    propsJson?: string | null;
    locationName?: string | null;
    clip: { content: string | null; screenplay: string | null } | null;
    voiceLines: Array<{ speaker: string; content: string; delivery: string }>;
    storyboard?: { episode?: { novelText?: string | null; activeSourceId?: string | null } | null };
  },
  request: { referenceImages?: SourceReference[]; referenceAudios?: SourceReference[] },
  version: 1 | 2,
) {
  const {
    clip, voiceLines, storyboard, ...panelFields
  } = panel;
  const base = storyboardSourceFingerprint({
    episodeNovelText: version === 1 ? storyboard?.episode?.novelText ?? null : null,
    episodeActiveSourceId: version === 1 ? storyboard?.episode?.activeSourceId ?? null : null,
    clipId: panel.clipId,
    clipContent: clip?.content ?? null,
    screenplay: clip?.screenplay ?? null,
    panel: panelFields,
    description: panel.description,
    videoPrompt: panel.videoPrompt,
    voiceoverText: panel.voiceoverText,
    lipSyncText: panel.lipSyncText,
    voiceLines,
    referenceImages: request.referenceImages,
    referenceAudios: request.referenceAudios,
  });
  return version === 1
    ? base
    : createHash("sha256").update(`${base}\u0000storyboard-panel-source-v2`).digest("hex");
}
