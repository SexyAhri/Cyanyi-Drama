import type { MediaTask } from "@/lib/media/task-contract";
import {
  parseAssetVisualProfile,
  type AssetVisualProfile,
} from "@/lib/assets/visual-profile";
import type {
  EpisodeRecord,
  EpisodeSourceVersionRecord,
  ProjectConfig,
  ProjectRecord,
} from "@/lib/projects/types";

import type {
  EpisodeSplitResult,
  EpisodeSourceListResult,
  EditorProjectRecord,
  EpisodeAudioTrackRecord,
  ProductionData,
  ProductionDeliverableCatalog,
  ProductionDeliverableRecord,
  ProductionPropRecord,
  ProjectAssetCatalog,
  ProjectMediaAsset,
  ProjectListResponse,
  StudioModelOption,
  StudioStoryboardData,
  StudioBalance,
  StudioExecutionTrace,
  StudioUsageCost,
  StudioStoryboardPanel,
  VoiceLineRecord,
  VoicePresetRecord,
  WorkflowRunSummary,
  WorkspaceSnapshot,
  StoryPackageGenerationResult,
} from "./types";
import type { StoryboardPromptPreview } from "@/lib/media/project-asset-tasks";
import type {
  NovelCharacterRecord,
  NovelLocationRecord,
} from "@/lib/novel/domain-types";

export class StudioApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StudioApiError";
  }
}

export async function listStudioProjects(search: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ page: "1", pageSize: "100" });
  if (search.trim()) params.set("search", search.trim());
  return request<ProjectListResponse>(`/api/projects?${params}`, { signal });
}

export async function createStudioProject(input: {
  name: string;
  description?: string;
}) {
  return request<{ project: ProjectRecord }>("/api/projects", {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export async function deleteStudioProject(projectId: string) {
  return request<{ ok: true }>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
  );
}

export async function loadWorkspaceSnapshot(
  projectId: string,
  options?: { signal?: AbortSignal; touch?: boolean },
): Promise<WorkspaceSnapshot> {
  const encodedProjectId = encodeURIComponent(projectId);
  const touch = options?.touch ? "1" : "0";
  const timeoutSignal = AbortSignal.timeout(15_000);
  const signal = options?.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  return request<WorkspaceSnapshot>(
    `/api/projects/${encodedProjectId}/data?touch=${touch}`,
    { signal },
  );
}

export async function createStudioEpisode(
  projectId: string,
  input: { name: string; novelText?: string },
) {
  return request<{ episode: EpisodeRecord }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function updateStudioEpisode(
  projectId: string,
  episodeId: string,
  input: {
    name?: string;
    description?: string | null;
    novelText?: string | null;
  },
) {
  return request<{ episode: EpisodeRecord }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    },
  );
}

export async function updateStudioProjectConfig(
  projectId: string,
  input: Partial<
    Pick<
      ProjectConfig,
      | "analysisModel"
      | "characterModel"
      | "locationModel"
      | "storyboardModel"
      | "editModel"
      | "videoModel"
      | "audioModel"
      | "videoRatio"
      | "artStyle"
      | "visualEra"
      | "visualEraCustom"
      | "ttsRate"
      | "episodeTargetDurationSeconds"
    >
  >,
) {
  return request<{ config: ProjectConfig }>(
    `/api/projects/${encodeURIComponent(projectId)}/config`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    },
  );
}

export async function loadStudioModels(signal?: AbortSignal) {
  const result = await request<{
    channels: Array<{
      id: string;
      name: string;
      models: Array<{
        id: string;
        modelId: string;
        name: string;
        type: string;
        selected: boolean;
        capabilities?: {
          modalities?: string[];
          maxDurationSeconds?: number;
          maxReferenceImages?: number;
        };
      }>;
    }>;
  }>("/api/channels", { signal });

  return result.channels.flatMap((channel) =>
    channel.models.flatMap((model): StudioModelOption[] =>
      model.selected
        ? [
            {
              id: `${channel.id}::${model.modelId || model.id}`,
              channelId: channel.id,
              channelName: channel.name,
              modelId: model.modelId || model.id,
              name: model.name,
              type: model.type,
              modalities: model.capabilities?.modalities ?? [],
              maxDurationSeconds: model.capabilities?.maxDurationSeconds,
              maxReferenceImages: model.capabilities?.maxReferenceImages,
            },
          ]
        : [],
    ),
  );
}

export async function loadStudioProductionData(
  projectId: string,
  episodeId: string,
  signal?: AbortSignal,
) {
  return request<ProductionData>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/production`,
    { signal },
  );
}

export async function startStoryToScriptWorkflow(
  projectId: string,
  episodeId: string,
  input: { locale: "en" | "zh"; channelId: string; model: string },
) {
  return request<{ workflow: WorkflowRunSummary; reused: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/parse`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function controlStudioWorkflow(
  runId: string,
  action: "cancel" | "retry" | "pause" | "resume",
) {
  return request<{ workflow: WorkflowRunSummary }>(
    `/api/workflows/${encodeURIComponent(runId)}`,
    {
      body: JSON.stringify({ action }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function retryStudioWorkflowStep(runId: string, stepKey: string) {
  return request<{ workflow: WorkflowRunSummary }>(
    `/api/workflows/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepKey)}/retry`,
    { method: "POST" },
  );
}

export async function deleteStudioWorkflow(runId: string) {
  return request<{ ok: true }>(`/api/workflows/${encodeURIComponent(runId)}`, {
    method: "DELETE",
  });
}

export async function splitStudioNovel(
  projectId: string,
  input: {
    content?: string;
    manuscriptId?: string;
    createDossier?: boolean;
    sourceFileName?: string;
    title?: string;
    author?: string;
    synopsis?: string;
    mode: "auto" | "markers" | "ai";
    method?: "markers" | "ai";
    markerType?: string | null;
    confidence?: "high" | "medium" | "low" | null;
    episodes?: EpisodeSplitResult["episodes"];
    channelId?: string;
    model?: string;
    locale: "en" | "zh";
    persist: boolean;
  },
  options?: { signal?: AbortSignal; onProgress?: (message: string) => void },
) {
  const result = await request<EpisodeSplitResult>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/split`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: options?.signal,
    },
  );
  if (!result.pending || !result.workflowId) return result;
  while (true) {
    if (options?.signal?.aborted) throw new Error("预览已关闭，分集任务仍在后台执行，可在任务中查看");
    const { workflow } = await request<{ workflow: WorkflowRunSummary & {
      output?: { episodes?: EpisodeSplitResult["episodes"] };
      events?: Array<{ message?: string }>;
    } }>(`/api/workflows/${encodeURIComponent(result.workflowId)}`, { signal: options?.signal });
    options?.onProgress?.(workflow.events?.at(-1)?.message ?? `分集任务：${workflow.status}`);
    if (workflow.status === "succeeded") {
      if (!workflow.output?.episodes) throw new Error("分集任务没有返回边界");
      return { ...result, pending: false, episodes: workflow.output.episodes };
    }
    if (["failed", "blocked", "canceled", "paused"].includes(workflow.status))
      throw new Error(`${typeof workflow.error?.message === "string" ? workflow.error.message : `分集任务：${workflow.status}`}；可在任务中重试或继续`);
    await new Promise<void>(resolve => setTimeout(resolve, 2000));
  }
}

export async function loadStudioAssetCatalog(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectAssetCatalog> {
  const encodedProjectId = encodeURIComponent(projectId);
  const [assets, characterResult, locationResult, propResult] =
    await Promise.all([
      loadStudioProjectAssets(projectId, signal),
      request<{ characters: NovelCharacterRecord[] }>(
        `/api/projects/${encodedProjectId}/characters`,
        { signal },
      ),
      request<{ locations: NovelLocationRecord[] }>(
        `/api/projects/${encodedProjectId}/locations`,
        { signal },
      ),
      request<{ props: ProductionPropRecord[] }>(
        `/api/projects/${encodedProjectId}/props`,
        { signal },
      ),
    ]);
  return {
    assets,
    characters: characterResult.characters,
    locations: locationResult.locations,
    props: propResult.props,
  };
}

export async function loadStudioProjectAssets(
  projectId: string,
  signal?: AbortSignal,
) {
  const assets: ProjectMediaAsset[] = [];
  let cursor: string | null = null;
  do {
    const result: { assets: ProjectMediaAsset[]; nextCursor?: string | null } = await request(
      `/api/projects/${encodeURIComponent(projectId)}/assets${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { signal },
    );
    assets.push(...result.assets);
    cursor = result.nextCursor ?? null;
  } while (cursor);
  return [...new Map(assets.map(asset => [asset.id, asset])).values()];
}

export async function loadStudioDeliverables(
  projectId: string,
  signal?: AbortSignal,
) {
  return request<ProductionDeliverableCatalog>(
    `/api/projects/${encodeURIComponent(projectId)}/deliverables`,
    { signal },
  );
}

export async function createStudioDeliverable(
  projectId: string,
  input: {
    department: string;
    deliverableType: string;
    title: string;
    scopeType: string;
    scopeId: string;
    episodeId?: string;
    payload: Record<string, unknown>;
    sourceRefs?: unknown[];
    dependencyIds?: string[];
  },
) {
  return request<{ deliverable: ProductionDeliverableRecord }>(
    `/api/projects/${encodeURIComponent(projectId)}/deliverables`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function generateStudioStoryPackage(
  projectId: string,
  input: {
    channelId: string;
    model: string;
    locale: "zh" | "en";
    setup: {
      storyIdea: string;
      genres: string[];
      audience: string[];
      characters: string[];
      eras: string[];
      hooks: string[];
      artStyle: string;
      episodeCount: number;
      structure: string;
    };
  },
  onProgress?: (progress: { delta?: string; status?: string }) => void,
): Promise<StoryPackageGenerationResult> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/story-package/generate`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify(input),
  });
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => null);
    throw new StudioApiError(error?.message ?? "策划包生成失败", response.status);
  }
  for await (const event of readJsonLineStream(response.body)) {
    if (event.type === "progress") onProgress?.({ delta: typeof event.delta === "string" ? event.delta : undefined, status: typeof event.status === "string" ? event.status : undefined });
    if (event.type === "failed") throw new Error(String(event.message ?? "策划包生成失败"));
    if (event.type === "completed") return event.result as StoryPackageGenerationResult;
  }
  throw new Error("生成连接已中断，请刷新项目检查是否已保存策划包");
}

export async function transitionStudioDeliverable(
  projectId: string,
  deliverableId: string,
  input: {
    action: "submit" | "approve" | "reject" | "lock" | "supersede" | "restore";
    gateKey?: string;
    note?: string;
  },
) {
  return request<{ deliverable: ProductionDeliverableRecord }>(
    `/api/projects/${encodeURIComponent(projectId)}/deliverables/${encodeURIComponent(deliverableId)}`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    },
  );
}

export async function approveStudioDeliverablesBatch(
  projectId: string,
  ids: string[],
) {
  return request<{ deliverables: ProductionDeliverableRecord[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/deliverables/batch`,
    {
      body: JSON.stringify({ action: "approve_all", ids }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function upsertStudioAssetEntity(
  projectId: string,
  input:
    | { kind: "character"; name: string; summary?: string }
    | { kind: "location"; name: string; summary?: string }
    | { kind: "prop"; name: string; summary?: string },
) {
  const encodedProjectId = encodeURIComponent(projectId);
  if (input.kind === "character") {
    return request<{ characters: NovelCharacterRecord[] }>(
      `/api/projects/${encodedProjectId}/characters`,
      {
        body: JSON.stringify({
          characters: [
            { name: input.name, introduction: input.summary || null },
          ],
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      },
    );
  }
  if (input.kind === "location") {
    return request<{ locations: NovelLocationRecord[] }>(
      `/api/projects/${encodedProjectId}/locations`,
      {
        body: JSON.stringify({
          locations: [{ name: input.name, summary: input.summary || null }],
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      },
    );
  }
  return request<{ props: ProductionPropRecord[] }>(
    `/api/projects/${encodedProjectId}/props`,
    {
      body: JSON.stringify({
        props: [{ name: input.name, summary: input.summary || null }],
      }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    },
  );
}

export async function uploadStudioAsset(
  projectId: string,
  input: {
    file: File;
    targetType: "project" | "character" | "location" | "prop";
    targetId: string;
  },
) {
  const form = new FormData();
  form.set("file", input.file);
  form.set("kind", "image");
  form.set("targetType", input.targetType);
  form.set("targetId", input.targetId);
  return request<{
    asset: ProjectMediaAsset & {
      target: { entityId: string; entityType: string };
    };
  }>(`/api/projects/${encodeURIComponent(projectId)}/assets/upload`, {
    body: form,
    method: "POST",
  });
}

export async function extractStudioAssets(
  projectId: string,
  input: {
    assetIds: string[];
    channelId: string;
    model: string;
    locale: "en" | "zh";
  },
) {
  return request<Record<string, unknown>>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/extract`,
    {
      body: JSON.stringify({ ...input, persist: true }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function loadStudioEpisodeSources(
  projectId: string,
  episodeId: string,
  signal?: AbortSignal,
) {
  return request<EpisodeSourceListResult>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/sources`,
    { signal },
  );
}

export async function adaptStudioEpisode(
  projectId: string,
  episodeId: string,
  input: {
    channelId: string;
    model: string;
    mode: "faithful" | "polish" | "drama" | "custom";
    instructions?: string;
    locale: "en" | "zh";
  },
  callbacks?: {
    onReset?: () => void;
    onContent?: (content: string) => void;
    onPhase?: (phase: "generating" | "saving") => void;
    onWorkflowStarted?: (workflowId: string) => void;
  },
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/sources`,
    {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: {
        Accept: "application/x-ndjson",
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  ).catch(() => {
    throw new StudioApiError(studioRequestFallback(), 0);
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const message =
      typeof body?.message === "string" ? body.message.trim() : "";
    throw new StudioApiError(
      isRuntimeLocaleCompatible(message) ? message : studioRequestFallback(),
      response.status,
    );
  }
  if (!response.body) throw new StudioApiError(studioRequestFallback(), 0);

  let source: EpisodeSourceVersionRecord | undefined;
  let content = "";
  for await (const event of readJsonLineStream(response.body)) {
    if (event.type === "started" && typeof event.workflowId === "string")
      callbacks?.onWorkflowStarted?.(event.workflowId);
    if (event.type === "reset") {
      content = "";
      callbacks?.onReset?.();
    }
    if (event.type === "delta" && typeof event.delta === "string") {
      content += event.delta;
      callbacks?.onContent?.(content);
    }
    if (
      event.type === "phase" &&
      (event.phase === "generating" || event.phase === "saving")
    )
      callbacks?.onPhase?.(event.phase);
    if (event.type === "completed" && isEpisodeSourceRecord(event.source))
      source = event.source;
    if (event.type === "failed")
      throw new StudioApiError(
        typeof event.message === "string" && event.message.trim()
          ? event.message
          : studioRequestFallback(),
        500,
      );
  }
  if (!source) throw new StudioApiError(studioRequestFallback(), 0);
  return { source };
}

async function* readJsonLineStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) yield JSON.parse(trimmed) as Record<string, unknown>;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield JSON.parse(buffer) as Record<string, unknown>;
  } finally {
    reader.releaseLock();
  }
}

function isEpisodeSourceRecord(
  value: unknown,
): value is EpisodeSourceVersionRecord {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { content?: unknown }).content === "string"
  );
}

export async function activateStudioEpisodeSource(
  projectId: string,
  episodeId: string,
  sourceId: string,
) {
  return request<{ source: EpisodeSourceVersionRecord }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/sources/${encodeURIComponent(sourceId)}/activate`,
    { method: "POST" },
  );
}

export async function generateStudioAssetVisualProfile(
  projectId: string,
  input: {
    targetType: "character" | "location" | "prop";
    targetId: string;
    channelId: string;
    model: string;
    locale: "en" | "zh";
  },
  callbacks?: { onWorkflowStarted?: (workflowId: string) => void },
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/assets/visual-design`,
    {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: {
        Accept: "application/x-ndjson",
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  ).catch(() => {
    throw new StudioApiError(studioRequestFallback(), 0);
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const message =
      typeof body?.message === "string" ? body.message.trim() : "";
    throw new StudioApiError(
      isRuntimeLocaleCompatible(message) ? message : studioRequestFallback(),
      response.status,
    );
  }
  if (!response.body) throw new StudioApiError(studioRequestFallback(), 0);

  let target: { id: string; type: string; name: string } | undefined;
  let profile: AssetVisualProfile | undefined;
  for await (const event of readJsonLineStream(response.body)) {
    if (event.type === "started" && typeof event.workflowId === "string")
      callbacks?.onWorkflowStarted?.(event.workflowId);
    if (event.type === "completed") {
      target = parseAssetVisualTarget(event.target);
      profile = parseAssetVisualProfile(event.profile);
    }
    if (event.type === "failed")
      throw new StudioApiError(
        typeof event.message === "string" && event.message.trim()
          ? event.message
          : studioRequestFallback(),
        500,
      );
  }
  if (!target || !profile) throw new StudioApiError(studioRequestFallback(), 0);
  return { target, profile };
}

function parseAssetVisualTarget(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const target = value as Record<string, unknown>;
  if (
    typeof target.id !== "string" ||
    typeof target.type !== "string" ||
    typeof target.name !== "string"
  )
    return;
  return { id: target.id, type: target.type, name: target.name };
}

export async function saveStudioAssetVisualProfile(
  projectId: string,
  input: {
    targetType: "character" | "location" | "prop";
    targetId: string;
    spec: import("@/lib/assets/visual-profile").AssetVisualProfileSpec;
  },
) {
  return request<{
    profile: import("@/lib/assets/visual-profile").AssetVisualProfile;
  }>(`/api/projects/${encodeURIComponent(projectId)}/assets/visual-design`, {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
}

export async function generateStudioAssetVisualProfilesBatch(
  projectId: string,
  input: {
    channelId: string;
    completeMissing?: boolean;
    model: string;
    locale: "en" | "zh";
    items: Array<{
      targetType: "character" | "location" | "prop";
      targetId: string;
    }>;
  },
) {
  return request<{ count: number }>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/visual-design-batch`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function generateStudioAsset(
  projectId: string,
  input: {
    targetType: "character" | "location" | "prop";
    targetId: string;
    channelId: string;
    model: string;
    prompt: string;
    ratio?: string;
    resolution?: string;
  },
) {
  return request<{
    task: MediaTask;
    entity: { id: string; entityType: string };
  }>(`/api/projects/${encodeURIComponent(projectId)}/assets/generate`, {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export async function generateStudioAssetBatch(
  projectId: string,
  input: {
    channelId: string;
    model: string;
    prompt: string;
    items: Array<{
      targetType: "character" | "location" | "prop";
      targetId: string;
      prompt?: string;
    }>;
  },
) {
  return request<{ batchId: string; count: number }>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/generate-batch`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function selectStudioAsset(
  projectId: string,
  input: {
    targetType: "character" | "location" | "prop";
    targetId: string;
    assetId?: string;
  },
) {
  return request<{ selected: Record<string, unknown> }>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/select`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function loadStudioStoryboard(
  projectId: string,
  episodeId: string,
  signal?: AbortSignal,
) {
  return request<StudioStoryboardData>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard`,
    { signal },
  );
}

export async function saveStudioStoryboard(
  projectId: string,
  episodeId: string,
  input: {
    expectedVersion?: number;
    status: string;
    sourceHash: string | null;
    panels: StudioStoryboardPanel[];
  },
) {
  return request<StudioStoryboardData>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    },
  );
}

export async function startStudioStoryboardWorkflow(
  projectId: string,
  episodeId: string,
  input: { locale: "en" | "zh"; channelId?: string; model?: string },
) {
  return request<{ workflow: WorkflowRunSummary; reused: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function generateStudioPanelImage(
  projectId: string,
  episodeId: string,
  panelId: string,
  input: { channelId: string; model: string; prompt?: string },
) {
  return request<{ task: MediaTask; panel: Record<string, unknown> }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/${encodeURIComponent(panelId)}/generate`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function previewStudioPanelPrompt(
  projectId: string,
  episodeId: string,
  panelId: string,
  input: {
    kind: "image" | "video";
    prompt?: string;
    mode?: "reference" | "first-last";
    lastFramePanelId?: string;
    channelId?: string;
    model?: string;
  },
  signal?: AbortSignal,
) {
  return request<{ preview: StoryboardPromptPreview }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/${encodeURIComponent(panelId)}/prompt-preview`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal,
    },
  );
}

export async function designStudioPanelPrompt(
  projectId: string,
  episodeId: string,
  panelId: string,
  input: {
    channelId: string;
    model: string;
    kind: "image" | "video";
    mode?: "reference" | "first-last";
    currentPrompt?: string;
    locale: "en" | "zh";
  },
) {
  return request<{
    design: {
      prompt: string;
      designNotes: string[];
      continuitySafeguards: string[];
    };
    trace: Record<string, unknown>;
  }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/${encodeURIComponent(panelId)}/prompt-design`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function generateStudioPanelVideo(
  projectId: string,
  episodeId: string,
  panelId: string,
  input: {
    channelId: string;
    model: string;
    prompt?: string;
    mode?: "reference" | "first-last";
    lastFramePanelId?: string;
  },
) {
  return request<{ task: MediaTask; panel: Record<string, unknown> }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/${encodeURIComponent(panelId)}/generate-video`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function generateStudioPanelBatch(
  projectId: string,
  episodeId: string,
  input: {
    channelId: string;
    model: string;
    kind: "image" | "video";
    mode?: "reference" | "first-last";
    items: Array<{
      panelId: string;
      prompt?: string;
      mode?: "reference" | "first-last";
      lastFramePanelId?: string;
    }>;
  },
) {
  const suffix =
    input.kind === "video" ? "generate-video-batch" : "generate-batch";
  return request<{ batchId: string; count: number }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/${suffix}`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function uploadStudioPanelMedia(
  projectId: string,
  episodeId: string,
  panelId: string,
  file: File,
  kind: "image" | "video",
) {
  const form = new FormData();
  form.set("file", file);
  form.set("kind", kind);
  form.set("episodeId", episodeId);
  form.set("targetType", "storyboard_panel");
  form.set("targetId", panelId);
  return request<{ asset: ProjectMediaAsset }>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/upload`,
    { body: form, method: "POST" },
  );
}

export async function selectStudioPanelMedia(
  projectId: string,
  panelId: string,
  assetId: string,
  assetKind: "image" | "video",
) {
  return request<{ selected: Record<string, unknown> }>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/select`,
    {
      body: JSON.stringify({
        targetType: "storyboard_panel",
        targetId: panelId,
        assetId,
        assetKind,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function controlStudioMediaTask(
  taskId: string,
  action: "cancel" | "retry",
) {
  return request<{ task: MediaTask }>(
    `/api/media/tasks/${encodeURIComponent(taskId)}`,
    {
      body: JSON.stringify({ action }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function generateStudioVfxTask(
  projectId: string,
  episodeId: string,
  deliverableId: string,
  input: {
    stage: "element" | "composite";
    kind: "image" | "video";
    channelId: string;
    model: string;
    prompt: string;
    ratio?: string;
    resolution?: string;
    duration?: string;
  },
) {
  return request<{ task: MediaTask }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/vfx/${encodeURIComponent(deliverableId)}/generate`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function deleteStudioMediaTask(taskId: string) {
  return request<{ ok: true }>(
    `/api/media/tasks/${encodeURIComponent(taskId)}`,
    { method: "DELETE" },
  );
}

export async function deleteStudioMediaAsset(assetId: string) {
  return request<{ ok: true }>(
    `/api/media/assets/${encodeURIComponent(assetId)}`,
    { method: "DELETE" },
  );
}

export async function loadStudioVoicePresets(
  projectId: string,
  signal?: AbortSignal,
) {
  return request<{ presets: VoicePresetRecord[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/voice-presets`,
    { signal },
  );
}

export async function createStudioVoicePreset(
  projectId: string,
  input: {
    name: string;
    providerVoiceId?: string;
    language?: string;
    gender?: string;
    description?: string;
    sample?: File;
  },
) {
  const { sample, ...presetInput } = input;
  const created = await request<{ preset: VoicePresetRecord }>(
    `/api/projects/${encodeURIComponent(projectId)}/voice-presets`,
    {
      body: JSON.stringify(presetInput),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    },
  );
  if (!sample) return created;

  const form = new FormData();
  form.set("file", sample);
  form.set("kind", "audio");
  form.set("targetType", "voice_preset");
  form.set("targetId", created.preset.id);
  form.set("role", "voice_sample");
  const uploaded = await request<{ asset: { id: string } }>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/upload`,
    { body: form, method: "POST" },
  );
  return {
    preset: { ...created.preset, sampleAssetId: uploaded.asset.id },
  };
}

export async function analyzeStudioVoiceLines(
  projectId: string,
  episodeId: string,
  input: { channelId: string; model: string; locale: "en" | "zh" },
) {
  return request<{ submitted: boolean; workflowId: string; reused: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/voice-analyze`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function designStudioVoicePerformance(
  projectId: string,
  episodeId: string,
  input: { channelId: string; model: string; locale: "en" | "zh"; options?: { fillMissingVoiceDesign?: boolean } },
) {
  return request<{
    submitted: boolean; workflowId: string; reused: boolean;
  }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/voice-design`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function updateStudioVoiceLine(
  projectId: string,
  episodeId: string,
  input: Partial<
    Pick<
      VoiceLineRecord,
      | "speaker"
      | "content"
      | "voicePresetId"
      | "voiceProfilePrompt"
      | "emotionPrompt"
      | "emotionStrength"
      | "optimizeInstructions"
      | "delivery"
      | "matchedPanelId"
    >
  > & { lineId: string },
) {
  return request<{ voiceLine: VoiceLineRecord }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/production`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    },
  );
}

export async function generateStudioVoiceLine(
  projectId: string,
  episodeId: string,
  lineId: string,
  input: { channelId: string; model: string },
) {
  return request<{ task: MediaTask; line: { id: string } }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/voice-lines/${encodeURIComponent(lineId)}/generate`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function generateStudioVoiceLineBatch(
  projectId: string,
  episodeId: string,
  input: { channelId: string; model: string; lineIds: string[] },
) {
  return request<{
    count: number;
    results: Array<{ lineId: string; task: MediaTask }>;
    failures: Array<{ lineId: string; message: string }>;
  }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/voice-lines/generate-batch`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function mergeStudioEpisodeAudio(
  projectId: string,
  episodeId: string,
  input: { channelId: string; model: string },
) {
  return request<{ task: MediaTask }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/audio/merge`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function uploadStudioEpisodeAudioTrack(
  projectId: string,
  episodeId: string,
  input: {
    file: File;
    trackType: "ambience" | "sfx" | "music";
    startSeconds: number;
    endSeconds?: number | null;
    volume: number;
    loop: boolean;
  },
) {
  const form = new FormData();
  form.set("file", input.file);
  form.set("trackType", input.trackType);
  form.set("startSeconds", String(input.startSeconds));
  if (input.endSeconds !== undefined && input.endSeconds !== null)
    form.set("endSeconds", String(input.endSeconds));
  form.set("volume", String(input.volume));
  form.set("loop", String(input.loop));
  return request<{
    asset: ProjectMediaAsset;
    track: EpisodeAudioTrackRecord;
  }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/audio/tracks`,
    { body: form, method: "POST" },
  );
}

export async function updateStudioEpisodeAudioTrack(
  projectId: string,
  episodeId: string,
  input: {
    id: string;
    startSeconds?: number;
    endSeconds?: number | null;
    volume?: number;
    loop?: boolean;
  },
) {
  return request<{ track: EpisodeAudioTrackRecord }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/audio/tracks`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    },
  );
}

export async function deleteStudioEpisodeAudioTrack(
  projectId: string,
  episodeId: string,
  trackId: string,
) {
  const params = new URLSearchParams({ id: trackId });
  return request<{ ok: true }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/audio/tracks?${params}`,
    { method: "DELETE" },
  );
}

export async function generateStudioLipSync(
  projectId: string,
  episodeId: string,
  input: {
    channelId: string;
    model: string;
    panelId: string;
    audioAssetId: string;
    voiceLineId: string;
  },
) {
  return request<{ task: MediaTask }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/lip-sync`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function buildStudioTimeline(
  projectId: string,
  episodeId: string,
) {
  return request<{ editorProject: EditorProjectRecord }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/production/timeline`,
    { method: "POST" },
  );
}

export async function saveStudioTimeline(
  projectId: string,
  episodeId: string,
  input: { timeline: EditorProjectRecord["timeline"]; subtitles?: unknown },
) {
  return request<ProductionData>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/production`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    },
  );
}

export async function renderStudioTimeline(
  projectId: string,
  episodeId: string,
  input: {
    channelId: string;
    model: string;
    ratio: string;
    resolution: string;
    fps: number;
  },
) {
  return request<{ task: MediaTask }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/render`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

export async function loadStudioBilling(
  projectId: string,
  signal?: AbortSignal,
) {
  const encodedProjectId = encodeURIComponent(projectId);
  const [balanceResult, costResult] = await Promise.all([
    request<{ balance: StudioBalance }>("/api/user/balance", { signal }),
    request<{ costs: StudioUsageCost[] }>(
      `/api/user/costs?projectId=${encodedProjectId}&limit=100`,
      { signal },
    ),
  ]);
  return { balance: balanceResult.balance, costs: costResult.costs };
}

export async function loadStudioTrace(traceId: string, signal?: AbortSignal) {
  const result = await request<{ trace: StudioExecutionTrace }>(
    `/api/traces/${encodeURIComponent(traceId)}`,
    { signal },
  );
  return result.trace;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      ...init,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new StudioApiError(studioRequestFallback(), 0);
  }
  const body = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok) {
    const serverMessage =
      typeof body?.message === "string" ? body.message.trim() : "";
    throw new StudioApiError(
      isRuntimeLocaleCompatible(serverMessage)
        ? serverMessage
        : studioRequestFallback(),
      response.status,
    );
  }
  return body as T;
}

function studioRequestFallback() {
  return getRuntimeStudioLocale() === "en" ? "Request failed" : "请求失败";
}

function isRuntimeLocaleCompatible(message: string) {
  if (!message) return false;
  const containsHan = /[\u3400-\u9fff]/.test(message);
  return getRuntimeStudioLocale() === "en" ? !containsHan : containsHan;
}

function getRuntimeStudioLocale() {
  if (typeof document === "undefined") return "zh-CN";
  return document.documentElement.lang === "en" ? "en" : "zh-CN";
}

export async function startStudioEpisodePreproduction(projectId: string, episodeId: string, input: { channelId: string; model: string; locale: "en" | "zh" }) {
  return request<{ submitted: boolean; workflowId: string; reused: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/preproduction`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
  );
}
