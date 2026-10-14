export const STUDIO_AGENT_CONTEXT_SCOPE_OPTIONS = [
  "project_materials",
  "current_episode",
  "character_assets",
  "selected_shot",
] as const;

export type StudioAgentContextScope =
  (typeof STUDIO_AGENT_CONTEXT_SCOPE_OPTIONS)[number];

export const DEFAULT_STUDIO_AGENT_CONTEXT_SCOPES =
  STUDIO_AGENT_CONTEXT_SCOPE_OPTIONS;

type AgentContextState<TProjectContext> = {
  projectContext: TProjectContext;
  asset: unknown;
  canvas: unknown;
  clips: unknown[];
  context: { selection?: unknown; episodeId?: string };
  episode?: unknown;
  tasks: Array<{ episodeId?: string | null }>;
  workflows: Array<{ episodeId?: string | null; targetId?: string | null }>;
  contextScopes?: readonly StudioAgentContextScope[];
};

type ProjectContextShape = {
  assets: unknown[];
  deliverables: unknown[];
  episodeIndex: unknown[];
  episodes: unknown[];
  manuscripts: unknown[];
  media: unknown[];
  objectIndex: unknown[];
  originalPlans: unknown[];
  voicePresets: unknown[];
  [key: string]: unknown;
};

export function applyStudioAgentContextScopes<
  TContext extends ProjectContextShape,
  TState extends AgentContextState<TContext>,
>(state: TState, scopes: readonly StudioAgentContextScope[]): TState {
  const enabled = new Set(scopes);
  const projectContext = { ...state.projectContext };
  const currentEpisodeId = state.context.episodeId;
  let asset = state.asset;
  let canvas = state.canvas;
  let context = state.context;
  let episode = state.episode;
  let clips = state.clips;
  let tasks = state.tasks;
  let workflows = state.workflows;
  const hasEpisode = enabled.has("current_episode");
  const hasMaterials = enabled.has("project_materials");
  const hasAssets = enabled.has("character_assets");
  const hasSelectedShot = enabled.has("selected_shot");

  if (!hasMaterials) {
    projectContext.manuscripts = [];
    projectContext.deliverables = [];
    projectContext.originalPlans = [];
    projectContext.objectIndex = projectContext.objectIndex.filter(
      (item) =>
        !isRecord(item) ||
        !["deliverable", "manuscript", "source_version"].includes(String(item.kind)),
    );
  }
  if (!hasEpisode) {
    projectContext.episodeIndex = [];
    projectContext.episodes = [];
  } else if (currentEpisodeId) {
    projectContext.episodeIndex = projectContext.episodeIndex.filter(
      (item) => isRecord(item) && item.id === currentEpisodeId,
    );
    projectContext.episodes = projectContext.episodes.filter(
      (item) => isRecord(item) && item.id === currentEpisodeId,
    );
  } else {
    projectContext.episodes = [];
  }
  if (!hasAssets) {
    projectContext.assets = [];
    projectContext.voicePresets = [];
    projectContext.media = [];
    projectContext.objectIndex = projectContext.objectIndex.filter(
      (item) =>
        !isRecord(item) ||
        !["character", "location", "prop", "media", "voice_line"].includes(String(item.kind)),
    );
    asset = null;
  } else if (hasEpisode && currentEpisodeId) {
    projectContext.media = projectContext.media.filter(
      (item) =>
        isRecord(item) &&
        isRecord(item.task) &&
        item.task.episodeId === currentEpisodeId,
    );
  } else {
    projectContext.media = [];
  }
  if (!hasSelectedShot) {
    context = { ...state.context, selection: undefined };
    canvas = null;
    projectContext.objectIndex = projectContext.objectIndex.filter(
      (item) => !isRecord(item) || !["shot", "canvas_node"].includes(String(item.kind)),
    );
    projectContext.episodes = projectContext.episodes.map((item) => {
      if (!isRecord(item)) return item;
      const storyboard = isRecord(item.storyboard)
        ? { ...item.storyboard, panels: [] }
        : item.storyboard;
      return { ...item, storyboard, canvas: null };
    });
  }
  if (!hasEpisode)
    projectContext.objectIndex = [];

  if (!hasEpisode) {
    episode = undefined;
    clips = [];
    tasks = [];
    workflows = [];
  } else if (currentEpisodeId) {
    tasks = state.tasks.filter((item) => item.episodeId === currentEpisodeId);
    workflows = state.workflows.filter(
      (item) => item.episodeId === currentEpisodeId || item.targetId === currentEpisodeId,
    );
  }

  return {
    ...state,
    projectContext,
    contextScopes: scopes,
    asset,
    canvas,
    context,
    episode,
    clips,
    tasks,
    workflows,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
