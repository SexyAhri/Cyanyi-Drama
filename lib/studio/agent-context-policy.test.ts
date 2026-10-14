import { describe, expect, it } from "vitest";
import { applyStudioAgentContextScopes } from "./agent-context-policy";

const makeState = () => ({
  projectContext: {
    assets: [{ id: "character-1" }],
    deliverables: [{ id: "bible-1" }],
    episodeIndex: [{ id: "episode-1" }, { id: "episode-2" }],
    episodes: [
      {
        id: "episode-1",
        script: "Current episode script",
        storyboard: { panels: [{ id: "shot-1" }] },
        canvas: { nodes: [{ id: "canvas-1" }] },
      },
      { id: "episode-2", script: "Other episode script" },
    ],
    manuscripts: [{ id: "manuscript-1" }],
    media: [{ task: { episodeId: "episode-1" } }, { task: { episodeId: "episode-2" } }],
    objectIndex: [{ id: "shot-1", kind: "shot" }, { id: "bible-1", kind: "deliverable" }],
    originalPlans: [{ id: "plan-1" }],
    voicePresets: [{ id: "voice-1" }],
  },
  asset: { id: "character-1" },
  canvas: { selectedNode: { id: "shot-1" } },
  clips: [{ id: "clip-1" }],
  context: { episodeId: "episode-1", selection: { id: "shot-1" } },
  episode: { id: "episode-1" },
  tasks: [{ episodeId: "episode-1" }, { episodeId: "episode-2" }],
  workflows: [{ episodeId: "episode-1" }, { episodeId: "episode-2" }],
});

describe("studio Agent context scopes", () => {
  it("limits materials, episode, assets, selected shot and execution context on the server", () => {
    const state = applyStudioAgentContextScopes(makeState(), ["current_episode"]);
    expect(state.projectContext.manuscripts).toEqual([]);
    expect(state.projectContext.deliverables).toEqual([]);
    expect(state.projectContext.originalPlans).toEqual([]);
    expect(state.projectContext.episodeIndex).toEqual([{ id: "episode-1" }]);
    expect(state.projectContext.episodes).toEqual([
      {
        id: "episode-1",
        script: "Current episode script",
        storyboard: { panels: [] },
        canvas: null,
      },
    ]);
    expect(state.projectContext.assets).toEqual([]);
    expect(state.projectContext.voicePresets).toEqual([]);
    expect(state.projectContext.media).toEqual([]);
    expect(state.projectContext.objectIndex).toEqual([]);
    expect(state.asset).toBeNull();
    expect(state.canvas).toBeNull();
    expect(state.context.selection).toBeUndefined();
    expect(state.tasks).toEqual([{ episodeId: "episode-1" }]);
    expect(state.workflows).toEqual([{ episodeId: "episode-1" }]);
  });

  it("supports an explicit empty scope and does not mutate other contexts", () => {
    const original = makeState();
    const state = applyStudioAgentContextScopes(original, []);
    expect(state.projectContext.episodes).toEqual([]);
    expect(state.projectContext.assets).toEqual([]);
    expect(state.tasks).toEqual([]);
    expect(original.projectContext.episodes).toHaveLength(2);
  });
});
