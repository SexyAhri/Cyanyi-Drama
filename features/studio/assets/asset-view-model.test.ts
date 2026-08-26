import { describe, expect, it } from "vitest";

import type { ProjectAssetCatalog } from "../types";
import {
  buildStudioAssetEntities,
  getProjectSourceAssets,
} from "./asset-view-model";

describe("studio asset view model", () => {
  it("maps selected character appearances to their owned media", () => {
    const catalog = createCatalog();
    const [character] = buildStudioAssetEntities(catalog, "character");

    expect(character.candidates).toEqual([
      expect.objectContaining({
        assetId: "asset-character",
        selected: true,
        url: "https://media.test/character.png",
      }),
    ]);
  });

  it("keeps prop candidates scoped to the target prop and selected role", () => {
    const catalog = createCatalog();
    const [prop] = buildStudioAssetEntities(catalog, "prop");

    expect(prop.candidates).toHaveLength(1);
    expect(prop.candidates[0]).toMatchObject({
      assetId: "asset-prop",
      selected: true,
    });
  });

  it("returns only project-level source assets", () => {
    const sources = getProjectSourceAssets(createCatalog(), "project-1");
    expect(sources.map((asset) => asset.id)).toEqual(["asset-source"]);
  });
});

function createCatalog(): ProjectAssetCatalog {
  return {
    characters: [
      {
        id: "character-1",
        projectId: "project-1",
        name: "Lin",
        aliases: [],
        profile: {},
        introduction: null,
        confirmed: false,
        appearances: [
          {
            id: "appearance-1",
            characterId: "character-1",
            appearanceIndex: 0,
            description: null,
            imageAssetId: "asset-character",
            selected: true,
            metadata: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    locations: [],
    props: [
      {
        id: "prop-1",
        projectId: "project-1",
        name: "Key",
        summary: null,
        metadata: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    assets: [
      createAsset("asset-character", "character_appearance", "appearance-1"),
      {
        ...createAsset("asset-prop", "prop", "prop-1"),
        references: [
          { entityType: "prop", entityId: "prop-1", role: "selected" },
        ],
      },
      createAsset("asset-other-prop", "prop", "prop-2"),
      createAsset("asset-source", "project", "project-1"),
    ],
  };
}

function createAsset(id: string, entityType: string, entityId: string) {
  return {
    id,
    kind: "image",
    url: `https://media.test/${id.replace("asset-", "")}.png`,
    mimeType: "image/png",
    metadata: {},
    references: [{ entityType, entityId, role: "uploaded_source" }],
    sourceTargetId: entityId,
    sourceTargetType: entityType,
    taskStatus: "succeeded",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}
