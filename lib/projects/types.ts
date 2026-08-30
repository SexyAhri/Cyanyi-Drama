export type ProjectConfig = {
  analysisModel: string | null;
  characterModel: string | null;
  locationModel: string | null;
  storyboardModel: string | null;
  editModel: string | null;
  videoModel: string | null;
  audioModel: string | null;
  videoRatio: string;
  videoResolution: string;
  artStyle: string;
  visualEra: "source" | "premodern" | "contemporary" | "custom";
  visualEraCustom: string | null;
  ttsRate: string;
  episodeTargetDurationSeconds: number;
  workflowMode: string;
  globalAssetText: string | null;
  capabilityOverrides: Record<string, unknown>;
};

export type ProjectRecord = {
  id: string;
  name: string;
  description: string | null;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
  config: ProjectConfig;
  episodeCount: number;
  failedTaskCount: number;
  latestWorkflow: {
    episodeId: string | null;
    status: string;
    updatedAt: string;
    workflowType: string;
  } | null;
};

export type EpisodeRecord = {
  id: string;
  projectId: string;
  episodeNumber: number;
  name: string;
  description: string | null;
  novelText: string | null;
  activeSourceId: string | null;
  activeSourceKind: "original" | "adapted";
  createdAt: string;
  updatedAt: string;
};

export type ManuscriptRecord = {
  id: string;
  projectId: string;
  title: string;
  author: string | null;
  synopsis: string | null;
  sourceFileName: string | null;
  charCount: number;
  createdAt: string;
  updatedAt: string;
};

export type EpisodeSourceVersionRecord = {
  id: string;
  episodeId: string;
  manuscriptId: string | null;
  kind: "original" | "adapted";
  version: number;
  title: string | null;
  summary: string | null;
  content: string;
  adaptationMode: string | null;
  instructions: string | null;
  changeSummary: string[];
  promptTrace: Record<string, unknown> | null;
  productionPlan: Record<string, unknown> | null;
  productionPlanVersion: number | null;
  channelId: string | null;
  model: string | null;
  sourceHash: string;
  sourceStartIndex: number | null;
  sourceEndIndex: number | null;
  createdAt: string;
};
