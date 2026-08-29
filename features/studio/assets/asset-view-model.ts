import type {
  ProjectAssetCatalog,
  ProjectMediaAsset,
} from "../types";
import type { MediaTask } from "@/lib/media/task-contract";
import {
  compileAssetVisualProfile,
  parseAssetVisualProfile,
  type AssetVisualProfile,
} from "@/lib/assets/visual-profile";
import { getProjectArtStyleDirective } from "@/lib/projects/art-style";

export type StudioAssetKind = "character" | "location" | "prop";

export type StudioAssetCandidate = {
  id: string;
  assetId: string | null;
  createdAt: string;
  description: string | null;
  selected: boolean;
  url: string | null;
};

export type StudioAssetEntity = {
  id: string;
  description: string | null;
  generationPrompt: string;
  kind: StudioAssetKind;
  name: string;
  visualProfile?: AssetVisualProfile;
  candidates: StudioAssetCandidate[];
};

export function buildStudioAssetEntities(
  catalog: ProjectAssetCatalog,
  kind: StudioAssetKind,
  artStyle?: string,
  tasks: MediaTask[] = [],
): StudioAssetEntity[] {
  const assetsById = new Map(catalog.assets.map((asset) => [asset.id, asset]));
  const placeholderTargetIds = new Set(
    tasks
      .filter(
        (task) =>
          task.kind === "image" &&
          ["queued", "running", "failed", "canceled"].includes(task.status) &&
          task.targetId,
      )
      .map((task) => task.targetId as string),
  );
  if (kind === "character") {
    return catalog.characters.map((character) => {
      const visualProfile = parseAssetVisualProfile(character.visualProfile);
      const appearanceDescription = preferredDescription(
        character.appearances,
      );
      return {
        id: character.id,
        description: character.introduction,
        generationPrompt: buildGenerationPrompt({
          kind,
          name: character.name,
          description: character.introduction,
          visualDescription: appearanceDescription,
          visualProfile,
          details: character.profile,
          artStyle,
        }),
        kind,
        name: character.name,
        visualProfile,
        candidates: character.appearances.flatMap((appearance) => {
          const asset = appearance.imageAssetId
            ? assetsById.get(appearance.imageAssetId)
            : undefined;
          return asset || placeholderTargetIds.has(appearance.id)
            ? [
                toCandidate({
                  id: appearance.id,
                  asset,
                  assetId: asset ? appearance.imageAssetId : null,
                  createdAt: appearance.createdAt,
                  description: appearance.description,
                  selected: Boolean(asset && appearance.selected),
                }),
              ]
            : [];
        }),
      };
    });
  }
  if (kind === "location") {
    return catalog.locations.map((location) => {
      const visualProfile = parseAssetVisualProfile(location.visualProfile);
      const images = location.images.map((image) => ({
        ...image,
        selected: image.selected || location.selectedImageId === image.id,
      }));
      return {
        id: location.id,
        description: location.summary,
        generationPrompt: buildGenerationPrompt({
          kind,
          name: location.name,
          description: location.summary,
          visualDescription: preferredDescription(images),
          visualProfile,
          artStyle,
        }),
        kind,
        name: location.name,
        visualProfile,
        candidates: images.flatMap((image) => {
          const asset = image.imageAssetId
            ? assetsById.get(image.imageAssetId)
            : undefined;
          return asset || placeholderTargetIds.has(image.id)
            ? [
                toCandidate({
                  id: image.id,
                  asset,
                  assetId: asset ? image.imageAssetId : null,
                  createdAt: image.createdAt,
                  description: image.description,
                  selected: Boolean(asset && image.selected),
                }),
              ]
            : [];
        }),
      };
    });
  }
  return catalog.props.map((prop) => {
    const visualProfile = parseAssetVisualProfile(prop.visualProfile);
    return {
      id: prop.id,
      description: prop.summary,
      generationPrompt: buildGenerationPrompt({
        kind,
        name: prop.name,
        description: prop.summary,
        visualProfile,
        details: prop.metadata,
        artStyle,
      }),
      kind,
      name: prop.name,
      visualProfile,
      candidates: catalog.assets
      .filter((asset) =>
        asset.references.some(
          (reference) =>
            reference.entityType === "prop" && reference.entityId === prop.id,
        ),
      )
      .map((asset) => ({
        id: asset.id,
        assetId: asset.id,
        createdAt: asset.createdAt,
        description: null,
        selected: asset.references.some(
          (reference) =>
            reference.entityType === "prop" &&
            reference.entityId === prop.id &&
            reference.role === "selected",
        ),
        url: asset.url,
      })),
    };
  });
}

export function getProjectSourceAssets(
  catalog: ProjectAssetCatalog,
  projectId: string,
) {
  return catalog.assets.filter((asset) =>
    asset.references.some(
      (reference) =>
        reference.entityType === "project" &&
        reference.entityId === projectId,
    ),
  );
}

function toCandidate(input: {
  id: string;
  asset?: ProjectMediaAsset;
  assetId: string | null;
  createdAt: string;
  description: string | null;
  selected: boolean;
}): StudioAssetCandidate {
  return {
    id: input.id,
    assetId: input.assetId,
    createdAt: input.asset?.createdAt ?? input.createdAt,
    description: input.description,
    selected: input.selected,
    url: input.asset?.url ?? null,
  };
}

function preferredDescription(
  items: Array<{ description: string | null; selected: boolean }>,
) {
  return (
    items.find((item) => item.selected && item.description?.trim())
      ?.description ?? items.find((item) => item.description?.trim())?.description
  );
}

function buildGenerationPrompt(input: {
  artStyle?: string;
  kind: StudioAssetKind;
  name: string;
  description?: string | null;
  visualDescription?: string | null;
  visualProfile?: AssetVisualProfile;
  details?: Record<string, unknown>;
}) {
  const kindLabel =
    input.kind === "character"
      ? "角色"
      : input.kind === "location"
        ? "场景"
        : "道具";
  const lines = input.artStyle
    ? [
        getProjectArtStyleDirective(input.artStyle, "zh"),
        `${kindLabel}名称：${input.name.trim()}`,
      ]
    : [`${kindLabel}名称：${input.name.trim()}`];
  const profile = compileAssetVisualProfile(input.visualProfile);
  if (profile) lines.push("已锁定视觉设定：", profile);
  if (!input.visualProfile && input.visualDescription?.trim())
    lines.push(`视觉设定：${input.visualDescription.trim()}`);
  if (input.description?.trim())
    lines.push(`${kindLabel}描述：${input.description.trim()}`);
  const details = formatPromptDetails(input.details);
  if (details.length) lines.push("详细设定：", ...details);
  return lines.join("\n");
}

function formatPromptDetails(value?: Record<string, unknown>) {
  if (!value) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    formatPromptValue(key, item),
  );
}

function formatPromptValue(key: string, value: unknown): string[] {
  if (typeof value === "string")
    return value.trim() ? [`${key}：${value.trim()}`] : [];
  if (typeof value === "number" || typeof value === "boolean")
    return [`${key}：${String(value)}`];
  if (Array.isArray(value)) {
    const scalarValues = value
      .filter(
        (item): item is string | number | boolean =>
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean",
      )
      .map((item) => String(item).trim())
      .filter(Boolean);
    const nestedValues = value.flatMap((item, index) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? formatPromptValue(`${key}.${index + 1}`, item)
        : [],
    );
    return [
      ...(scalarValues.length ? [`${key}：${scalarValues.join("；")}`] : []),
      ...nestedValues,
    ];
  }
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([nestedKey, nestedValue]) =>
        formatPromptValue(`${key}.${nestedKey}`, nestedValue),
    );
  return [];
}
