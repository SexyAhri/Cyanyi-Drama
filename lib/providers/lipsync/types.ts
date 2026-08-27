export type LipSyncProviderInput = {
  baseUrl: string;
  apiKey: string;
  model: string;
  videoUrl: string;
  audioUrl: string;
};

export type LipSyncProviderResult = {
  url: string;
  providerTaskId: string;
};

export type LipSyncProviderAdapter = {
  generate(input: LipSyncProviderInput): Promise<LipSyncProviderResult>;
};
