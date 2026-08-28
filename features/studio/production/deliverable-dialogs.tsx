"use client";

import { LoaderCircle, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { cn } from "@/lib/utils";

import { createStudioDeliverable } from "../api";
import type {
  ProductionDeliverableCatalog,
  ProjectMediaAsset,
  StudioLocale,
} from "../types";
import { getProductionCopy, productionLabel } from "./copy";
import {
  getDeliverableGuidance,
  suggestedDependencyIds,
} from "./deliverable-view-model";

const PROJECT_SCOPED_TYPES = new Set([
  "creative_brief",
  "production_bible",
  "production_control",
  "story_bible",
  "visual_bible",
  "character_design",
  "environment_design",
  "prop_costume_design",
]);

export function DeliverableCreateDialog({
  catalog,
  defaultType,
  departments,
  episodeId,
  locale,
  onCompleted,
  projectId,
  sourceAssets,
  types,
}: {
  catalog: ProductionDeliverableCatalog;
  defaultType: string;
  departments: string[];
  episodeId?: string;
  locale: StudioLocale;
  onCompleted: () => Promise<unknown> | void;
  projectId: string;
  sourceAssets: ProjectMediaAsset[];
  types?: string[];
}) {
  const copy = getProductionCopy(locale);
  const initialTemplate = getDeliverableTemplate(locale, defaultType);
  const [open, setOpen] = useState(false);
  const [deliverableType, setDeliverableType] = useState(defaultType);
  const [title, setTitle] = useState(initialTemplate.title);
  const [summary, setSummary] = useState(initialTemplate.summary);
  const [directives, setDirectives] = useState(
    initialTemplate.directives.join("\n"),
  );
  const [constraints, setConstraints] = useState(
    initialTemplate.constraints.join("\n"),
  );
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [dependencyIds, setDependencyIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const availableTypes = useMemo(() => {
    const typeFilter = types ? new Set(types) : null;
    return catalog.departments
      .filter((department) => departments.includes(department.id))
      .flatMap((department) => department.deliverableTypes)
      .filter((type) => !typeFilter || typeFilter.has(type));
  }, [catalog.departments, departments, types]);
  const department = catalog.departments.find((candidate) =>
    candidate.deliverableTypes.includes(deliverableType),
  );

  useEffect(() => {
    if (availableTypes.includes(deliverableType)) return;
    setDeliverableType(
      availableTypes.includes(defaultType) ? defaultType : availableTypes[0] ?? "",
    );
  }, [availableTypes, defaultType, deliverableType]);

  function updateSelection(
    current: string[],
    id: string,
    checked: boolean,
    update: (value: string[]) => void,
  ) {
    update(
      checked
        ? [...new Set([...current, id])]
        : current.filter((item) => item !== id),
    );
  }

  async function submit() {
    if (!department || !deliverableType || !title.trim() || !summary.trim())
      return;
    setIsSubmitting(true);
    try {
      const projectScoped = PROJECT_SCOPED_TYPES.has(deliverableType);
      await createStudioDeliverable(projectId, {
        department: department.id,
        deliverableType,
        title: title.trim(),
        scopeType: projectScoped || !episodeId ? "project" : "episode",
        scopeId: projectScoped || !episodeId ? projectId : episodeId,
        episodeId: projectScoped ? undefined : episodeId,
        payload: {
          summary: summary.trim(),
          directives: toLines(directives),
          constraints: toLines(constraints),
        },
        sourceRefs: sourceIds.map((id) => ({ type: "media_asset", id })),
        dependencyIds,
      });
      toast.success(copy.created);
      setOpen(false);
      reset(defaultType);
      await onCompleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  function reset(type: string) {
    const template = getDeliverableTemplate(locale, type);
    setDeliverableType(type);
    setTitle(template.title);
    setSummary(template.summary);
    setDirectives(template.directives.join("\n"));
    setConstraints(template.constraints.join("\n"));
    setSourceIds(suggestedSourceIds(type, sourceAssets));
    setDependencyIds(
      suggestedDependencyIds(type, catalog.deliverables),
    );
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        if (next || !isSubmitting) reset(defaultType);
      }}
      open={open}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        {copy.newDeliverable}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg sm:max-h-[min(92dvh,860px)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.newDeliverable}</DialogTitle>
          <DialogDescription className="sr-only">
            {copy.deliverables}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <label className="grid gap-1.5 text-sm font-medium">
            {copy.type}
            <Select
              disabled={isSubmitting}
              onValueChange={(value) => value && reset(value)}
              value={deliverableType}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue>
                  {productionLabel(locale, "types", deliverableType)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {availableTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {productionLabel(locale, "types", type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs leading-5 font-normal text-muted-foreground">
              {getDeliverableTemplate(locale, deliverableType).purpose}
            </span>
            <span className="text-xs leading-5 font-normal text-muted-foreground">
              {copy.usedBy}：{getDeliverableGuidance(locale, deliverableType).usedBy}
            </span>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {copy.title}
            <Input
              disabled={isSubmitting}
              maxLength={191}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={copy.titlePlaceholder}
              value={title}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {copy.summary}
            <Textarea
              className="h-28 resize-y overflow-y-auto field-sizing-fixed"
              disabled={isSubmitting}
              maxLength={6_000}
              onChange={(event) => setSummary(event.target.value)}
              placeholder={copy.summaryPlaceholder}
              value={summary}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              {copy.directives}
              <Textarea
                className="h-28 resize-y overflow-y-auto field-sizing-fixed"
                disabled={isSubmitting}
                onChange={(event) => setDirectives(event.target.value)}
                placeholder={copy.directivesPlaceholder}
                value={directives}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {copy.constraints}
              <Textarea
                className="h-28 resize-y overflow-y-auto field-sizing-fixed"
                disabled={isSubmitting}
                onChange={(event) => setConstraints(event.target.value)}
                placeholder={copy.constraintsPlaceholder}
                value={constraints}
              />
            </label>
          </div>

          {catalog.deliverables.length ? (
            <fieldset>
              <legend className="text-sm font-medium">{copy.upstream}</legend>
              {dependencyIds.length ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {copy.dependencyRecommended}
                </p>
              ) : null}
              <div className="mt-2 max-h-40 divide-y overflow-y-auto border-y">
                {catalog.deliverables
                  .filter((item) => item.status !== "superseded")
                  .map((item) => (
                    <label
                      className="flex cursor-pointer items-center gap-3 px-2 py-2.5"
                      key={item.id}
                    >
                      <Checkbox
                        checked={dependencyIds.includes(item.id)}
                        disabled={isSubmitting}
                        onCheckedChange={(checked) =>
                          updateSelection(
                            dependencyIds,
                            item.id,
                            Boolean(checked),
                            setDependencyIds,
                          )
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-xs">
                        {item.title}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        v{item.version} ·{" "}
                        {productionLabel(locale, "statuses", item.status)}
                      </span>
                    </label>
                  ))}
              </div>
            </fieldset>
          ) : null}

          {sourceAssets.length ? (
            <fieldset>
              <legend className="text-sm font-medium">
                {copy.sourceAssets}
              </legend>
              <div className="mt-2 grid max-h-52 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
                {sourceAssets.map((asset) => {
                  const checked = sourceIds.includes(asset.id);
                  return (
                    <label
                      className={cn(
                        "relative cursor-pointer overflow-hidden rounded-md border bg-muted/20",
                        checked && "border-foreground",
                      )}
                      key={asset.id}
                    >
                      <Checkbox
                        aria-label={copy.sourceAssets}
                        checked={checked}
                        className="absolute top-2 left-2 z-10 bg-background"
                        disabled={isSubmitting}
                        onCheckedChange={(next) =>
                          updateSelection(
                            sourceIds,
                            asset.id,
                            Boolean(next),
                            setSourceIds,
                          )
                        }
                      />
                      <div className="aspect-square">
                        {asset.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={copy.sourceAssets}
                            className="size-full object-cover"
                            src={asset.url}
                          />
                        ) : null}
                      </div>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
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
            disabled={
              isSubmitting ||
              !department ||
              !deliverableType ||
              !title.trim() ||
              !summary.trim()
            }
            onClick={() => void submit()}
            type="button"
          >
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {copy.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeliverableRejectDialog({
  disabled,
  gateKey,
  locale,
  onReject,
}: {
  disabled: boolean;
  gateKey: string;
  locale: StudioLocale;
  onReject: (note: string) => Promise<void>;
}) {
  const copy = getProductionCopy(locale);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  async function submit() {
    if (!note.trim()) return;
    setIsSubmitting(true);
    try {
      await onReject(note.trim());
      setOpen(false);
      setNote("");
    } finally {
      setIsSubmitting(false);
    }
  }
  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button disabled={disabled} size="sm" variant="outline" />}>
        <X className="size-4" />
        {copy.reject}
      </DialogTrigger>
      <DialogContent className="rounded-lg sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.rejectionNote}</DialogTitle>
          <DialogDescription>
            {productionLabel(locale, "gates", gateKey)}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          className="h-28 resize-y overflow-y-auto field-sizing-fixed"
          disabled={isSubmitting}
          onChange={(event) => setNote(event.target.value)}
          placeholder={copy.rejectionPlaceholder}
          value={note}
        />
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
            disabled={isSubmitting || !note.trim()}
            onClick={() => void submit()}
            type="button"
            variant="destructive"
          >
            {copy.reject}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeliverableConfirmDialog({
  description,
  disabled,
  icon,
  label,
  locale,
  onConfirm,
  variant = "default",
}: {
  description: string;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  locale: StudioLocale;
  onConfirm: () => Promise<void>;
  variant?: "default" | "outline";
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
  const copy = getProductionCopy(locale);
  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <AlertDialogTrigger
        render={<Button disabled={disabled} size="sm" variant={variant} />}
      >
        {icon}
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>
            {copy.cancel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={isSubmitting}
            onClick={async () => {
              setIsSubmitting(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function toLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function suggestedSourceIds(type: string, assets: ProjectMediaAsset[]) {
  const entityTypes =
    type === "character_design"
      ? new Set(["character", "character_appearance"])
      : type === "environment_design"
        ? new Set(["location", "location_image"])
        : type === "prop_costume_design"
          ? new Set(["prop"])
          : null;
  const relevant = entityTypes
    ? assets.filter((asset) =>
        asset.references.some((reference) =>
          entityTypes.has(reference.entityType),
        ),
      )
    : assets;
  return relevant.slice(0, 24).map((asset) => asset.id);
}

export function getDeliverableTemplate(locale: StudioLocale, type: string) {
  const zh = locale !== "en";
  const templates: Record<
    string,
    {
      title: string;
      purpose: string;
      summary: string;
      directives: string[];
      constraints: string[];
    }
  > = {
    story_bible: {
      title: zh ? "世界观与战力规则" : "World and power-system rules",
      purpose: getDeliverableGuidance(locale, "story_bible").purpose,
      summary: zh
        ? "整理世界层级、势力与地理尺度，并锁定境界顺序、每个境界的能力边界、功法招式、视觉母题和代价。"
        : "Define world scale, factions, geography, realm order, per-realm capability limits, techniques, visual motifs, and costs.",
      directives: zh
        ? [
            "境界与功法沿用原文名称并附原文依据",
            "逐境界说明速度、范围、破坏力、限制和可见特征",
            "技能特效说明能量形态、元素、颜色、运动和环境反馈",
            "宏大场景用人物、建筑与地貌建立稳定尺度",
          ]
        : [
            "Preserve source names and evidence for every realm and technique",
            "Define speed, range, force, limits, and visible traits per realm",
            "Define energy form, element, color, motion, and environment response",
            "Establish stable scale with characters, architecture, and terrain",
          ],
      constraints: zh
        ? [
            "不得新增原文未出现的境界、功法、能力和因果规则",
            "角色只能使用当前剧情已掌握且境界允许的能力",
            "视觉放大不得改变胜负、伤害和剧情结果",
          ]
        : [
            "Do not invent realms, techniques, abilities, or causal rules",
            "Characters may use only acquired abilities allowed by their current realm",
            "Visual scale must not change winners, injuries, or story outcomes",
          ],
    },
    visual_bible: {
      title: zh ? "项目视觉规范" : "Project visual guidelines",
      purpose: zh
        ? "统一角色、场景、道具、材质、光影和构图，供分镜与镜头生产共同引用。"
        : "Unifies character, environment, prop, material, lighting, and composition rules for storyboard and shot production.",
      summary: zh
        ? "建立本项目唯一的视觉基准，明确世界观、造型语言、材质细节、光影逻辑与构图原则。"
        : "Establish the project's single visual source of truth for world design, form language, materials, lighting, and composition.",
      directives: zh
        ? ["保持角色身份与服装连续", "场景空间关系可供镜头复用", "关键材质与色彩必须可执行"]
        : ["Preserve character identity and wardrobe", "Keep environment geography reusable across shots", "Make key materials and colors production-ready"],
      constraints: zh
        ? ["不得偏离已确认剧情设定", "已选资产优先作为视觉基准"]
        : ["Do not contradict approved story facts", "Treat selected assets as primary visual references"],
    },
    color_script: {
      title: zh ? "本集色彩脚本" : "Episode color script",
      purpose: zh
        ? "按剧情节拍规划每场戏的主色、对比度、光线方向和情绪过渡。"
        : "Plans palette, contrast, light direction, and emotional transitions for each story beat.",
      summary: zh
        ? "依据本集叙事节拍建立连续的色彩与光影变化，确保镜头间情绪推进自然。"
        : "Define continuous color and lighting progression from the episode's narrative beats.",
      directives: zh
        ? ["标明场景主色与强调色", "说明昼夜和光源变化", "相邻镜头色彩过渡连续"]
        : ["Specify scene primary and accent colors", "Define time-of-day and light-source changes", "Keep color transitions continuous between shots"],
      constraints: zh
        ? ["角色肤色与服装色保持稳定", "不得用色彩变化制造不存在的剧情事件"]
        : ["Keep skin and wardrobe colors stable", "Do not imply story events that do not exist"],
    },
    character_design: {
      title: zh ? "角色设计规格" : "Character design specification",
      purpose: zh
        ? "确定角色可重复生成的外形、服装、比例、表情范围和多视图连续性。"
        : "Defines repeatable appearance, wardrobe, proportions, expression range, and multi-view continuity.",
      summary: zh
        ? "整理主要角色的身份特征、体型比例、服装层级、发型妆造与表情动作边界。"
        : "Document identity traits, proportions, wardrobe layers, hair and makeup, and expression boundaries for principal characters.",
      directives: zh
        ? ["提供正侧背关键视图", "列出不可变化的身份锚点", "覆盖常用表情与动作姿态"]
        : ["Provide key front, side, and back views", "List immutable identity anchors", "Cover common expressions and action poses"],
      constraints: zh
        ? ["同一角色年龄、脸型和体态保持一致", "服装变化必须有剧情依据"]
        : ["Keep age, facial structure, and body type consistent", "Wardrobe changes require story evidence"],
    },
    environment_design: {
      title: zh ? "场景设计规格" : "Environment design specification",
      purpose: zh
        ? "确定场景空间布局、建筑语言、材质、光源和可供运镜使用的方位关系。"
        : "Defines spatial layout, architecture, materials, light sources, and geography usable by camera blocking.",
      summary: zh
        ? "建立主要场景的空间地图、视觉地标、材质细节、出入口和昼夜光照规则。"
        : "Establish spatial maps, visual landmarks, material detail, entrances, and day-night lighting rules for primary environments.",
      directives: zh
        ? ["明确空间朝向和出入口", "标注可重复出现的视觉地标", "说明主光源与材质响应"]
        : ["Define orientation and entrances", "Mark reusable visual landmarks", "Specify key light sources and material response"],
      constraints: zh
        ? ["相同场景的结构与陈设位置保持连续", "镜头方位不得造成空间跳变"]
        : ["Keep structure and set dressing positions continuous", "Camera geography must not create spatial jumps"],
    },
    prop_costume_design: {
      title: zh ? "道具与服装规格" : "Prop and costume specification",
      purpose: zh
        ? "确定关键道具与服装的造型、材质、尺度、使用方式和跨镜头状态。"
        : "Defines form, material, scale, usage, and cross-shot state for key props and costumes.",
      summary: zh
        ? "整理关键道具、服装与配饰的生产规格，记录尺寸、材质、磨损程度和剧情状态变化。"
        : "Document production specifications for key props, wardrobe, and accessories, including dimensions, materials, wear, and story-state changes.",
      directives: zh
        ? ["给出尺度与角色的对照", "明确材质和表面细节", "记录持有者与状态变化"]
        : ["Show scale against the character", "Define material and surface detail", "Track owner and state changes"],
      constraints: zh
        ? ["关键道具外形与损耗必须跨镜头一致", "服装层级符合角色身份和场景"]
        : ["Keep key prop form and wear continuous", "Wardrobe layers must fit character identity and scene"],
    },
  };
  const selected = templates[type] ?? {
      title: productionLabel(locale, "types", type),
      purpose: getDeliverableGuidance(locale, type).purpose,
      summary: zh ? "整理当前制作范围、执行要求和验收标准。" : "Define the current production scope, execution requirements, and acceptance criteria.",
      directives: [],
      constraints: [],
    };
  return {
    ...selected,
    purpose: getDeliverableGuidance(locale, type).purpose,
  };
}
