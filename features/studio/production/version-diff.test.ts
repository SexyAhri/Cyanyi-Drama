import { describe, expect, it } from "vitest";

import { compareVersionPayloads } from "./version-diff";

describe("production version payload comparison", () => {
  it("reports changed, added, and removed nested fields deterministically", () => {
    expect(compareVersionPayloads(
      { script: { title: "Old", notes: "Keep" }, sources: ["a"] },
      { script: { title: "New", summary: "Added" }, sources: ["a", "b"] },
    )).toEqual([
      { path: "script.notes", before: "Keep", after: undefined },
      { path: "script.summary", before: undefined, after: "Added" },
      { path: "script.title", before: "Old", after: "New" },
      { path: "sources", before: ["a"], after: ["a", "b"] },
    ]);
  });

  it("does not report object key ordering as a version change", () => {
    expect(compareVersionPayloads({ a: 1, b: { c: true } }, { b: { c: true }, a: 1 })).toEqual([]);
  });
});
