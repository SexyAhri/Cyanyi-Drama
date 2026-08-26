import type { MediaTask } from "@/lib/media/task-contract";
import type { EpisodeRecord, ProjectRecord } from "@/lib/projects/types";

import type {
  ProjectListResponse,
  ProjectWithEpisodes,
  WorkflowRunSummary,
  WorkspaceSnapshot,
} from "./types";

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
