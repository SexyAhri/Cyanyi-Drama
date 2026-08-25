import type { PromptId } from "./ids";

export type PromptLocale = "zh" | "en";

export type AgentIdentity = {
  id: string;
  responsibility: string;
  prohibited: readonly string[];
};

export type PromptCatalogEntry = {
  pathStem: string;
  version: number;
  variables: readonly string[];
  agent: AgentIdentity;
};

export type RenderedPrompt = {
  id: PromptId;
  locale: PromptLocale;
  version: number;
  templateHash: string;
  versionHash: string;
  text: string;
};
