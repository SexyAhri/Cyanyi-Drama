import { describe, expect, it } from "vitest";
import { completionArtifactTypes } from "./runtime";

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
