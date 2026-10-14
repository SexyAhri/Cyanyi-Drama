import { describe, expect, it } from "vitest";
import { classifyWorkflowFailureCode, completionArtifactTypes } from "./runtime";

describe("workflow completion artifacts", () => {
  it("keeps real chunk and merge counts without redundant summaries", () => {
    expect(completionArtifactTypes(["manuscript.chunk", "manuscript.merge", "manuscript.dossier", "prompt.trace"],
      [{ artifactType: "manuscript.chunk" }, { artifactType: "manuscript.merge" }, { artifactType: "manuscript.dossier" }, { artifactType: "prompt.trace" }], true)).toEqual([]);
  });
  it("never creates a fabricated token trace", () => {
    expect(completionArtifactTypes(["result", "prompt.trace"], [], false)).toEqual(["result"]);
  });
  it("retains declared summaries for steps without persisted artifacts", () => {
    expect(completionArtifactTypes(["result", "prompt.trace"], [], true)).toEqual(["result", "prompt.trace"]);
  });
});

describe("workflow failure classification", () => {
  it.each([
    ["STRUCTURED_PROVIDER_FAILED:429:rate limit", "PROVIDER_RATE_LIMIT"],
    ["STRUCTURED_PROVIDER_FAILED:401:unauthorized", "PROVIDER_AUTHENTICATION"],
    ["STRUCTURED_PROVIDER_FAILED:402:insufficient quota", "PROVIDER_QUOTA"],
    ["STRUCTURED_PROVIDER_FAILED:400:invalid parameter", "PROVIDER_INVALID_PARAMETERS"],
    ["content_policy_violation", "PROVIDER_CONTENT_REJECTED"],
    ["STRUCTURED_SCHEMA_INVALID:result", "OUTPUT_VALIDATION_FAILED"],
    ["STRUCTURED_PROVIDER_TRANSPORT_FAILED:reason=terminated", "PROVIDER_TRANSPORT_ERROR"],
  ] as const)("stores an actionable failure code for %s", (message, expected) => {
    expect(classifyWorkflowFailureCode(message)).toBe(expected);
  });
});
