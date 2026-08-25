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
  ttsRate: string;
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
};

export type EpisodeRecord = {
  id: string;
  projectId: string;
  episodeNumber: number;
  name: string;
  description: string | null;
  novelText: string | null;
  createdAt: string;
  updatedAt: string;
};
