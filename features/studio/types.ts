import type { MediaTask } from "@/lib/media/task-contract";
import type { EpisodeRecord, ProjectRecord } from "@/lib/projects/types";

export type StudioLocale = "en" | "zh-CN";

export type ProjectListResponse = {
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  projects: ProjectRecord[];
};

export type ProjectWithEpisodes = ProjectRecord & {
  episodes: EpisodeRecord[];
};

export type WorkflowStepSummary = {
  id: string;
  key: string;
  type: string;
  index: number;
  status: string;
  attempt: number;
  maxAttempts: number;
  error?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
};

export type WorkflowRunSummary = {
  id: string;
  traceId: string;
  spanId: string;
  projectId: string;
  episodeId?: string;
  workflowType: string;
  status: string;
  error?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  steps: WorkflowStepSummary[];
};

export type WorkspaceSnapshot = {
  project: ProjectWithEpisodes;
  tasks: MediaTask[];
  workflows: WorkflowRunSummary[];
};

export type StudioStageId =
  | "writing"
  | "assets"
  | "storyboard"
  | "shots"
  | "audio"
  | "delivery";

export type StudioStageStatus =
  | "not_started"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "canceled"
  | "failed"
  | "blocked";

export type StudioStageState = {
  id: StudioStageId;
  status: StudioStageStatus;
  completedTasks: number;
  failedTasks: number;
  totalTasks: number;
  workflow?: WorkflowRunSummary;
};
