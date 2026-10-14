import { describe, expect, it } from "vitest";
import { storyboardSourceFingerprint, storyboardSourceFingerprintForPanel, storyboardSourceFingerprintForPanelLegacy, storyboardSourceRevisionMatches } from "./storyboard-source-revision";
import { fingerprintMediaTargetSource, fingerprintStoryboardPanelSource } from "./target-source-revision";

const source = {
  clipId: "clip-1",
  clipContent: "A person enters.",
  screenplay: "{\"scene\":1}",
  description: "The door opens.",
  videoPrompt: "A person walks in.",
  voiceoverText: null,
  lipSyncText: null,
  voiceLines: [{ speaker: "A", content: "Hello", delivery: "dialogue" }],
};

describe("storyboard source revision fingerprint", () => {
  it("is stable for identical inputs", () => {
    expect(storyboardSourceFingerprint(source)).toBe(
      storyboardSourceFingerprint({ ...source, voiceLines: [...source.voiceLines] }),
    );
  });

  it("changes when screenplay, panel prompt, or confirmed speech changes", () => {
    const original = storyboardSourceFingerprint(source);
    expect(storyboardSourceFingerprint({ ...source, screenplay: "{\"scene\":2}" })).not.toBe(original);
    expect(storyboardSourceFingerprint({ ...source, videoPrompt: "A person runs in." })).not.toBe(original);
    expect(storyboardSourceFingerprint({ ...source, voiceLines: [{ ...source.voiceLines[0], content: "Goodbye" }] })).not.toBe(original);
  });

  it("scopes new panel revisions to their own source, prompt design, selected reference and request references", () => {
    const panel = {
      clipId: "clip-1", description: "Door opens", videoPrompt: "Walk in", voiceoverText: null, lipSyncText: null,
      imagePrompt: "Still frame", imagePromptDesignJson: "{\"version\":1}", videoPromptDesignJson: null,
      firstLastFramePromptDesignJson: null, firstLastFramePrompt: null, startStateJson: null, endStateJson: null,
      motionBeatsJson: null, worldContextJson: null, imageAssetId: "reference-a", videoAssetId: null,
      clip: { content: "A person enters", screenplay: "scene one" },
      voiceLines: [], storyboard: { episode: { novelText: "Original chapter", activeSourceId: "source-1" } },
    };
    const request = { referenceImages: [{ assetId: "reference-a", storageKey: "projects/p/a.png", url: "https://media.test/a.png", mimeType: "image/png" }] };
    const original = storyboardSourceFingerprintForPanel(panel, request);
    expect(storyboardSourceFingerprintForPanel({ ...panel, storyboard: { episode: { novelText: "Revised chapter", activeSourceId: "source-2" } } }, request)).toBe(original);
    expect(storyboardSourceFingerprintForPanelLegacy({ ...panel, storyboard: { episode: { novelText: "Revised chapter", activeSourceId: "source-1" } } }, request)).not.toBe(
      storyboardSourceFingerprintForPanelLegacy(panel, request),
    );
    expect(storyboardSourceFingerprintForPanel({ ...panel, clip: { ...panel.clip, screenplay: "scene two" } }, request)).not.toBe(original);
    expect(storyboardSourceFingerprintForPanel({ ...panel, imagePromptDesignJson: "{\"version\":2}" }, request)).not.toBe(original);
    expect(storyboardSourceFingerprintForPanel(panel, { referenceImages: [{ ...request.referenceImages[0], assetId: "reference-b" }] })).not.toBe(original);
  });

  it("marks only panels using a changed character, location or prop profile", () => {
    const panel = {
      clipId: "clip-1", description: "Door opens", videoPrompt: "Walk in", voiceoverText: null, lipSyncText: null,
      imagePrompt: "Still frame", imagePromptDesignJson: null, videoPromptDesignJson: null,
      firstLastFramePromptDesignJson: null, firstLastFramePrompt: null, startStateJson: null, endStateJson: null,
      motionBeatsJson: null, worldContextJson: null, imageAssetId: "reference-a", videoAssetId: null,
      charactersJson: '["A"]', propsJson: '["Key"]', locationName: "Hall",
      clip: { content: "A person enters", screenplay: "scene one" }, voiceLines: [],
      storyboard: { episode: { novelText: "episode wide source", activeSourceId: "source-1" } },
    };
    const assets = { characters: [{ name: "A", visualProfileJson: "red coat", selectedAppearance: "look-1" }],
      locations: [{ name: "Hall", visualProfileJson: "stone hall", selectedImageId: "location-image-1" }],
      props: [{ name: "Key", visualProfileJson: "brass key" }] };
    const fingerprint = fingerprintStoryboardPanelSource(panel, assets, {});
    expect(fingerprintStoryboardPanelSource(panel, { ...assets, characters: [{ ...assets.characters[0], visualProfileJson: "blue coat" }] }, {})).not.toBe(fingerprint);
    expect(fingerprintStoryboardPanelSource({ ...panel, charactersJson: '["B"]' }, assets, {})).not.toBe(fingerprint);
    expect(fingerprintStoryboardPanelSource({ ...panel, storyboard: { episode: { novelText: "unrelated global source edit", activeSourceId: "source-2" } } }, assets, {})).toBe(fingerprint);
  });

  it("marks changed sources, published settings and newer executions stale", () => {
    expect(storyboardSourceRevisionMatches({ expected: "old", current: "new" })).toEqual({ stale: true, fields: ["source.screenplay_prompt_or_references"] });
    expect(storyboardSourceRevisionMatches({ expected: "same", current: "same", newerExecutionExists: true })).toEqual({ stale: true, fields: ["newer_execution"] });
    expect(storyboardSourceRevisionMatches({ expected: "same", current: "same", publishedConfigurationChanged: true })).toEqual({ stale: true, fields: ["production_configuration"] });
    expect(storyboardSourceRevisionMatches({ expected: "same", current: "same" })).toEqual({ stale: false, fields: [] });
  });
});

describe("media target source fingerprint", () => {
  it("detects editable target and reference changes without persisting reference URLs", () => {
    const request = { referenceImages: [{ assetId: "asset-1", url: "https://media.test/a.png", mimeType: "image/png" }] };
    const original = fingerprintMediaTargetSource({ description: "portrait", character: { visualProfile: "red coat" } }, request);
    expect(fingerprintMediaTargetSource({ description: "portrait", character: { visualProfile: "blue coat" } }, request)).not.toBe(original);
    expect(fingerprintMediaTargetSource({ description: "portrait", character: { visualProfile: "red coat" } }, { ...request, referenceImages: [{ ...request.referenceImages[0], assetId: "asset-2" }] })).not.toBe(original);
  });
});
