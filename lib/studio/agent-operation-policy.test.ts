import { describe, expect, it } from "vitest";
import {
  filterStudioAgentOperationCandidates,
  isStudioAgentOperationEnabled,
} from "./agent-operation-policy";

describe("published Studio Agent operation policy", () => {
  it("removes disabled operations from model-visible candidates", () => {
    const candidates = {
      read_project_object: [{ id: "source" }],
      retry_workflow: [{ id: "run" }],
    };
    const filtered = filterStudioAgentOperationCandidates(candidates, ["retry_workflow"]);
    expect(filtered).toEqual({ read_project_object: [{ id: "source" }], retry_workflow: [] });
    expect(candidates.retry_workflow).toHaveLength(1);
  });

  it("rejects a disabled model proposal and a stale approval at execution", () => {
    const disabled = ["retry_workflow"];
    expect(isStudioAgentOperationEnabled("retry_workflow", disabled)).toBe(false);
    expect(isStudioAgentOperationEnabled("cancel_workflow", disabled)).toBe(true);
    expect(isStudioAgentOperationEnabled("cancel_workflow")).toBe(true);
  });
});
