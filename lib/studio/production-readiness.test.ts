import { describe, expect, it } from "vitest";
import { hasAdoptedPanelVideo } from "./production-readiness";

describe("adopted panel video readiness", () => {
  it("does not count a partially adopted sequence as ready", () => {
    expect(hasAdoptedPanelVideo({ videoAssetId: "first", lipSyncAssetId: null,
      videoSegments: [{ videoAssetId: "first" }, { videoAssetId: null }] })).toBe(false);
  });
  it("counts a complete segmented sequence", () => {
    expect(hasAdoptedPanelVideo({ videoAssetId: null, lipSyncAssetId: null,
      videoSegments: [{ videoAssetId: "first" }, { videoAssetId: "second" }] })).toBe(true);
  });
  it("counts a lip-synced final clip without segments", () => {
    expect(hasAdoptedPanelVideo({ videoAssetId: null, lipSyncAssetId: "synced", videoSegments: [] })).toBe(true);
  });
});
