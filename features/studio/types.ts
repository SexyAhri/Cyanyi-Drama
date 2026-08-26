import type { MediaTask } from "@/lib/media/task-contract";
import type {
  NovelCharacterRecord,
  NovelLocationRecord,
} from "@/lib/novel/domain-types";
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

export type StudioModelOption = {
  id: string;
  channelId: string;
  channelName: string;
  modelId: string;
  name: string;
  type: string;
  modalities: string[];
};

export type ProductionClipRecord = {
  id: string;
  projectId: string;
  episodeId: string;
  clipIndex: number;
  summary: string;
  content: string;
  startText: string | null;
  endText: string | null;
  screenplay: string | null;
  characters: string[];
  locations: string[];
  props: string[];
  shotCount: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductionPropRecord = {
  id: string;
  projectId: string;
  name: string;
  summary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ProductionData = {
  clips: ProductionClipRecord[];
  props: ProductionPropRecord[];
};

export type EpisodeSplitDraft = {
  number: number;
  title: string;
  summary: string;
  content: string;
  wordCount: number;
  startIndex: number;
  endIndex: number;
};

export type EpisodeSplitResult = {
  method: "markers" | "ai";
  markerType: string | null;
  confidence: "high" | "medium" | "low" | null;
  episodes: EpisodeSplitDraft[];
  persisted: EpisodeRecord[] | null;
};

export type ProjectMediaAsset = {
  id: string;
  kind: string;
  url: string | null;
  mimeType: string | null;
  metadata: Record<string, unknown>;
  references: Array<{
    entityId: string;
    entityType: string;
    role: string;
  }>;
  sourceTargetId: string | null;
  sourceTargetType: string | null;
  taskStatus: string;
  createdAt: string;
};

export type ProjectAssetCatalog = {
  assets: ProjectMediaAsset[];
  characters: NovelCharacterRecord[];
  locations: NovelLocationRecord[];
  props: ProductionPropRecord[];
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
