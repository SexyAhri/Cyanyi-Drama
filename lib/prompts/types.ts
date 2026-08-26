import type { PromptId } from "./ids";

export type PromptLocale = "zh" | "en";

export type AgentContextScope = "project" | "episode" | "clip";

export type AgentContract = {
  id: string;
  responsibility: string;
  prohibited: readonly string[];
  successCriteria: readonly string[];
  tools: readonly string[];
  contextPolicy: {
    scope: AgentContextScope;
    trust: "untrusted";
  };
  evidencePolicy: {
    required: boolean;
    mode: "source_quotes" | "input_references";
  };
  qualityGates: readonly string[];
  retryPolicy: {
    maxSemanticCorrections: number;
    mode: "targeted";
  };
  stopRules: readonly string[];
};

export type AgentIdentity = AgentContract;

export type PromptCatalogEntry = {
  pathStem: string;
  version: number;
  variables: readonly string[];
  agent: AgentContract;
};

export type RenderedPrompt = {
  id: PromptId;
  agentId: string;
  maxSemanticCorrections: number;
  locale: PromptLocale;
  version: number;
  templateHash: string;
  systemHash: string;
  versionHash: string;
  systemText: string;
  text: string;
};
