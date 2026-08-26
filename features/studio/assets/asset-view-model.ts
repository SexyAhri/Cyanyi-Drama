import type {
  ProjectAssetCatalog,
  ProjectMediaAsset,
} from "../types";

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
  kind: StudioAssetKind;
  name: string;
  candidates: StudioAssetCandidate[];
};

export function buildStudioAssetEntities(
  catalog: ProjectAssetCatalog,
  kind: StudioAssetKind,
): StudioAssetEntity[] {
  const assetsById = new Map(catalog.assets.map((asset) => [asset.id, asset]));
  if (kind === "character") {
    return catalog.characters.map((character) => ({
      id: character.id,
      description: character.introduction,
      kind,
      name: character.name,
      candidates: character.appearances.map((appearance) =>
        toCandidate({
          id: appearance.id,
          asset: appearance.imageAssetId
            ? assetsById.get(appearance.imageAssetId)
            : undefined,
          assetId: appearance.imageAssetId,
          createdAt: appearance.createdAt,
          description: appearance.description,
          selected: appearance.selected,
        }),
      ),
    }));
  }
  if (kind === "location") {
    return catalog.locations.map((location) => ({
      id: location.id,
      description: location.summary,
      kind,
      name: location.name,
      candidates: location.images.map((image) =>
        toCandidate({
          id: image.id,
          asset: image.imageAssetId
            ? assetsById.get(image.imageAssetId)
            : undefined,
          assetId: image.imageAssetId,
          createdAt: image.createdAt,
          description: image.description,
          selected:
            image.selected || location.selectedImageId === image.id,
        }),
      ),
    }));
  }
  return catalog.props.map((prop) => ({
    id: prop.id,
    description: prop.summary,
    kind,
    name: prop.name,
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
  }));
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
