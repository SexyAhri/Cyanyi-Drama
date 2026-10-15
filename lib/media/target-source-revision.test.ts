import { beforeEach, describe, expect, it, vi } from "vitest";

const { findCharacterAppearance, panelFindFirst, characterFindMany, locationFindMany, propFindMany, assetReferenceFindMany, canvasFindFirst, locationFindFirst, owned } = vi.hoisted(() => ({
  findCharacterAppearance: vi.fn(), panelFindFirst: vi.fn(), characterFindMany: vi.fn(), locationFindMany: vi.fn(), propFindMany: vi.fn(), assetReferenceFindMany: vi.fn(),
  canvasFindFirst: vi.fn(), locationFindFirst: vi.fn(), owned: vi.fn(),
}));
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    characterAppearance: { findFirst: findCharacterAppearance },
    storyboardPanel: { findFirst: panelFindFirst },
    novelCharacter: { findMany: characterFindMany },
    novelLocation: { findMany: locationFindMany, findFirst: locationFindFirst },
    creativeCanvas: { findFirst: canvasFindFirst },
    novelProp: { findMany: propFindMany },
    assetReference: { findMany: assetReferenceFindMany },
  },
}));
vi.mock("@/lib/assets/project-store", () => ({ listOwnedProjectMediaAssets: owned }));

import { captureMediaTargetSourceRevision } from "./target-source-revision";

beforeEach(() => vi.clearAllMocks());

describe("media target source revisions", () => {
  it("ignores layout and unrelated edits but detects real canvas prompt and reference changes", async () => {
    const document = {
      nodes: [
        { id: "image", kind: "image", text: "Two people", title: "Title", x: 0, y: 0 },
        { id: "ref", kind: "location", entityId: "location", text: "Unused text", title: "Location", x: 1, y: 0 },
        { id: "other", kind: "text", text: "Unrelated", title: "Other", x: 2, y: 0 },
      ], edges: [{ id: "edge", from: "ref", to: "image", purpose: "reference" }], viewport: { x: 0, y: 0, k: 1 },
    };
    canvasFindFirst.mockResolvedValue({ revision: 1, document });
    locationFindFirst.mockResolvedValue({ selectedImageId: "a", images: [{ id: "a", imageAssetId: "asset-a" }] });
    owned.mockImplementation(async (_user, _project, ids: string[]) => ids.map(id => ({ id, url: `https://storage.test/${id}` })));
    const input = { userId: "owner", projectId: "project", episodeId: "episode", targetType: "canvas_node", targetId: "image", request: { format: "png" } };
    const before = await captureMediaTargetSourceRevision(input);
    expect(before?.revisionVersion).toBe(3);
    document.viewport = { x: 300, y: 800, k: 2 }; document.nodes[0].x = 400; document.nodes[0].title = "Renamed"; document.nodes[2].text = "Edited unrelated";
    canvasFindFirst.mockResolvedValue({ revision: 99, document });
    expect((await captureMediaTargetSourceRevision(input))?.fingerprint).toBe(before?.fingerprint);
    document.nodes[0].text = "Three people";
    expect((await captureMediaTargetSourceRevision(input))?.fingerprint).not.toBe(before?.fingerprint);
    document.nodes[0].text = "Two people";
    locationFindFirst.mockResolvedValue({ selectedImageId: "b", images: [{ id: "b", imageAssetId: "asset-b" }] });
    expect((await captureMediaTargetSourceRevision(input))?.fingerprint).not.toBe(before?.fingerprint);
    Object.assign(document.nodes[1], { assetId: "asset-a" });
    expect((await captureMediaTargetSourceRevision(input))?.fingerprint).toBe(before?.fingerprint);
    locationFindFirst.mockResolvedValue({ selectedImageId: "c", images: [{ id: "c", imageAssetId: "asset-c" }] });
    expect((await captureMediaTargetSourceRevision(input))?.fingerprint).toBe(before?.fingerprint);
    document.edges = [];
    expect((await captureMediaTargetSourceRevision(input))?.fingerprint).not.toBe(before?.fingerprint);
  });
  it("captures owned editable source data and changes when it is edited", async () => {
    const input = {
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      targetType: "character_appearance",
      targetId: "appearance-1",
      request: { referenceImages: [{ assetId: "reference-1", url: "https://cdn.test/private?signature=secret" }] },
    };
    findCharacterAppearance.mockResolvedValueOnce({
      description: "Red coat", metadataJson: null, selected: true, imageAssetId: "image-1",
      character: { name: "A", profileJson: "{}", visualProfileJson: "red coat", appearances: [{ id: "appearance-1", selected: true, imageAssetId: "image-1" }] },
    }).mockResolvedValueOnce({
      description: "Blue coat", metadataJson: null, selected: true, imageAssetId: "image-1",
      character: { name: "A", profileJson: "{}", visualProfileJson: "blue coat", appearances: [{ id: "appearance-1", selected: true, imageAssetId: "image-1" }] },
    });

    const original = await captureMediaTargetSourceRevision(input);
    const edited = await captureMediaTargetSourceRevision(input);

    expect(original?.fingerprint).not.toBe(edited?.fingerprint);
    expect(findCharacterAppearance).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "appearance-1", character: { projectId: "project-1", project: { userId: "user-1" } } },
    }));
    expect(JSON.stringify(original)).not.toContain("secret");
  });

  it("uses clip-scoped v2 snapshots and follows only the panel's selected asset references", async () => {
    const panel = {
      clipId: "clip-1", description: "Door", videoPrompt: "Enter", voiceoverText: null, lipSyncText: null,
      imagePrompt: "Frame", imagePromptDesignJson: null, videoPromptDesignJson: null,
      firstLastFramePromptDesignJson: null, firstLastFramePrompt: null, startStateJson: null, endStateJson: null,
      motionBeatsJson: null, worldContextJson: null, imageAssetId: null, videoAssetId: null,
      charactersJson: '["A"]', propsJson: '["Key"]', locationName: "Hall",
      clip: { content: "A enters", screenplay: "scene" }, voiceLines: [],
      storyboard: { projectId: "project-1", episode: { novelText: "old episode", activeSourceId: "source-1" } },
    };
    panelFindFirst.mockResolvedValue(panel);
    characterFindMany.mockResolvedValue([{ name: "A", profileJson: "{}", visualProfileJson: "red coat", appearances: [] }]);
    locationFindMany.mockResolvedValue([{ name: "Hall", summary: "Stone", visualProfileJson: "hall", selectedImageId: null, selectedImage: null }]);
    propFindMany.mockResolvedValue([{ id: "prop-1", name: "Key", summary: "Old key", visualProfileJson: "brass", metadataJson: null }]);
    assetReferenceFindMany.mockResolvedValue([{ entityId: "prop-1", mediaAssetId: "prop-image-1", mediaAsset: { storageKey: "projects/p/key.png", mimeType: "image/png" } }]);
    const input = { userId: "user-1", projectId: "project-1", episodeId: "episode-1", targetType: "storyboard_panel", targetId: "panel-1", request: {} };
    const scoped = await captureMediaTargetSourceRevision(input);

    panelFindFirst.mockResolvedValue({ ...panel, storyboard: { projectId: "project-1", episode: { novelText: "edited unrelated episode text", activeSourceId: "source-2" } } });
    const sameScoped = await captureMediaTargetSourceRevision(input);
    expect(scoped?.revisionVersion).toBe(2);
    expect(scoped?.fingerprint).toBe(sameScoped?.fingerprint);

    characterFindMany.mockResolvedValue([{ name: "A", profileJson: "{}", visualProfileJson: "blue coat", appearances: [] }]);
    const changedProfile = await captureMediaTargetSourceRevision(input);
    expect(changedProfile?.fingerprint).not.toBe(scoped?.fingerprint);

    panelFindFirst.mockResolvedValue(panel);
    const legacyBefore = await captureMediaTargetSourceRevision({ ...input, revisionVersion: 1 });
    panelFindFirst.mockResolvedValue({ ...panel, storyboard: { projectId: "project-1", episode: { novelText: "edited unrelated episode text", activeSourceId: "source-2" } } });
    const legacyAfter = await captureMediaTargetSourceRevision({ ...input, revisionVersion: 1 });
    expect(legacyBefore?.fingerprint).not.toBe(legacyAfter?.fingerprint);
  });
});
