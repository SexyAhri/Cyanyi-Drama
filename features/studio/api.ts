import type { MediaTask } from "@/lib/media/task-contract";
import type { EpisodeRecord, ProjectRecord } from "@/lib/projects/types";

import type {
  EpisodeSplitResult,
  ProductionData,
  ProductionPropRecord,
  ProjectAssetCatalog,
  ProjectMediaAsset,
  ProjectListResponse,
  ProjectWithEpisodes,
  StudioModelOption,
  StudioStoryboardData,
  StudioStoryboardPanel,
  WorkflowRunSummary,
  WorkspaceSnapshot,
} from "./types";
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

export async function loadWorkspaceSnapshot(
  projectId: string,
  signal?: AbortSignal,
): Promise<WorkspaceSnapshot> {
  const encodedProjectId = encodeURIComponent(projectId);
  const [projectResult, workflowResult, taskResult] = await Promise.all([
    request<{ project: ProjectWithEpisodes }>(
      `/api/projects/${encodedProjectId}/data`,
      { signal },
    ),
    request<{ workflows: WorkflowRunSummary[] }>(
      `/api/projects/${encodedProjectId}/workflows?limit=100`,
      { signal },
    ),
    request<{ tasks: MediaTask[] }>(
      `/api/media/tasks?projectId=${encodedProjectId}&limit=100`,
      { signal },
    ),
  ]);

  return {
    project: projectResult.project,
    tasks: taskResult.tasks,
    workflows: workflowResult.workflows,
  };
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
  input: { name?: string; description?: string | null; novelText?: string | null },
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

export async function loadStudioModels() {
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
        capabilities?: { modalities?: string[] };
      }>;
    }>;
  }>("/api/channels");

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
  input: {
    channelId: string;
    model: string;
    locale: "en" | "zh";
    concurrency?: number;
  },
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

export async function splitStudioNovel(
  projectId: string,
  input: {
    content: string;
    mode: "auto" | "markers" | "ai";
    channelId?: string;
    model?: string;
    locale: "en" | "zh";
    persist: boolean;
  },
) {
  return request<EpisodeSplitResult>(
    `/api/projects/${encodeURIComponent(projectId)}/episodes/split`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
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
  const result = await request<{ assets: ProjectMediaAsset[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/assets`,
    { signal },
  );
  return result.assets;
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
  return request<{ asset: ProjectMediaAsset & { target: { entityId: string; entityType: string } } }>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/upload`,
    { body: form, method: "POST" },
  );
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
  return request<{ task: MediaTask; entity: { id: string; entityType: string } }>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/generate`,
    {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
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
  input: { channelId: string; model: string; locale: "en" | "zh" },
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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
  });
  const body = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok) {
    throw new StudioApiError(
      typeof body?.message === "string" ? body.message : "请求失败",
      response.status,
    );
  }
  return body as T;
}
