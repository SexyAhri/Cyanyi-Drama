import type { ConfigurationScope } from "@/lib/production-configuration/contract";

export type ProductionScopeLevel = "user" | "project" | "episode" | "panel";

export function resolveProductionScopeLevel(requested: string | null, available: ConfigurationScope): ProductionScopeLevel {
  if (requested === "user") return "user";
  if (requested === "project" && available.projectId) return "project";
  if (requested === "episode" && available.projectId && available.episodeId) return "episode";
  if (requested === "panel" && available.projectId && available.episodeId && available.panelId) return "panel";
  return available.projectId ? "project" : "user";
}
