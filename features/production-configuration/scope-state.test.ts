import { describe, expect, it } from "vitest";
import { resolveProductionScopeLevel } from "./scope-state";

describe("production configuration deep-link scope", () => {
  const available = { projectId: "project", episodeId: "episode", panelId: "panel" };

  it("restores a supported scope from the URL", () => {
    expect(resolveProductionScopeLevel("user", available)).toBe("user");
    expect(resolveProductionScopeLevel("episode", available)).toBe("episode");
    expect(resolveProductionScopeLevel("panel", available)).toBe("panel");
  });

  it("falls back to an available parent scope when a deep link target is missing", () => {
    expect(resolveProductionScopeLevel("panel", { projectId: "project" })).toBe("project");
    expect(resolveProductionScopeLevel("episode", {})).toBe("user");
    expect(resolveProductionScopeLevel("unknown", available)).toBe("project");
  });
});
