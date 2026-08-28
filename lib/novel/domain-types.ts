export type NovelCharacterRecord = {
  id: string;
  projectId: string;
  name: string;
  aliases: string[];
  profile: Record<string, unknown>;
  introduction: string | null;
  confirmed: boolean;
  appearances: CharacterAppearanceRecord[];
  createdAt: string;
  updatedAt: string;
};

export type CharacterAppearanceRecord = {
  id: string;
  characterId: string;
  appearanceIndex: number;
  description: string | null;
  imageAssetId: string | null;
  selected: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type NovelLocationRecord = {
  id: string;
  projectId: string;
  name: string;
  summary: string | null;
  selectedImageId: string | null;
  images: LocationImageRecord[];
  createdAt: string;
  updatedAt: string;
};

export type LocationImageRecord = {
  id: string;
  locationId: string;
  imageIndex: number;
  description: string | null;
  availableSlots: string[];
  imageAssetId: string | null;
  selected: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StoryboardRecord = {
  id: string;
  projectId: string;
  episodeId: string;
  status: string;
  version: number;
  sourceHash: string | null;
  panels: StoryboardPanelRecord[];
  createdAt: string;
  updatedAt: string;
};

export type StoryboardPanelRecord = {
  id: string;
  storyboardId: string;
  clipId: string | null;
  clipPanelIndex: number | null;
  panelIndex: number;
  sceneNumber: number | null;
  shotType: string | null;
  cameraMove: string | null;
  description: string | null;
  locationName: string | null;
  characters: string[];
  props: string[];
  imagePrompt: string | null;
  videoPrompt: string | null;
  phase?: string;
  status?: string;
  srtStart?: number | null;
  srtEnd?: number | null;
  durationSeconds?: number | null;
  subtitleText?: string | null;
  speakingCharacter: string | null;
  lipSyncText: string | null;
  voiceoverText: string | null;
  startState: Record<string, unknown>;
  endState: Record<string, unknown>;
  motionBeats: Array<Record<string, unknown>>;
  worldContext: Record<string, unknown>;
  vfxCues: Array<Record<string, unknown>>;
  sfxCues: Array<Record<string, unknown>>;
  actingNotes?: Record<string, unknown>;
  photographyRules?: string | null;
  firstLastFramePrompt?: string | null;
  linkedToNextPanel?: boolean;
  sourceEvidence: string[];
  imageAssetId: string | null;
  videoAssetId: string | null;
  lipSyncAssetId: string | null;
  createdAt: string;
  updatedAt: string;
};
