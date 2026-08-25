import type { LucideIcon } from "lucide-react";
import type { AgentMessage } from "@/lib/agent/types";
import type {
  ChannelProtocol,
  ModelCapabilities,
} from "@/lib/agent/provider-types";

export type { ChannelProtocol, ModelCapabilities } from "@/lib/agent/provider-types";

export type AgentLocale = "en" | "zh-CN";

export type ModelOption = {
  id: string;
  name: string;
  modelId?: string;
  channelId?: string;
  channelName?: string;
  type?: "llm" | "image" | "video" | "audio" | "lipsync" | "voicedesign";
  capabilities?: ModelCapabilities;
  protocol?: ChannelProtocol;
};

export type RuntimeChannel = {
  channelId: string;
  channelName: string;
  protocol: ChannelProtocol;
  baseUrl: string;
  apiKey: string;
  apiKeys?: string[];
};

export type ChannelModelUpdate = RuntimeChannel & {
  models: ModelOption[];
};

export type RuntimeConnectionStatus = "idle" | "loading" | "success" | "error";

export type RuntimeConnectionSettings = {
  apiKey: string;
  baseUrl: string;
  protocol?: ChannelProtocol;
  status: RuntimeConnectionStatus;
  statusMessage?: string;
};

export type ShellUser = {
  id: string;
  name: string;
};

export type ShellNavItem = {
  id: string;
  href?: string;
  icon: LucideIcon;
  label: string;
};

export type ShellThread = {
  id: string;
  title: string;
  icon?: LucideIcon;
  archived?: boolean;
  messages?: AgentMessage[];
  pinned?: boolean;
  updatedAt?: string;
};
