"use client";
import {
  ArrowUpRight,
  Copy,
  Download,
  FileText,
  GitBranch,
  Hand,
  ImageIcon,
  Layers,
  Maximize,
  MousePointer2,
  PanelLeft,
  Redo2,
  Save,
  Sparkles,
  Undo2,
  Upload,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StudioLocale } from "../types";
import { CanvasEpisodeSwitcher } from "./canvas-episode-switcher";
import type { CanvasEpisodeOption } from "./canvas-episode-navigation";

export type CanvasToolbarProps = {
  locale: StudioLocale;
  tool: "select" | "pan";
  busy: boolean;
  saving: boolean;
  dirty: boolean;
  saveError: string;
  nodeCount: number;
  reusableBranchCount: number;
  showReusableBranches: boolean;
  onToggleReusableBranches: () => void;
  selectedCount: number;
  canUndo: boolean;
  canRedo: boolean;
  outlineOpen: boolean;
  libraryOpen: boolean;
  canAssembleEpisodeGraph?: boolean;
  freeLayout: boolean;
  contextualAssetLinks?: boolean;
  onTool: (tool: "select" | "pan") => void;
  onCreate: (kind: "text" | "image" | "video") => void;
  onOutline: () => void;
  onLibrary: () => void;
  onImport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onFree: () => void;
  onFit: () => void;
  onExport: () => void;
  onSave: () => void;
  onReview: () => void;
  onAssembleEpisodeGraph?: () => void;
  episodes?: CanvasEpisodeOption[];
  episodeId?: string;
  onSelectEpisode?: (episodeId: string) => Promise<void>;
};
function Tool({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Button
      size="icon-sm"
      variant={active ? "secondary" : "ghost"}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="size-4" />
    </Button>
  );
}
export function CanvasHeader(props: CanvasToolbarProps) {
  const t = (zh: string, en: string) => (props.locale === "en" ? en : zh);
  return (
    <div className="flex min-h-11 min-w-0 shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1 sm:px-3">
      <span className="hidden lg:inline-flex">
        <Tool
          icon={PanelLeft}
          label={t("节点导航", "Node outline")}
          active={props.outlineOpen}
          onClick={props.onOutline}
        />
      </span>
      <Button
        size="sm"
        variant={props.libraryOpen ? "secondary" : "ghost"}
        onClick={props.onLibrary}
      >
        <Layers className="mr-1 size-4" />
        {t("资产库", "Assets")}
      </Button>
      {props.onAssembleEpisodeGraph && (
        <Button
          size="sm"
          variant="ghost"
          disabled={props.busy || !props.canAssembleEpisodeGraph}
          onClick={props.onAssembleEpisodeGraph}
        >
          <GitBranch className="mr-1 size-4" />
          {t("整理整集画布", "Build episode canvas")}
        </Button>
      )}
      <span className="hidden text-xs text-muted-foreground sm:block">
        {props.nodeCount}
        {t(" 个节点", " nodes")}
      </span>
      {props.contextualAssetLinks && <span className="hidden text-xs text-muted-foreground xl:block">{t("选中节点查看资产连线", "Select a node to see asset links")}</span>}
      {props.reusableBranchCount > 0 && (
        <Button size="sm" variant={props.showReusableBranches ? "secondary" : "ghost"}
          aria-pressed={props.showReusableBranches} disabled={props.busy} onClick={props.onToggleReusableBranches}>
          {props.showReusableBranches ? t("折叠复用分支", "Hide reused branches") : t("展开复用分支", "Show reused branches")}
          <span className="text-xs text-muted-foreground">{props.reusableBranchCount}</span>
        </Button>
      )}
      {props.episodes && props.episodeId && props.onSelectEpisode && (
        <CanvasEpisodeSwitcher episodes={props.episodes} episodeId={props.episodeId} locale={props.locale}
          disabled={props.busy || props.saving} onSelect={props.onSelectEpisode} />
      )}
      <div className="ml-auto flex items-center gap-1">
        <Tool
          icon={ArrowUpRight}
          label={t("自由布局", "Free layout")}
          active={props.freeLayout}
          disabled={props.busy}
          onClick={props.onFree}
        />
        <Tool
          icon={Maximize}
          label={t("查看全图", "Fit canvas")}
          onClick={props.onFit}
        />
        <Tool
          icon={Download}
          label={t("导出画布", "Export canvas")}
          onClick={props.onExport}
        />
        <span
          aria-live="polite"
          className={`mx-2 hidden text-xs sm:block ${props.saveError ? "text-destructive" : "text-muted-foreground"}`}
        >
          {props.saving
            ? t("保存中", "Saving")
            : props.saveError
              ? t("保存失败", "Save failed")
              : props.dirty
                ? t("未保存", "Unsaved")
                : t("已保存", "Saved")}
        </span>
        <Tool
          icon={Save}
          label={t("保存", "Save")}
          disabled={props.busy || props.saving}
          onClick={props.onSave}
        />
      </div>
    </div>
  );
}
export function CanvasDock(props: CanvasToolbarProps) {
  const t = (zh: string, en: string) => (props.locale === "en" ? en : zh);
  return (
    <div
      data-canvas-no-zoom
      className="absolute inset-x-3 bottom-4 z-10 flex justify-center"
    >
      <div
        role="toolbar"
        aria-label={t("画布创作工具", "Canvas creation tools")}
        className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border bg-background p-1.5 shadow-lg"
      >
        <Tool
          icon={MousePointer2}
          label={t("选择", "Select")}
          active={props.tool === "select"}
          onClick={() => props.onTool("select")}
        />
        <Tool
          icon={Hand}
          label={t("左键拖动画布", "Pan with left mouse button")}
          active={props.tool === "pan"}
          onClick={() => props.onTool("pan")}
        />
        <span className="mx-1 h-5 border-l" />
        <Tool
          icon={FileText}
          label={t("添加文本", "Add text")}
          disabled={props.busy}
          onClick={() => props.onCreate("text")}
        />
        <Tool
          icon={ImageIcon}
          label={t("添加图片", "Add image")}
          disabled={props.busy}
          onClick={() => props.onCreate("image")}
        />
        <Tool
          icon={Video}
          label={t("添加视频", "Add video")}
          disabled={props.busy}
          onClick={() => props.onCreate("video")}
        />
        <Tool
          icon={Upload}
          label={t("导入素材", "Import media")}
          disabled={props.busy}
          onClick={props.onImport}
        />
        <span className="mx-1 h-5 border-l" />
        <Tool
          icon={Undo2}
          label={t("撤销", "Undo")}
          disabled={props.busy || !props.canUndo}
          onClick={props.onUndo}
        />
        <Tool
          icon={Redo2}
          label={t("重做", "Redo")}
          disabled={props.busy || !props.canRedo}
          onClick={props.onRedo}
        />
        <Tool
          icon={Copy}
          label={t("复制所选", "Duplicate selected")}
          disabled={props.busy || !props.selectedCount}
          onClick={props.onDuplicate}
        />
        <Button
          size="sm"
          className="ml-1 shrink-0 rounded-lg"
          disabled={props.busy || !props.selectedCount}
          onClick={props.onReview}
        >
          <Sparkles className="mr-1 size-3.5" />
          {props.selectedCount > 1
            ? `${t("审核生成", "Review")} ${props.selectedCount}`
            : t("审核生成", "Review")}
        </Button>
      </div>
    </div>
  );
}
