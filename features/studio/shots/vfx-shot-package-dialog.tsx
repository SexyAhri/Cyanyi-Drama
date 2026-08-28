"use client";

import { LoaderCircle, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  emptyVfxQc,
  VFX_CATEGORIES,
  VFX_COMPLEXITIES,
  VFX_QC_KEYS,
  VFX_QC_STATUSES,
  vfxShotPackageSchema,
  type VfxShotPackage,
} from "@/lib/production/vfx-contract";

import { createStudioDeliverable } from "../api";
import { getStudioCopy } from "../i18n";
import type {
  ProductionDeliverableCatalog,
  ProjectMediaAsset,
  StudioLocale,
  StudioStoryboardPanel,
} from "../types";
import { getProductionCopy, productionLabel } from "../production/copy";
import type { VfxShotVersion } from "./vfx-view-model";

type Draft = {
  category: VfxShotPackage["category"];
  complexity: VfxShotPackage["complexity"];
  summary: string;
  colorSpace: string;
  plateRequirements: string;
  plateAssetIds: string[];
  elementRequirements: string;
  elementAssetIds: string[];
  trackingRequirements: string;
  matteRequirements: string;
  compositeNotes: string;
  qc: VfxShotPackage["qc"];
};

export function VfxShotPackageDialog({
  assets,
  catalog,
  current,
  episodeId,
  locale,
  onCompleted,
  panel,
  projectId,
}: {
  assets: ProjectMediaAsset[];
  catalog: ProductionDeliverableCatalog;
  current?: VfxShotVersion;
  episodeId: string;
  locale: StudioLocale;
  onCompleted: () => Promise<unknown> | void;
  panel: StudioStoryboardPanel;
  projectId: string;
}) {
  const copy = getProductionCopy(locale);
  const studioCopy = getStudioCopy(locale);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => toDraft(current?.package, panel));
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    const payload = vfxShotPackageSchema.safeParse({
      schemaVersion: 1,
      panelId: panel.id,
      category: draft.category,
      complexity: draft.complexity,
      summary: draft.summary,
      colorSpace: draft.colorSpace,
      plate: {
        requirements: toLines(draft.plateRequirements),
        assetIds: draft.plateAssetIds,
      },
      elements: {
        requirements: toLines(draft.elementRequirements),
        assetIds: draft.elementAssetIds,
      },
      trackingRequirements: toLines(draft.trackingRequirements),
      matteRequirements: toLines(draft.matteRequirements),
      compositeNotes: toLines(draft.compositeNotes),
      qc: draft.qc,
    });
    if (!payload.success) {
      toast.error(copy.vfxRequiredFields);
      return;
    }
    setIsSubmitting(true);
    try {
      const assetIds = [
        ...new Set([...draft.plateAssetIds, ...draft.elementAssetIds]),
      ];
      await createStudioDeliverable(projectId, {
        department: "vfx",
        deliverableType: "vfx_shot_package",
        title: `VFX ${String(panel.panelIndex + 1).padStart(3, "0")} · ${productionLabel(locale, "vfxCategories", draft.category)}`,
        scopeType: "storyboard_panel",
        scopeId: panel.id,
        episodeId,
        payload: payload.data,
        sourceRefs: assetIds.map((id) => ({ type: "media_asset", id })),
        dependencyIds: current
          ? current.deliverable.dependencies.map((dependency) => dependency.id)
          : defaultDependencies(catalog, episodeId, panel.id),
      });
      toast.success(current ? copy.vfxVersionCreated : copy.vfxShotAdded);
      setOpen(false);
      await onCompleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(toDraft(current?.package, panel));
      }}
      open={open}
    >
      <DialogTrigger
        render={<Button size="sm" variant={current ? "outline" : "default"} />}
      >
        {current ? <Pencil className="size-4" /> : <Plus className="size-4" />}
        {current ? copy.newVfxVersion : copy.addVfxShot}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{copy.vfxShotPackage}</DialogTitle>
          <DialogDescription>
            {studioCopy.panel} {String(panel.panelIndex + 1).padStart(2, "0")} ·{" "}
            {panel.shotType || studioCopy.panelDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              disabled={isSubmitting}
              label={copy.vfxCategory}
              onChange={(category) =>
                setDraft({ ...draft, category: category as Draft["category"] })
              }
              options={VFX_CATEGORIES.map((value) => ({
                label: productionLabel(locale, "vfxCategories", value),
                value,
              }))}
              value={draft.category}
            />
            <SelectField
              disabled={isSubmitting}
              label={copy.vfxComplexity}
              onChange={(complexity) =>
                setDraft({
                  ...draft,
                  complexity: complexity as Draft["complexity"],
                })
              }
              options={VFX_COMPLEXITIES.map((value) => ({
                label: productionLabel(locale, "vfxComplexities", value),
                value,
              }))}
              value={draft.complexity}
            />
            <label className="grid gap-1.5 text-sm font-medium">
              {copy.colorSpace}
              <Input
                disabled={isSubmitting}
                maxLength={160}
                onChange={(event) =>
                  setDraft({ ...draft, colorSpace: event.target.value })
                }
                value={draft.colorSpace}
              />
            </label>
          </div>
          <TextField
            disabled={isSubmitting}
            label={copy.vfxSummary}
            onChange={(summary) => setDraft({ ...draft, summary })}
            value={draft.summary}
          />
          <div className="grid gap-4 border-y py-4 sm:grid-cols-2">
            <TextField
              disabled={isSubmitting}
              label={copy.plateRequirements}
              onChange={(plateRequirements) =>
                setDraft({ ...draft, plateRequirements })
              }
              value={draft.plateRequirements}
            />
            <TextField
              disabled={isSubmitting}
              label={copy.elementRequirements}
              onChange={(elementRequirements) =>
                setDraft({ ...draft, elementRequirements })
              }
              value={draft.elementRequirements}
            />
            <TextField
              disabled={isSubmitting}
              label={copy.trackingRequirements}
              onChange={(trackingRequirements) =>
                setDraft({ ...draft, trackingRequirements })
              }
              value={draft.trackingRequirements}
            />
            <TextField
              disabled={isSubmitting}
              label={copy.matteRequirements}
              onChange={(matteRequirements) =>
                setDraft({ ...draft, matteRequirements })
              }
              value={draft.matteRequirements}
            />
            <TextField
              className="sm:col-span-2"
              disabled={isSubmitting}
              label={copy.compositeNotes}
              onChange={(compositeNotes) =>
                setDraft({ ...draft, compositeNotes })
              }
              value={draft.compositeNotes}
            />
          </div>

          {assets.length ? (
            <fieldset>
              <legend className="text-sm font-semibold">
                {copy.vfxSources}
              </legend>
              <div className="mt-2 max-h-52 divide-y overflow-y-auto border-y">
                {assets.map((asset) => (
                  <div
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2"
                    key={asset.id}
                  >
                    <span className="truncate text-xs text-muted-foreground">
                      {asset.id}
                    </span>
                    <AssetRoleCheckbox
                      checked={draft.plateAssetIds.includes(asset.id)}
                      disabled={isSubmitting}
                      label={copy.plate}
                      onChange={(checked) =>
                        setDraft({
                          ...draft,
                          plateAssetIds: updateIds(
                            draft.plateAssetIds,
                            asset.id,
                            checked,
                          ),
                        })
                      }
                    />
                    <AssetRoleCheckbox
                      checked={draft.elementAssetIds.includes(asset.id)}
                      disabled={isSubmitting}
                      label={copy.element}
                      onChange={(checked) =>
                        setDraft({
                          ...draft,
                          elementAssetIds: updateIds(
                            draft.elementAssetIds,
                            asset.id,
                            checked,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset>
            <legend className="text-sm font-semibold">{copy.shotQc}</legend>
            <div className="mt-2 divide-y border-y">
              {VFX_QC_KEYS.map((key) => (
                <div
                  className="grid gap-2 py-3 sm:grid-cols-[9rem_9rem_minmax(0,1fr)] sm:items-center"
                  key={key}
                >
                  <span className="text-sm">
                    {productionLabel(locale, "vfxQc", key)}
                  </span>
                  <Select
                    disabled={isSubmitting}
                    onValueChange={(status) =>
                      status &&
                      setDraft({
                        ...draft,
                        qc: {
                          ...draft.qc,
                          [key]: {
                            ...draft.qc[key],
                            status:
                              status as VfxShotPackage["qc"][typeof key]["status"],
                          },
                        },
                      })
                    }
                    value={draft.qc[key].status}
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue>
                        {productionLabel(
                          locale,
                          "vfxQcStatuses",
                          draft.qc[key].status,
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {VFX_QC_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {productionLabel(locale, "vfxQcStatuses", status)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label={`${productionLabel(locale, "vfxQc", key)} ${copy.notes}`}
                    disabled={isSubmitting}
                    maxLength={2_000}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        qc: {
                          ...draft.qc,
                          [key]: { ...draft.qc[key], note: event.target.value },
                        },
                      })
                    }
                    placeholder={copy.notes}
                    value={draft.qc[key].note}
                  />
                </div>
              ))}
            </div>
          </fieldset>
        </div>
        <DialogFooter className="rounded-b-lg">
          <Button
            disabled={isSubmitting}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            {copy.cancel}
          </Button>
          <Button
            disabled={isSubmitting}
            onClick={() => void submit()}
            type="button"
          >
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : current ? (
              <Pencil className="size-4" />
            ) : (
              <Plus className="size-4" />
            )}
            {current ? copy.createVersion : copy.addVfxShot}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TextField({
  className,
  disabled,
  label,
  onChange,
  value,
}: {
  className?: string;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className={`grid gap-1.5 text-sm font-medium ${className ?? ""}`}>
      {label}
      <Textarea
        className="h-24 resize-y overflow-y-auto field-sizing-fixed"
        disabled={disabled}
        maxLength={6_000}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function SelectField({
  disabled,
  label,
  onChange,
  options,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <Select
        disabled={disabled}
        onValueChange={(next) => next && onChange(next)}
        value={value}
      >
        <SelectTrigger className="h-9 w-full">
          <SelectValue>
            {options.find((option) => option.value === value)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function AssetRoleCheckbox({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(Boolean(next))}
      />
      {label}
    </label>
  );
}

function toDraft(
  value: VfxShotPackage | null | undefined,
  panel: StudioStoryboardPanel,
): Draft {
  const cues = panel.vfxCues;
  const cueCategory = cues.find((cue) =>
    VFX_CATEGORIES.includes(cue.category as VfxShotPackage["category"]),
  )?.category as VfxShotPackage["category"] | undefined;
  const cueLines = cues.map(
    (cue) =>
      `${String(cue.atSecond ?? "?")}s · ${String(cue.phase ?? "-")} · ${String(cue.description ?? "-")}`,
  );
  const worldLines = [
    textField(panel.worldContext.realm, "境界"),
    textField(panel.worldContext.technique, "功法/招式"),
    textField(panel.worldContext.powerRule, "能力限制"),
    textField(panel.worldContext.environmentScale, "场景尺度"),
  ].filter(Boolean);
  return {
    category: value?.category ?? cueCategory ?? "environment",
    complexity: value?.complexity ?? "medium",
    summary:
      value?.summary ??
      [...worldLines, panel.description, ...cueLines].filter(Boolean).join("\n"),
    colorSpace: value?.colorSpace ?? "ACEScg",
    plateRequirements: value?.plate.requirements.join("\n") ?? "",
    plateAssetIds:
      value?.plate.assetIds ?? (panel.imageAssetId ? [panel.imageAssetId] : []),
    elementRequirements:
      value?.elements.requirements.join("\n") ?? cueLines.join("\n"),
    elementAssetIds: value?.elements.assetIds ?? [],
    trackingRequirements: value?.trackingRequirements.join("\n") ?? "",
    matteRequirements: value?.matteRequirements.join("\n") ?? "",
    compositeNotes:
      value?.compositeNotes.join("\n") ??
      [
        ...worldLines,
        ...cues.map(
          (cue) =>
            `${String(cue.atSecond ?? "?")}s 合成 ${String(cue.category ?? "VFX")}；保持技能形态、范围、运动方向及环境受力连续。`,
        ),
      ].join("\n"),
    qc: value?.qc ?? emptyVfxQc(),
  };
}

function textField(value: unknown, label: string) {
  return typeof value === "string" && value.trim()
    ? `${label}：${value.trim()}`
    : "";
}

function defaultDependencies(
  catalog: ProductionDeliverableCatalog,
  episodeId: string,
  panelId: string,
) {
  return catalog.deliverables
    .filter(
      (item) =>
        ["approved", "locked"].includes(item.status) &&
        ["previs", "shot"].includes(item.department) &&
        ((item.scopeType === "episode" && item.scopeId === episodeId) ||
          (item.scopeType === "storyboard_panel" && item.scopeId === panelId)),
    )
    .map((item) => item.id);
}

function toLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function updateIds(current: string[], id: string, checked: boolean) {
  return checked
    ? [...new Set([...current, id])]
    : current.filter((item) => item !== id);
}
