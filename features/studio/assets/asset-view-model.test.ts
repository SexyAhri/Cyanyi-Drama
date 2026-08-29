import { describe, expect, it } from "vitest";

import type { MediaTask } from "@/lib/media/task-contract";
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
    expect(character.generationPrompt).toContain("角色名称：Lin");
  });

  it("does not render appearance placeholders after their media was deleted", () => {
    const catalog = createCatalog();
    catalog.assets = catalog.assets.filter(
      (asset) => asset.id !== "asset-character",
    );

    const [character] = buildStudioAssetEntities(
      catalog,
      "character",
      undefined,
      [createTask("succeeded", "appearance-1")],
    );

    expect(character.candidates).toEqual([]);
  });

  it.each(["queued", "running", "failed"] as const)(
    "keeps a %s generation placeholder until the task can be inspected",
    (status) => {
      const catalog = createCatalog();
      catalog.assets = catalog.assets.filter(
        (asset) => asset.id !== "asset-character",
      );

      const [character] = buildStudioAssetEntities(
        catalog,
        "character",
        undefined,
        [createTask(status, "appearance-1")],
      );

      expect(character.candidates).toEqual([
        expect.objectContaining({
          id: "appearance-1",
          assetId: null,
          url: null,
        }),
      ]);
    },
  );

  it("builds a character prompt from the selected appearance and full profile", () => {
    const catalog = createCatalog();
    catalog.characters[0].introduction = "A disciplined swordsman";
    catalog.characters[0].profile = {
      identity: "Sect leader",
      techniques: ["Moon Cut", "Cloud Step"],
      empty: null,
    };
    catalog.characters[0].appearances = [
      {
        ...catalog.characters[0].appearances[0],
        description: "Old blue robes",
        selected: false,
      },
      {
        ...catalog.characters[0].appearances[0],
        id: "appearance-2",
        appearanceIndex: 1,
        description: "Black ceremonial armor",
        selected: true,
      },
    ];

    const [character] = buildStudioAssetEntities(catalog, "character");

    expect(character.generationPrompt).toBe(
      [
        "角色名称：Lin",
        "视觉设定：Black ceremonial armor",
        "角色描述：A disciplined swordsman",
        "详细设定：",
        "identity：Sect leader",
        "techniques：Moon Cut；Cloud Step",
      ].join("\n"),
    );
    expect(character.generationPrompt).not.toContain("Old blue robes");
  });

  it("compiles a persisted visual profile ahead of story metadata", () => {
    const catalog = createCatalog();
    catalog.characters[0].appearances[0].description =
      "Legacy prompt with a modern business suit";
    catalog.characters[0].visualProfile = {
      version: 1,
      source: "model",
      updatedAt: "2026-01-01T00:00:00.000Z",
      spec: {
        visualIdentity: "Silver-haired swordsman",
        shapeAndStructure: "Tall and lean",
        surfaceAndStyling: "Layered black silk robes",
        colorPalette: "Black, gray, silver",
        lightingAndPresentation: "Neutral studio turnaround",
        signatureDetails: ["Silver crescent clasp"],
        consistencyRules: ["Keep the clasp", "Keep the angular face"],
        negativePrompt: "no modern clothing",
        inferenceNotes: ["Clasp design was inferred"],
      },
    };

    const [character] = buildStudioAssetEntities(catalog, "character");

    expect(character.visualProfile?.spec.visualIdentity).toBe(
      "Silver-haired swordsman",
    );
    expect(character.generationPrompt).toContain("已锁定视觉设定：");
    expect(character.generationPrompt).toContain(
      "一致性规则：Keep the clasp；Keep the angular face",
    );
    expect(character.generationPrompt).not.toContain("modern business suit");
  });

  it("places the selected project art style ahead of asset details", () => {
    const [character] = buildStudioAssetEntities(
      createCatalog(),
      "character",
      "chinese-ink",
    );

    expect(character.generationPrompt).toContain(
      "项目统一画风（最高优先级）：中国水墨动画风格",
    );
    expect(character.generationPrompt.indexOf("项目统一画风")).toBeLessThan(
      character.generationPrompt.indexOf("角色名称"),
    );
  });

  it("builds prompts for locations and props from their existing records", () => {
    const catalog = createCatalog();
    catalog.locations = [
      {
        id: "location-1",
        projectId: "project-1",
        name: "Sky Hall",
        summary: "A vast ceremonial hall above the clouds",
        selectedImageId: "location-image-2",
        images: [
          {
            id: "location-image-1",
            locationId: "location-1",
            imageIndex: 0,
            description: "Daylight version",
            availableSlots: [],
            imageAssetId: null,
            selected: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "location-image-2",
            locationId: "location-1",
            imageIndex: 1,
            description: "Night version with silver lanterns",
            availableSlots: [],
            imageAssetId: null,
            selected: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    catalog.props[0].summary = "A bronze key with a cracked jade inset";
    catalog.props[0].metadata = { material: "bronze", worn: true };

    const [location] = buildStudioAssetEntities(catalog, "location");
    const [prop] = buildStudioAssetEntities(catalog, "prop");

    expect(location.generationPrompt).toContain(
      "视觉设定：Night version with silver lanterns",
    );
    expect(location.generationPrompt).toContain(
      "场景描述：A vast ceremonial hall above the clouds",
    );
    expect(prop.generationPrompt).toContain(
      "道具描述：A bronze key with a cracked jade inset",
    );
    expect(prop.generationPrompt).toContain("material：bronze");
    expect(prop.generationPrompt).toContain("worn：true");
  });

  it("does not render empty location image records as media candidates", () => {
    const catalog = createCatalog();
    catalog.locations = [
      {
        id: "location-1",
        projectId: "project-1",
        name: "Sky Hall",
        summary: null,
        selectedImageId: "location-image-1",
        images: [
          {
            id: "location-image-1",
            locationId: "location-1",
            imageIndex: 0,
            description: "Deleted baseline",
            availableSlots: [],
            imageAssetId: null,
            selected: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const [location] = buildStudioAssetEntities(catalog, "location");

    expect(location.candidates).toEqual([]);
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

function createTask(status: MediaTask["status"], targetId: string) {
  return {
    id: `task-${status}`,
    traceId: `trace-${status}`,
    spanId: `span-${status}`,
    projectId: "project-1",
    targetType: "character_appearance",
    targetId,
    status,
    kind: "image",
    provider: "test",
    protocol: "openai-compatible",
    model: "image-model",
    request: {},
    retryCount: 0,
    maxRetries: 2,
    progress: status === "running" ? 1 : 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as MediaTask;
}
