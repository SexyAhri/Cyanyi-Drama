import type { MediaTask } from "@/lib/media/task-contract";
import type {
  NovelCharacterRecord,
  NovelLocationRecord,
  StoryboardPanelRecord,
  StoryboardRecord,
} from "@/lib/novel/domain-types";
import type { StoryboardContinuityIssue } from "@/lib/novel/continuity-store";
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
  audioTracks: EpisodeAudioTrackRecord[];
  clips: ProductionClipRecord[];
  editorProject: EditorProjectRecord | null;
  props: ProductionPropRecord[];
  voiceLines: VoiceLineRecord[];
};

export type VoicePresetRecord = {
  id: string;
  userId: string;
  projectId: string | null;
  name: string;
  providerVoiceId: string | null;
  language: string | null;
  gender: string | null;
  description: string | null;
  sampleAssetId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VoiceLineRecord = {
  id: string;
  episodeId: string;
  lineIndex: number;
  speaker: string;
  content: string;
  voicePresetId: string | null;
  audioAssetId: string | null;
  emotionPrompt: string | null;
  emotionStrength: number | null;
  matchedPanelId: string | null;
  durationSeconds: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type EpisodeAudioTrackRecord = {
  id: string;
  episodeId: string;
  trackType: string;
  assetId: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  volume: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type EditorTimelineTrack = {
  id: string;
  clipId: string | null;
  shotIndex: number;
  start: number;
  end: number;
  duration: number;
  type: "image" | "video";
  imageAssetId: string | null;
  videoAssetId: string | null;
  lipSyncAssetId: string | null;
};

export type EditorTimeline = {
  version: number;
  duration: number;
  tracks: EditorTimelineTrack[];
};

export type EditorSubtitle = {
  id: string;
  index: number;
  start: number;
  end: number;
  speaker: string;
  text: string;
};

export type EditorProjectRecord = {
  id: string;
  episodeId: string;
  timeline: EditorTimeline;
  subtitles: EditorSubtitle[] | null;
  renderStatus: string;
  renderTaskId: string | null;
  outputAssetId: string | null;
  createdAt: string;
  updatedAt: string;
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

export type StudioStoryboardPanel = StoryboardPanelRecord;

export type StudioStoryboardData = {
  storyboard: StoryboardRecord | null;
  continuityIssues: StoryboardContinuityIssue[];
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
