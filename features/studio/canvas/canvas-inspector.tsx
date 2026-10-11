"use client";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { X, ArrowUpRight, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelEditorDialog } from "../storyboard/panel-editor-dialog";
import type {
  CanvasCard,
  CanvasDocument,
  CanvasEdge,
  CanvasPurpose,
} from "./types";
import {
  canvasEdgePurpose,
  compileCanvasInput,
} from "@/lib/studio/canvas-document";
import {
  edgeLabel,
  nodeCandidates,
  purposeLabel,
  linkedCanvasAsset,
  nodeMedia,
  canvasBaselineTargets,
} from "./canvas-view-model";
import type {
  ProjectAssetCatalog,
  StudioLocale,
  StudioModelOption,
  StudioStoryboardPanel,
} from "../types";

export function CanvasInspector({
  node,
  edge,
  document,
  catalog,
  panels,
  models,
  locale,
  busy,
  onPatch,
  onEdge,
  onRemove,
  onClose,
  onReview,
  onOpenPanel,
  onSavePanel,
  onApplyMedia,
  onSetBaseline,
  onOpenAssets,
  onLipSync,
  onBranch,
  onSelectNode,
}: {
  node?: CanvasCard;
  edge?: CanvasEdge;
  document: CanvasDocument;
  catalog?: ProjectAssetCatalog;
  panels: StudioStoryboardPanel[];
  models: StudioModelOption[];
  locale: StudioLocale;
  busy: boolean;
  onPatch: (patch: Partial<CanvasCard>) => void;
  onEdge: (purpose: CanvasPurpose) => void;
  onRemove: () => void;
  onClose: () => void;
  onReview: () => void;
  onOpenPanel: (panelId: string) => void;
  onSavePanel: (panel: StudioStoryboardPanel) => Promise<void>;
  onApplyMedia: () => void;
  onSetBaseline: (entityId: string) => void;
  onOpenAssets: (kind: "assets" | "audio") => void;
  onLipSync: () => void;
  onBranch: (kind: "image" | "video") => void;
  onSelectNode: (id: string) => void;
}) {
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const panel = panels.find((item) => item.id === node?.panelId);
  const kind = node?.outputKind ?? (node?.kind === "video" ? "video" : "image");
  const compiled = node ? compileCanvasInput(document, node, kind) : undefined;
  const from = document.nodes.find((item) => item.id === edge?.from);
  const target = document.nodes.find((item) => item.id === edge?.to);
  const generating = node && ["panel", "image", "video"].includes(node.kind);
  const candidates = node ? nodeCandidates(node, catalog) : [];
  const linkedAsset = node ? linkedCanvasAsset(node, catalog) : undefined;
  const media = node ? nodeMedia(node, catalog, panels) : undefined;
  const inheritedMedia = node?.kind === "image" && node.id.startsWith("episode-asset-image-") && media?.url && media.sourceTargetId !== node.id;
  const baselineTargets = node ? canvasBaselineTargets(node, document, catalog, panels) : [];
  const versionDefault = linkedAsset
    ? t("项目当前采用版本", "Current project version")
    : t("当前镜头 / 最新结果", "Current shot / latest result");
  const appearanceIds =
    node?.kind === "character"
      ? catalog?.characters
          .find((item) => item.id === node.entityId)
          ?.appearances.map((appearance) => ({
            assetId: appearance.imageAssetId,
            label: `${appearance.appearanceIndex + 1} · ${appearance.description ?? ""}${appearance.selected ? t("（当前采用）", " (current)") : ""}`,
          }))
      : node?.kind === "location"
        ? catalog?.locations
            .find((item) => item.id === node.entityId)
            ?.images.map((image) => ({
              assetId: image.imageAssetId,
              label: `${image.imageIndex + 1} · ${image.description ?? ""}`,
            }))
        : undefined;
  const assetVersions =
    appearanceIds?.filter((item) => item.assetId) ??
    candidates.map((item, index) => ({
      assetId: item.id,
      label: `${index + 1} · ${item.kind} · ${new Date(item.createdAt).toLocaleString(locale === "en" ? "en-US" : "zh-CN")}`,
    }));
  return (
    <aside
      aria-label={t("节点编辑", "Node editor")}
      data-canvas-no-zoom
      className="flex h-[45%] min-w-0 w-full shrink-0 flex-col overflow-hidden border-t bg-background sm:h-full sm:w-72 sm:max-w-[45%] sm:border-l sm:border-t-0 xl:w-80"
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3 text-sm font-medium">
        <span className="truncate">
          {node?.title ?? t("连线用途", "Connection")}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("关闭编辑面板", "Close editor")}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 min-w-0 space-y-4 overflow-x-hidden overflow-y-auto break-words p-3 text-xs">
        {edge && from && (
          <>
            <p className="text-muted-foreground">
              {from.title} → {target?.title}
            </p>
            <label className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
              {t("连接用途", "Purpose")}
              <NativeSelect
                disabled={busy}
                value={canvasEdgePurpose(edge, from)}
                onChange={(event) =>
                  onEdge(event.target.value as CanvasPurpose)
                }
                className="h-9 min-w-0 w-full max-w-full truncate rounded border bg-background px-2"
              >
                {(
                  [
                    "context",
                    "reference",
                    "first_frame",
                    "last_frame",
                    "dialogue",
                    "causality",
                    "shot_sequence",
                    "story_asset",
                    "episode_bridge",
                  ] as const
                ).map((purpose) => (
                  <NativeSelectOption key={purpose} value={purpose}>
                    {purposeLabel(purpose, locale)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          </>
        )}
        {node && (
          <>
            <label className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
              {t("名称", "Name")}
              <input
                disabled={busy}
                maxLength={300}
                className="h-8 min-w-0 w-full max-w-full rounded border bg-transparent px-2"
                value={node.title}
                onChange={(event) => onPatch({ title: event.target.value })}
              />
            </label>
            {generating && (
              <div className="flex gap-2">
                <NativeSelect
                  disabled={busy || node.kind !== "panel"}
                  aria-label={t("生成类型", "Generation type")}
                  value={kind}
                  onChange={(event) =>
                    onPatch({
                      outputKind: event.target.value as "image" | "video",
                      modelId: undefined,
                      assetId: undefined,
                    })
                  }
                  className="w-20 shrink-0"
                >
                  <NativeSelectOption value="image">
                    {t("图片", "Image")}
                  </NativeSelectOption>
                  <NativeSelectOption value="video">
                    {t("视频", "Video")}
                  </NativeSelectOption>
                </NativeSelect>
                <NativeSelect
                  disabled={busy}
                  aria-label={t("生成模型", "Model")}
                  value={node.modelId || models[0]?.id || ""}
                  onChange={(event) => onPatch({ modelId: event.target.value })}
                  className="min-w-0 flex-1"
                >
                  <NativeSelectOption value="" disabled>
                    {t("选择模型", "Select model")}
                  </NativeSelectOption>
                  {models.map((model) => (
                    <NativeSelectOption key={model.id} value={model.id}>
                      {model.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            )}
            {linkedAsset && (
              <section className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">
                    {t("项目资产设定", "Project asset settings")}
                  </h3>
                  <span className="text-muted-foreground">
                    {t("与工作台同步", "Synced with workspace")}
                  </span>
                </div>
                <p className="whitespace-pre-wrap leading-6">
                  {linkedAsset.visualProfile?.spec.visualIdentity ||
                    linkedAsset.description ||
                    linkedAsset.name}
                </p>
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    {t("查看完整视觉设定", "View full visual settings")}
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap leading-6">
                    {linkedAsset.generationPrompt}
                  </p>
                </details>
              </section>
            )}
            <label className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
              {generating
                ? t("提示词草稿", "Prompt draft")
                : linkedAsset
                  ? t("画布补充备注", "Canvas notes")
                  : t("内容与设定", "Notes")}
              <textarea
                disabled={busy}
                maxLength={30000}
                className="h-28 min-w-0 w-full max-w-full resize-y rounded border bg-transparent p-2 text-sm leading-6"
                value={
                  kind === "video" && generating
                    ? (node.videoText ?? "")
                    : node.text
                }
                placeholder={
                  generating
                    ? kind === "video"
                      ? t(
                          "描述主体动作、镜头运动与时长",
                          "Describe action, camera movement and duration",
                        )
                      : t(
                          "描述想要的构图、画面与变化",
                          "Describe composition and desired changes",
                        )
                    : linkedAsset
                      ? t(
                          "可选：记录此分支的创作想法",
                          "Optional notes for this branch",
                        )
                      : undefined
                }
                onChange={(event) =>
                  onPatch(
                    kind === "video" && generating
                      ? { videoText: event.target.value }
                      : { text: event.target.value },
                  )
                }
              />
            </label>
            {panel && (
              <details className="rounded-md border p-2.5">
                <summary className="cursor-pointer font-medium">
                  {t("镜头台词与动作", "Shot dialogue and action")}
                </summary>
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {t("正式镜头", "Production shot")} {panel.panelIndex + 1}
                    </span>
                    <PanelEditorDialog
                      key={panel.id}
                      locale={locale}
                      panel={panel}
                      onSave={onSavePanel}
                    />
                  </div>
                  <p className="text-muted-foreground">
                    {panel.locationName || t("场景未设定", "No location")} ·{" "}
                    {panel.durationSeconds ?? "—"}s ·{" "}
                    {panel.cameraMove || t("固定镜头", "Static camera")}
                  </p>
                  <p className="leading-5">
                    {panel.speakingCharacter
                      ? `${panel.speakingCharacter}：${panel.lipSyncText ?? ""}`
                      : t("此镜头无对白说话人", "No dialogue speaker")}
                  </p>
                  <p className="text-muted-foreground">
                    {t("保持沉默：", "Silent: ")}
                    {panel.characters
                      .filter((name) => name !== panel.speakingCharacter)
                      .join("、") || "—"}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onOpenPanel(panel.id)}
                  >
                    {t("返回镜头工作台", "Open shot workspace")}
                    <ArrowUpRight className="size-3.5" />
                  </Button>
                </div>
              </details>
            )}
            {generating && !panel && (
              <label className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
                {t("关联正式镜头", "Link to production shot")}
                <NativeSelect
                  disabled={busy}
                  value={node.panelId ?? ""}
                  onChange={(event) =>
                    onPatch({ panelId: event.target.value || undefined })
                  }
                  className="min-w-0 w-full max-w-full"
                >
                  <NativeSelectOption value="">
                    {t("独立创作", "Independent creation")}
                  </NativeSelectOption>
                  {panels.map((panel) => (
                    <NativeSelectOption key={panel.id} value={panel.id}>
                      {panel.panelIndex + 1} · {panel.description?.slice(0, 32)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
            )}
            {assetVersions.length > 0 && (
              <label className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
                {t("采用素材版本", "Asset version")}
                <NativeSelect
                  disabled={busy}
                  value={node.assetId ?? ""}
                  title={
                    assetVersions.find((item) => item.assetId === node.assetId)
                      ?.label ?? versionDefault
                  }
                  onChange={(event) =>
                    onPatch({ assetId: event.target.value || undefined })
                  }
                  className="min-w-0 w-full max-w-full"
                >
                  <NativeSelectOption value="">
                    {versionDefault}
                  </NativeSelectOption>
                  {assetVersions.map((item) => (
                    <NativeSelectOption
                      key={item.assetId}
                      value={item.assetId!}
                    >
                      {item.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
            )}
            {inheritedMedia ? (
              <p className="leading-5 text-muted-foreground">
                {t("已复用项目资产图，无需为本集重复生成。需要新版本时可重新生成。", "Using the project asset image. Generate again only if you need a new version.")}
              </p>
            ) : null}
            {baselineTargets.map(({ entity, candidate }) => (
              <Button
                key={`${entity.kind}-${entity.id}`}
                size="sm"
                variant="outline"
                disabled={busy || candidate.selected}
                onClick={() => onSetBaseline(entity.id)}
              >
                <Check className="size-3.5" />
                {candidate.selected
                  ? t(`${entity.name} · 当前基准`, `${entity.name} · Current baseline`)
                  : t(`设为${entity.name}的基准`, `Set as ${entity.name} baseline`)}
              </Button>
            ))}
            {node.panelId && node.assetId && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onApplyMedia}
              >
                {t("将此版本选入正式镜头", "Use this version in production")}
              </Button>
            )}
            {compiled && compiled.inputs.length > 0 && (
              <section className="space-y-2">
                <h3 className="font-medium">{t("引用输入", "Inputs")}</h3>
                {compiled.inputs.map((item) => (
                  <button
                    key={item.edge.id}
                    type="button"
                    onClick={() => onSelectNode(item.source.id)}
                    className="flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="truncate">{item.source.title}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {edgeLabel(item.edge, item.source, locale)}
                    </span>
                  </button>
                ))}
                {compiled.inputs.some(
                  (item) => item.purpose === "dialogue",
                ) && (
                  <>
                    <p className="leading-5 text-muted-foreground">
                      {t(
                        "台词音频用于口型步骤；视频生成保持无对白，避免错误角色开口。",
                        "Dialogue audio is applied in the lip sync step. Video generation remains silent.",
                      )}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !panel}
                      onClick={onLipSync}
                    >
                      {t("审核配音与口型", "Review lip sync")}
                    </Button>
                  </>
                )}
              </section>
            )}
            {node.kind !== "audio" &&
              node.kind !== "video" &&
              (node.kind === "text" || media?.kind === "image") && (
                <section className="space-y-2 border-t pt-3">
                  <h3 className="font-medium">
                    {t("继续创作", "Continue creating")}
                  </h3>
                  <p className="leading-5 text-muted-foreground">
                    {t(
                      "新节点自动连接并引用当前内容。",
                      "New nodes are connected to this content automatically.",
                    )}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onBranch("image")}
                    >
                      {t("创作图片", "Create image")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onBranch("video")}
                    >
                      {t("制作视频", "Create video")}
                    </Button>
                  </div>
                </section>
              )}
            {node.promptVersions?.length ? (
              <details>
                <summary className="cursor-pointer text-muted-foreground">
                  {t("生成提示词版本", "Prompt versions")} ·{" "}
                  {node.promptVersions.length}
                </summary>
                <div className="mt-2 space-y-2">
                  {[...node.promptVersions].reverse().map((version) => (
                    <div key={version.id} className="rounded border p-2">
                      <p className="mb-1 text-muted-foreground">
                        {version.kind} ·{" "}
                        {new Date(version.createdAt).toLocaleString()}
                      </p>
                      <p className="line-clamp-3 whitespace-pre-wrap leading-5">
                        {version.prompt}
                      </p>
                      <Button
                        disabled={busy}
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          onPatch({
                            outputKind: version.kind,
                            ...(version.kind === "video"
                              ? { videoText: version.prompt }
                              : { text: version.prompt }),
                          })
                        }
                      >
                        {t("恢复到草稿", "Restore draft")}
                      </Button>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
            {["character", "location", "prop"].includes(node.kind) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenAssets("assets")}
              >
                {t("编辑角色 / 场景资产", "Edit production assets")}
              </Button>
            )}
            {node.kind === "audio" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenAssets("audio")}
              >
                {t("设置音色与配音", "Edit voice and dialogue")}
              </Button>
            )}
          </>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-2 border-t p-3">
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          aria-label={t("移出画布", "Remove from canvas")}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
        {generating && (
          <Button
            size="sm"
            disabled={busy || !models.length}
            onClick={onReview}
          >
            {inheritedMedia ? t("重新生成新版本", "Generate a new version") : t("审核并生成", "Review and generate")}
          </Button>
        )}
      </footer>
    </aside>
  );
}
