export type ShellSettings = {
  compactSidebar: boolean;
  analysisModel: string;
  characterModel: string;
  locationModel: string;
  storyboardModel: string;
  editModel: string;
  videoModel: string;
  audioModel: string;
  lipSyncModel: string;
  videoRatio: string;
  artStyle: string;
  ttsRate: string;
};

export function createDefaultShellSettings(modelId: string): ShellSettings {
  return {
    compactSidebar: false,
    analysisModel: modelId,
    characterModel: modelId,
    locationModel: modelId,
    storyboardModel: modelId,
    editModel: modelId,
    videoModel: modelId,
    audioModel: modelId,
    lipSyncModel: modelId,
    videoRatio: "9:16",
    artStyle: "american-comic",
    ttsRate: "+0%",
  };
}
