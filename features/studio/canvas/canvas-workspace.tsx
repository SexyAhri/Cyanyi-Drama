"use client";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { GitBranch, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  loadStudioAssetCatalog,
  loadStudioStoryboard,
  saveStudioStoryboard,
  selectStudioPanelMedia,
  selectStudioAsset,
  loadStudioProductionData,
  generateStudioLipSync,
} from "../api";
import type {
  ProjectAssetCatalog,
  StudioModelOption,
  StudioLocale,
  StudioSelectionContext,
  StudioStageId,
  StudioStoryboardData,
  StudioStoryboardPanel,
  WorkspaceSnapshot,
} from "../types";
import {
  canvasConnectionError,
  canvasEdgePurpose,
  compileCanvasInput,
} from "@/lib/studio/canvas-document";
import { CanvasViewport } from "./canvas-viewport";
import { CanvasNode } from "./canvas-node";
import { CanvasLibrary } from "./canvas-library";
import { CanvasInspector } from "./canvas-inspector";
import { CanvasOutline } from "./canvas-outline";
import {
  CanvasHeader,
  CanvasDock,
  type CanvasToolbarProps,
} from "./canvas-toolbar";
import { PanelEditorDialog } from "../storyboard/panel-editor-dialog";
import { getStudioModelName } from "../components/model-select";
import { peekStudioCache } from "../request-cache";
import { useStudioCacheRevision } from "../hooks/use-studio-cache-revision";
import { getTaskOutputRevision, getWorkflowOutputRevision } from "../stage-state";
import { useCanvasConnections } from "./use-canvas-connections";
import { useCanvasDocument } from "./use-canvas-document";
import {
  arrangeEpisodeBranches,
  arrangeEpisodeCausalGraph,
  needsEpisodeCanvasLayout,
  EPISODE_CANVAS_LAYOUT_VERSION,
  buildEpisodeCanvasGraph,
  canvasBranchPath,
  canvasEpisodeSequencePath,
  canvasEpisodeOutputPath,
  mergeCanvasBranchGroups,
} from "./canvas-layout";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  PORT_Y,
  canvasNodeTask,
  edgeLabel,
  nodeMedia,
  panelCard,
  kindLabel,
  canvasSelection,
  linkedCanvasAsset,
  canvasBaselineTargets,
  isReusableCanvasBranch,
  canvasCardSummary,
  canvasImageAvailability,
} from "./canvas-view-model";
import type { CanvasCard, CanvasDocument, CanvasPurpose } from "./types";

const EMPTY_PANELS: StudioStoryboardPanel[] = [];

type Review = {
  node: CanvasCard;
  model?: StudioModelOption;
  prompt: string;
  finalPrompt?: string;
  configurationHash?: string;
  requestHash?: string;
  productionParameters?: unknown;
  inputSignature: string;
  references: string[];
  key: string;
  status: string;
  error?: string;
};
export function CanvasWorkspace({
  projectId,
  episodeId,
  imageModels,
  videoModels,
  lipSyncModels,
  snapshot,
  locale,
  focusedPanelId,
  onRefresh,
  onContextChange,
  onSelectionsChange,
  registerSelectNode,
  registerEditPanel,
  onOpenStage,
  onOpenPanel,
  registerBeforeLeave,
  onSelectEpisode,
}: {
  projectId: string;
  episodeId: string;
  imageModels: StudioModelOption[];
  videoModels: StudioModelOption[];
  lipSyncModels: StudioModelOption[];
  snapshot: WorkspaceSnapshot;
  locale: StudioLocale;
  focusedPanelId?: string;
  onRefresh: () => Promise<unknown>;
  onContextChange: (selection?: StudioSelectionContext) => void;
  onSelectionsChange: (selections: StudioSelectionContext[]) => void;
  registerSelectNode: (handler: ((nodeId: string) => void) | undefined) => void;
  registerEditPanel: (handler: ((nodeId: string) => void) | undefined) => void;
  onOpenStage: (stage: StudioStageId) => void;
  onOpenPanel: (panelId: string) => void;
  registerBeforeLeave: (handler: (() => Promise<boolean>) | undefined) => void;
  onSelectEpisode: (episodeId: string) => Promise<void>;
}) {
  const url = `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/canvas`;
  const state = useCanvasDocument(url);
  const cacheRevision = useStudioCacheRevision();
  const assetRevision = `${getTaskOutputRevision(snapshot.tasks)}|${getWorkflowOutputRevision(snapshot.workflows)}`;
  const lastAssetRevision = useRef<string | undefined>(undefined);
  const { document, current, replace } = state;
  const arrowId = `canvas-arrow-${useId().replace(/:/g, "")}`;
  const [catalog, setCatalog] = useState<ProjectAssetCatalog | undefined>(() => peekStudioCache<ProjectAssetCatalog>(`/api/projects/${encodeURIComponent(projectId)}/asset-catalog`));
  const [storyboard, setStoryboard] = useState<StudioStoryboardData | undefined>(() => peekStudioCache<StudioStoryboardData>(`${url.replace(/\/canvas$/, "")}/storyboard`));
  const panels = storyboard?.storyboard?.panels ?? EMPTY_PANELS;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edgeId, setEdgeId] = useState<string>();
  const [editingPanelId, setEditingPanelId] = useState<string>();
  const editingPanel = panels.find((panel) => panel.id === editingPanelId);
  const [tool, setTool] = useState<"select" | "pan">("pan");
  const [library, setLibrary] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [showReusableBranches, setShowReusableBranches] = useState(false);
  const [review, setReview] = useState<Review[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewPreparing, setReviewPreparing] = useState(false);
  const [reviewError, setReviewError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [lipReview, setLipReview] = useState<{
    nodeId: string;
    panelId: string;
    voiceLineId: string;
    audioAssetId: string;
    speaker: string;
    content: string;
    audioUrl?: string;
    audioDuration: number | null;
    videoDuration: number | null;
  }>();
  const [lipModelId, setLipModelId] = useState("");
  const busyRef = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const focusApplied = useRef("");
  const layoutInitialized = useRef(false);
  const gesture = useRef<{
    startX: number;
    startY: number;
    nodes?: CanvasCard[];
    origin?: { x: number; y: number };
    add?: boolean;
    moved: boolean;
  } | null>(null);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  }>();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const active = document.nodes.find((node) => selected.has(node.id));
  const activeEdge = document.edges.find((edge) => edge.id === edgeId);
  const reusableIds = useMemo(() => new Set(document.nodes.filter(node => isReusableCanvasBranch(node, document, catalog, snapshot.tasks)).map(node => node.id)), [document, catalog, snapshot.tasks]);
  const hiddenIds = useMemo(() => new Set(showReusableBranches ? [] : [...reusableIds].filter(id => !selected.has(id))), [showReusableBranches, reusableIds, selected]);
  const visibleNodes = document.nodes.filter(node => !hiddenIds.has(node.id));
  useEffect(() => {
    const canvas = container.current;
    if (!canvas) return;
    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    const observer = new ResizeObserver(() => {
      const nextWidth = canvas.clientWidth;
      const nextHeight = canvas.clientHeight;
      if (nextWidth === width && nextHeight === height) return;
      const view = current.current.viewport;
      if (!busyRef.current && nextWidth > 0 && nextHeight > 0)
        replace(
          {
            ...current.current,
            viewport: {
              ...view,
              x: view.x + (nextWidth - width) / 2,
              y: view.y + (nextHeight - height) / 2,
            },
          },
          false,
        );
      width = nextWidth;
      height = nextHeight;
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [state.loading, current, replace]);
  const modelList = (node: CanvasCard) =>
    (node.outputKind ?? (node.kind === "video" ? "video" : "image")) === "video"
      ? videoModels
      : imageModels;
  const point = (x: number, y: number) => {
    const rect = container.current?.getBoundingClientRect();
    const view = current.current.viewport;
    return {
      x: (x - (rect?.left ?? 0) - view.x) / view.k,
      y: (y - (rect?.top ?? 0) - view.y) / view.k,
    };
  };
  function center() {
    const rect = container.current?.getBoundingClientRect();
    return point(
      (rect?.left ?? 0) + (rect?.width ?? 700) / 2,
      (rect?.top ?? 0) + (rect?.height ?? 500) / 2,
    );
  }
  function newNodePosition() {
    const target = center();
    const origin = {
      x: target.x - CARD_WIDTH / 2,
      y: target.y - CARD_HEIGHT / 2,
    };
    if (current.current.layoutMode !== "episode") return origin;

    const occupied = current.current.nodes;
    const stepX = CARD_WIDTH + 64;
    const stepY = CARD_HEIGHT + 64;
    for (let radius = 0; radius <= 24; radius++) {
      const candidates: Array<{ x: number; y: number }> = [];
      for (let x = -radius; x <= radius; x++) {
        for (let y = -radius; y <= radius; y++) {
          if (Math.max(Math.abs(x), Math.abs(y)) !== radius) continue;
          candidates.push({
            x: origin.x + x * stepX,
            y: origin.y + y * stepY,
          });
        }
      }
      candidates.sort(
        (a, b) =>
          Math.abs(a.x - origin.x) + Math.abs(a.y - origin.y) -
          (Math.abs(b.x - origin.x) + Math.abs(b.y - origin.y)),
      );
      const free = candidates.find(
        (candidate) =>
          !occupied.some(
            (node) =>
              candidate.x < node.x + CARD_WIDTH + 32 &&
              candidate.x + CARD_WIDTH + 32 > node.x &&
              candidate.y < node.y + CARD_HEIGHT + 32 &&
              candidate.y + CARD_HEIGHT + 32 > node.y,
          ),
      );
      if (free) return free;
    }
    return origin;
  }
  function choose(id: string, add = false) {
    setEdgeId(undefined);
    setSelected((previous) => {
      const next = add ? new Set(previous) : new Set<string>();
      if (add && next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function addNode(card: CanvasCard, reveal = true) {
    if (busyRef.current) return;
    const existing = current.current.nodes.find((item) => item.id === card.id);
    if (existing) {
      choose(existing.id);
      locate(existing);
      return;
    }
    const position = newNodePosition();
    const next = {
      ...card,
      ...position,
    };
    const added = {
      ...current.current,
      nodes: [...current.current.nodes, next],
    };
    replace(
      added.layoutMode === "branches"
        ? arrangeEpisodeBranches(added, panels, locale)
        : added,
    );
    choose(next.id);
    if (reveal) locate(next);
  }
  function create(
    kind: "text" | "image" | "video",
    position?: { x: number; y: number },
  ) {
    const card: CanvasCard = {
      id: crypto.randomUUID(),
      kind,
      title: kindLabel(kind, locale),
      text: "",
      x: 0,
      y: 0,
      ...(kind === "text" ? {} : { outputKind: kind }),
    };
    addNode(card, !position);
    if (position)
      replace(
        {
          ...current.current,
          nodes: current.current.nodes.map((node) =>
            node.id === card.id ? { ...node, ...position } : node,
          ),
        },
        false,
      );
  }
  function locate(node: CanvasCard) {
    const rect = container.current?.getBoundingClientRect();
    const k = current.current.viewport.k;
    replace(
      {
        ...current.current,
        viewport: {
          x: (rect?.width ?? 900) / 2 - (node.x + CARD_WIDTH / 2) * k,
          y: (rect?.height ?? 600) / 2 - (node.y + CARD_HEIGHT / 2) * k,
          k,
        },
      },
      false,
    );
  }
  function createBranch(source: CanvasCard, kind: "image" | "video") {
    if (busyRef.current) return;
    const media = nodeMedia(source, catalog, panels, current.current);
    const hasImage = media?.kind === "image";
    const linkedAsset = linkedCanvasAsset(source, catalog);
    const assetPrompt = linkedAsset?.generationPrompt;
    const hasTextPrompt = Boolean(source.text.trim() || assetPrompt?.trim());
    if (!hasImage && !hasTextPrompt) {
      toast.error(
        t(
          "源节点还没有图片或文字提示，请先补充提示词再创建分支",
          "Add an image or text prompt to the source before creating a branch",
        ),
      );
      return;
    }
    const assetOnlySource =
      !hasImage &&
      ["character", "location", "prop"].includes(source.kind) &&
      Boolean(source.entityId);
    const branchSource =
      media?.kind === "image" && !linkedAsset
        ? { ...source, assetId: media.id }
        : assetOnlySource && assetPrompt
          ? { ...source, text: source.text || assetPrompt }
          : source;
    const target: CanvasCard = {
      id: crypto.randomUUID(),
      kind,
      outputKind: kind,
      title: `${source.title} · ${kindLabel(kind, locale)}`.slice(0, 300),
      text:
        kind === "image"
          ? hasImage
            ? [assetPrompt, source.text]
                .filter(Boolean)
                .join("\n\n")
                .slice(0, 30000)
            : assetOnlySource
            ? [assetPrompt, source.text]
                .filter(Boolean)
                .join("\n\n")
                .slice(0, 30000)
            : ""
          : "",
      videoText:
        kind === "video"
          ? source.videoText?.trim() || (assetOnlySource ? assetPrompt ?? "" : "")
          : "",
      x: source.x + CARD_WIDTH + 180,
      y: source.y,
    };
    const purpose: CanvasPurpose = hasImage
      ? kind === "video"
        ? "first_frame"
        : "reference"
      : "context";
    const error = canvasConnectionError(hasImage ? { ...branchSource, assetId: media.id } : branchSource, target, purpose);
    if (error) {
      toast.error(error);
      return;
    }
    while (
      current.current.nodes.some(
        (node) =>
          Math.abs(node.x - target.x) < CARD_WIDTH + 32 &&
          Math.abs(node.y - target.y) < CARD_HEIGHT + 48,
      )
    )
      target.y += CARD_HEIGHT + 64;
    const next = {
      ...current.current,
      nodes: [
        ...current.current.nodes.map((node) =>
          node.id === source.id ? branchSource : node,
        ),
        target,
      ],
      edges: [
        ...current.current.edges,
        { id: crypto.randomUUID(), from: source.id, to: target.id, purpose },
      ],
    };
    replace(
      next.layoutMode === "branches"
        ? arrangeEpisodeBranches(next, panels, locale)
        : next,
    );
    choose(target.id);
    locate(current.current.nodes.find((node) => node.id === target.id)!);
  }
  function patch(patch: Partial<CanvasCard>) {
    if (!active || busyRef.current) return;
    replace({
      ...current.current,
      nodes: current.current.nodes.map((node) =>
        node.id === active.id ? { ...node, ...patch } : node,
      ),
    });
  }
  function remove() {
    if (busyRef.current) return;
    const next = {
      ...current.current,
      nodes: current.current.nodes.filter((node) => !selected.has(node.id)),
      edges: current.current.edges.filter(
        (edge) =>
          edge.id !== edgeId &&
          !selected.has(edge.from) &&
          !selected.has(edge.to),
      ),
    };
    replace(
      next.layoutMode === "branches" ? mergeCanvasBranchGroups(next) : next,
    );
    setSelected(new Set());
    setEdgeId(undefined);
  }
  function duplicate() {
    const copies = current.current.nodes
      .filter((node) => selected.has(node.id))
      .map((node) => ({
        ...node,
        id: crypto.randomUUID(),
        panelId: undefined,
        x: node.x + 40,
        y: node.y + 40,
        title: node.title + t(" 副本", " copy"),
      }));
    const originals = current.current.nodes.filter((node) =>
      selected.has(node.id),
    );
    const ids = new Map(
      originals.map((node, index) => [node.id, copies[index].id]),
    );
    const edges = current.current.edges
      .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
      .map((edge) => ({
        ...edge,
        id: crypto.randomUUID(),
        from: ids.get(edge.from)!,
        to: ids.get(edge.to)!,
      }));
    replace({
      ...current.current,
      nodes: [...current.current.nodes, ...copies],
      edges: [...current.current.edges, ...edges],
    });
    setSelected(new Set(copies.map((node) => node.id)));
  }
  function validateEdge(
    fromId: string,
    toId: string,
    purpose: CanvasPurpose,
    changingId?: string,
    sourceOverride?: CanvasCard,
  ) {
    const from =
        sourceOverride ??
        current.current.nodes.find((node) => node.id === fromId),
      to = current.current.nodes.find((node) => node.id === toId);
    if (!from || !to) return "节点不存在";
    const preview = nodeMedia(from, catalog, panels, current.current);
    const error = canvasConnectionError(preview?.kind === "image" ? { ...from, assetId: preview.id } : from, to, purpose);
    if (error) return error;
    if (
      current.current.edges.some(
        (edge) =>
          edge.id !== changingId &&
          edge.to === toId &&
          canvasEdgePurpose(
            edge,
            current.current.nodes.find((node) => node.id === edge.from)!,
          ) === purpose &&
          (["first_frame", "last_frame", "dialogue"].includes(purpose) ||
            edge.from === fromId),
      )
    )
      return "这个用途已有连线，请先修改或删除原连线";
    return "";
  }
  const connections = useCanvasConnections(container, current, (from, to) => {
    if (busyRef.current) return;
    let source = current.current.nodes.find((node) => node.id === from)!;
    const preview = nodeMedia(source, catalog, panels, current.current);
    const hasImage = preview?.kind === "image";
    const isProjectAsset =
      ["character", "location", "prop"].includes(source.kind) &&
      Boolean(source.entityId);
    const assetPrompt = linkedCanvasAsset(source, catalog)?.generationPrompt;
    if (!source.assetId && hasImage && !isProjectAsset) {
      source = { ...source, assetId: preview.id };
    } else if (isProjectAsset && assetPrompt && !source.text.trim()) {
      source = { ...source, text: assetPrompt };
    }
    const destination = current.current.nodes.find((node) => node.id === to)!;
    const video = (destination.outputKind ?? destination.kind) === "video";
    const hasFirstFrame = current.current.edges.some(
      (edge) => edge.to === to && edge.purpose === "first_frame",
    );
    const purpose =
      source.panelId && destination.panelId
        ? "causality"
        : isProjectAsset && !hasImage && destination.panelId
          ? "story_asset"
          : isProjectAsset && !hasImage && ["image", "video"].includes(destination.kind)
            ? "context"
          : source.panelId && !hasImage && ["image", "video"].includes(destination.kind)
            ? "context"
            : video && !hasFirstFrame && ["image", "panel"].includes(source.kind)
              ? "first_frame"
              : canvasEdgePurpose({ id: "", from, to }, source);
    const error = validateEdge(from, to, purpose, undefined, source);
    if (error) {
      toast.error(error);
      return;
    }
    const edge = { id: crypto.randomUUID(), from, to, purpose };
    const next = {
      ...current.current,
      nodes: current.current.nodes.map((node) =>
        node.id === from ? source : node,
      ),
      edges: [...current.current.edges, edge],
    };
    replace(
      next.layoutMode === "branches"
        ? arrangeEpisodeBranches(next, panels, locale)
        : next,
    );
    setSelected(new Set());
    setEdgeId(edge.id);
  });
  useEffect(() => {
    registerBeforeLeave(async () => {
      if (busyRef.current) {
        toast.error("请等待当前提交完成");
        return false;
      }
      const saved = await state.save();
      if (!saved) toast.error("画布尚未保存，请重试保存或导出备份");
      return saved;
    });
    return () => registerBeforeLeave(undefined);
  }, [registerBeforeLeave, state.save]);
  useEffect(() => {
    const abort = new AbortController();
    const outputChanged = lastAssetRevision.current !== undefined && lastAssetRevision.current !== assetRevision;
    lastAssetRevision.current = assetRevision;
    const needsSync = outputChanged || !peekStudioCache(`/api/projects/${encodeURIComponent(projectId)}/asset-catalog`);
    void Promise.allSettled([
      (needsSync ? fetch(url, { method: "POST", signal: abort.signal })
        .then(async (response) => {
          if (!response.ok && response.status !== 404) {
            const data = await response.json();
            throw new Error(data.message ?? "画布素材同步失败");
          }
        }).catch(error => {
          if (!abort.signal.aborted) toast.error(error instanceof Error ? error.message : "画布素材同步失败");
        }) : Promise.resolve()).then(() => loadStudioAssetCatalog(projectId, abort.signal, true)),
      loadStudioStoryboard(projectId, episodeId, abort.signal, true),
    ]).then((results) => {
      if (abort.signal.aborted) return;
      const [assets, shots] = results;
      if (assets.status === "fulfilled") setCatalog(assets.value);
      else
        toast.error(
          assets.reason instanceof Error
            ? assets.reason.message
            : "素材加载失败",
        );
      if (shots.status === "fulfilled") setStoryboard(shots.value);
      else
        toast.error(
          shots.reason instanceof Error ? shots.reason.message : "分镜加载失败",
        );
      if (outputChanged && !busyRef.current) void state.refresh();
    });
    return () => abort.abort();
  }, [projectId, episodeId, assetRevision, cacheRevision, url]);

  const currentEpisodeGraph = useCallback(() => {
    if (!catalog || !panels.length) return undefined;
    const episode = snapshot.project.episodes.find((item) => item.id === episodeId);
    const previous = episode
      ? snapshot.project.episodes.find(
          (item) => item.episodeNumber === episode.episodeNumber - 1,
        )
      : undefined;
    return buildEpisodeCanvasGraph(
      current.current,
      panels,
      catalog,
      previous?.novelText?.trim()
        ? {
            id: previous.id,
            episodeNumber: previous.episodeNumber,
            name: previous.name,
            text: previous.novelText,
          }
        : undefined,
      new Set(snapshot.tasks.filter((task) => task.targetType === "canvas_node" && task.targetId).map((task) => task.targetId!)),
    );
  }, [catalog, panels, snapshot.project.episodes, snapshot.tasks, episodeId, current]);

  useEffect(() => {
    if (state.loading || !storyboard || layoutInitialized.current) return;
    if (!catalog && panels.length) return;
    layoutInitialized.current = true;
    if (current.current.layoutMode === "free") return;
    if (catalog && panels.length) {
      const graph = currentEpisodeGraph();
      if (graph) {
        if (needsEpisodeCanvasLayout(current.current, graph)) {
          const arranged = arrangeEpisodeCausalGraph(graph, panels, locale);
          replace(arranged);
          requestAnimationFrame(() => showEpisodeStart(arranged));
        }
        return;
      }
    }
    if (current.current.layoutMode === "branches" && current.current.nodes.length) {
      const merged = mergeCanvasBranchGroups(current.current);
      if (merged !== current.current) {
        const arranged = arrangeEpisodeBranches(merged, panels, locale);
        replace(arranged);
        if (arranged.nodes.length <= 8) fit(arranged);
      }
      return;
    }
    if (current.current.layoutMode) return;
    showBranches();
  }, [state.loading, storyboard, catalog, currentEpisodeGraph]);

  function assembleEpisodeGraph() {
    if (busyRef.current || !catalog || !panels.length) return;
    const graph = currentEpisodeGraph();
    if (!graph) return;
    const arranged = arrangeEpisodeCausalGraph(graph, panels, locale);
    replace(arranged);
    requestAnimationFrame(() => showEpisodeStart(arranged));
  }
  useEffect(() => {
    if (state.loading || busy || !layoutInitialized.current || document.layoutMode !== "episode" || !catalog || !panels.length) return;
    const graph = currentEpisodeGraph();
    if (graph && needsEpisodeCanvasLayout(current.current, graph))
      replace(arrangeEpisodeCausalGraph(graph, panels, locale));
  }, [state.loading, busy, document, catalog, panels, currentEpisodeGraph, current, replace, locale]);
  useEffect(() => {
    if (
      state.loading ||
      !focusedPanelId ||
      focusApplied.current === focusedPanelId
    )
      return;
    const panel = panels.find((panel) => panel.id === focusedPanelId);
    if (!panel) return;
    focusApplied.current = focusedPanelId;
    const node =
      current.current.nodes.find((node) => node.panelId === panel.id) ??
      panelCard(panel, 0);
    if (!current.current.nodes.some((item) => item.id === node.id)) {
      const added = {
        ...current.current,
        nodes: [...current.current.nodes, node],
      };
      replace(
        added.layoutMode === "branches"
          ? arrangeEpisodeBranches(added, panels, locale)
          : added,
      );
    }
    choose(node.id);
    locate(current.current.nodes.find((item) => item.id === node.id)!);
  }, [focusedPanelId, state.loading, storyboard]);
  useEffect(() => {
    if (state.loading || busyRef.current || !panels.length) return;
    let changed = false;
    const nodes = current.current.nodes.map((node) => {
      const panel = panels.find((panel) => panel.id === node.panelId);
      if (!panel || !node.panelPromptBase) return node;
      const base = {
        image: panel.imagePrompt ?? panel.description ?? "",
        video: panel.videoPrompt ?? "",
      };
      if (
        base.image === node.panelPromptBase.image &&
        base.video === node.panelPromptBase.video
      )
        return node;
      changed = true;
      return {
        ...node,
        text: node.text === node.panelPromptBase.image ? base.image : node.text,
        videoText:
          node.videoText === node.panelPromptBase.video
            ? base.video
            : node.videoText,
        panelPromptBase: base,
      };
    });
    if (changed) replace({ ...current.current, nodes }, false);
  }, [storyboard, state.loading]);
  useEffect(() => {
    onContextChange(active ? canvasSelection(active) : undefined);
  }, [active?.id, active?.title, active?.panelId, onContextChange]);
  useEffect(() => {
    onSelectionsChange(document.nodes.map(canvasSelection));
  }, [document.nodes, onSelectionsChange]);
  useEffect(() => {
    registerSelectNode((nodeId) => {
      const node = current.current.nodes.find((node) => node.id === nodeId);
      if (!node) return;
      choose(node.id);
      locate(node);
      setLibrary(false);
      onContextChange(canvasSelection(node));
    });
    return () => registerSelectNode(undefined);
  }, [registerSelectNode, onContextChange]);
  useEffect(() => {
    registerEditPanel((nodeId) => {
      const node = current.current.nodes.find((node) => node.id === nodeId);
      if (!node?.panelId || busyRef.current) return;
      choose(node.id);
      locate(node);
      setEditingPanelId(node.panelId);
    });
    return () => registerEditPanel(undefined);
  }, [registerEditPanel]);
  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      const drag = gesture.current;
      if (!drag) return;
      const dx = (event.clientX - drag.startX) / current.current.viewport.k,
        dy = (event.clientY - drag.startY) / current.current.viewport.k;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!drag.moved && drag.nodes) state.checkpoint();
      drag.moved = true;
      if (drag.nodes) {
        const positions = new Map(
          drag.nodes.map((node) => [
            node.id,
            { x: node.x + dx, y: node.y + dy },
          ]),
        );
        replace(
          {
            ...current.current,
            nodes: current.current.nodes.map((node) =>
              positions.has(node.id)
                ? { ...node, ...positions.get(node.id) }
                : node,
            ),
          },
          false,
        );
      } else if (drag.origin) {
        const p = point(event.clientX, event.clientY),
          box = {
            x: Math.min(p.x, drag.origin.x),
            y: Math.min(p.y, drag.origin.y),
            w: Math.abs(p.x - drag.origin.x),
            h: Math.abs(p.y - drag.origin.y),
          };
        setMarquee(box);
        const ids = current.current.nodes
          .filter(
            (node) =>
              !hiddenIds.has(node.id) &&
              node.x + CARD_WIDTH >= box.x &&
              node.x <= box.x + box.w &&
              node.y + CARD_HEIGHT >= box.y &&
              node.y <= box.y + box.h,
          )
          .map((node) => node.id);
        setSelected(
          (previous) => new Set(drag.add ? [...previous, ...ids] : ids),
        );
      }
    };
    const end = () => {
      gesture.current = null;
      setMarquee(undefined);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
    };
  }, [current, replace, hiddenIds]);
  function dragNode(node: CanvasCard, event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || busyRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = selected.has(node.id)
      ? new Set(selected)
      : event.shiftKey
        ? new Set([...selected, node.id])
        : new Set([node.id]);
    setSelected(ids);
    setEdgeId(undefined);
    gesture.current = {
      startX: event.clientX,
      startY: event.clientY,
      nodes: current.current.nodes.filter((node) => ids.has(node.id)),
      moved: false,
    };
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        busyRef.current ||
        !container.current?.contains(window.document.activeElement) ||
        (event.target instanceof Element &&
          event.target.closest("input,textarea,select,[contenteditable=true]"))
      )
        return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        state.undo(event.shiftKey);
      }
      if (modifier && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelected(new Set(current.current.nodes.map((node) => node.id)));
      }
      if (modifier && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicate();
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        remove();
      }
      if (event.key === "Escape") {
        setSelected(new Set());
        setEdgeId(undefined);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected, edgeId]);
  async function savePanel(panel: StudioStoryboardPanel) {
    const fresh = await loadStudioStoryboard(projectId, episodeId);
    const existing = fresh.storyboard?.panels.find(
      (item) => item.id === panel.id,
    );
    if (
      !fresh.storyboard ||
      !existing ||
      existing.updatedAt !== panel.updatedAt
    )
      throw new Error("镜头已更新，请重新打开编辑");
    const saved = await saveStudioStoryboard(projectId, episodeId, {
      expectedVersion: fresh.storyboard.version,
      status: fresh.storyboard.status,
      sourceHash: fresh.storyboard.sourceHash,
      panels: fresh.storyboard.panels.map((item) =>
        item.id === panel.id ? panel : item,
      ),
    });
    setStoryboard(saved);
    replace({
      ...current.current,
      nodes: current.current.nodes.map((node) =>
        node.panelId === panel.id
          ? {
              ...node,
              text: panel.imagePrompt ?? panel.description ?? "",
              videoText: panel.videoPrompt ?? "",
              panelPromptBase: {
                image: panel.imagePrompt ?? panel.description ?? "",
                video: panel.videoPrompt ?? "",
              },
            }
          : node,
      ),
    });
    await onRefresh();
  }
  async function setAssetBaseline(entityId: string) {
    if (!active || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const fresh = await loadStudioAssetCatalog(projectId, undefined, true);
      const target = canvasBaselineTargets(active, current.current, fresh, panels)
        .find((item) => item.entity.id === entityId);
      if (!target) throw new Error(locale === "en" ? "This image is no longer an asset candidate" : "此图片已不在资产候选中，请刷新后重试");
      await selectStudioAsset(projectId, {
        targetType: target.entity.kind,
        targetId: target.entity.kind === "prop" ? target.entity.id : target.candidate.id,
        assetId: target.entity.kind === "prop" ? target.candidate.assetId ?? undefined : undefined,
      });
      setCatalog(await loadStudioAssetCatalog(projectId));
      await onRefresh();
      toast.success(locale === "en" ? "Asset baseline updated" : "已设为资产基准");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "设置基准失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function applyMedia() {
    if (!active?.panelId) return;
    const media = nodeMedia(active, catalog, panels, current.current);
    if (!media || !["image", "video"].includes(media.kind)) {
      toast.error("请选择图片或视频结果");
      return;
    }
    try {
      await selectStudioPanelMedia(
        projectId,
        active.panelId,
        media.id,
        media.kind as "image" | "video",
      );
      setStoryboard(await loadStudioStoryboard(projectId, episodeId));
      await onRefresh();
      toast.success("已选入正式镜头");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "回填失败");
    }
  }
  async function reviewLipSync() {
    if (!active?.panelId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (!(await state.save())) throw new Error("请先保存画布");
      const inputs = compileCanvasInput(
        current.current,
        active,
        "video",
      ).inputs.filter((item) => item.purpose === "dialogue");
      if (inputs.length !== 1) throw new Error("请连接一条台词音频");
      const source = inputs[0].source;
      if (!source.assetId || !source.entityId)
        throw new Error("请从本集配音结果添加音频，并关联对应台词");
      const [production, fresh] = await Promise.all([
        loadStudioProductionData(projectId, episodeId),
        loadStudioStoryboard(projectId, episodeId),
      ]);
      const line = production.voiceLines.find(
        (line) => line.id === source.entityId,
      );
      const panel = fresh.storyboard?.panels.find(
        (panel) => panel.id === active.panelId,
      );
      if (
        !line ||
        !panel ||
        line.delivery !== "dialogue" ||
        line.matchedPanelId !== panel.id ||
        line.audioAssetId !== source.assetId ||
        panel.speakingCharacter !== line.speaker ||
        panel.lipSyncText !== line.content
      )
        throw new Error(
          "音频、台词或说话人与镜头不一致，请在声音工作台重新确认",
        );
      if (!panel.videoAssetId) throw new Error("请先生成并选入镜头视频");
      if (!lipSyncModels.length) throw new Error("请先配置口型模型");
      setLipModelId(lipSyncModels[0].id);
      setLipReview({
        nodeId: active.id,
        panelId: panel.id,
        voiceLineId: line.id,
        audioAssetId: source.assetId,
        speaker: line.speaker,
        content: line.content,
        audioUrl:
          catalog?.assets.find((asset) => asset.id === source.assetId)?.url ??
          undefined,
        audioDuration: line.durationSeconds,
        videoDuration: panel.durationSeconds ?? null,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "口型审核失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function submitLipSync() {
    const model = lipSyncModels.find((item) => item.id === lipModelId);
    if (!lipReview || !model || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const node = current.current.nodes.find(
        (node) => node.id === lipReview.nodeId,
      );
      if (
        !node ||
        node.panelId !== lipReview.panelId ||
        !compileCanvasInput(current.current, node, "video").inputs.some(
          (item) =>
            item.purpose === "dialogue" &&
            item.source.assetId === lipReview.audioAssetId &&
            item.source.entityId === lipReview.voiceLineId,
        )
      )
        throw new Error("连线已修改，请重新审核");
      await generateStudioLipSync(projectId, episodeId, {
        channelId: model.channelId,
        model: model.modelId,
        panelId: lipReview.panelId,
        audioAssetId: lipReview.audioAssetId,
        voiceLineId: lipReview.voiceLineId,
      });
      setLipReview(undefined);
      await onRefresh();
      toast.success("口型任务已提交");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "口型提交失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function startReview() {
    if (busyRef.current) return;
    const nodes = current.current.nodes.filter(
      (node) =>
        selected.has(node.id) &&
        ["panel", "image", "video"].includes(node.kind),
    );
    if (!nodes.length) {
      toast.error("请选择需要生成的图片、视频或镜头");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setReview([]);
    setReviewError(undefined);
    setReviewPreparing(true);
    setReviewOpen(true);
    try {
      if (!(await state.save())) throw new Error("请先保存画布再审核");
      const items = await Promise.all(nodes.map(async (node): Promise<Review> => {
        const kind =
          node.outputKind ?? (node.kind === "video" ? "video" : "image");
        const model =
          modelList(node).find((item) => item.id === node.modelId) ??
          modelList(node)[0];
        const compiled = compileCanvasInput(current.current, node, kind);
        const item: Review = {
          node,
          model,
          prompt: compiled.prompt,
          inputSignature: JSON.stringify(compiled.inputs),
          references: compiled.inputs.map(
            (input) =>
              `${edgeLabel(input.edge, input.source, locale)} · ${input.source.title}`,
          ),
          key: crypto.randomUUID(),
          status: "待确认",
        };
        if (!model) item.error = "请配置生成模型";
        else try {
          const response = await fetch(url + "/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nodeId: node.id,
              revision: state.revision.current,
              kind,
              channelId: model.channelId,
              model: model.modelId,
              idempotencyKey: item.key,
              preview: true,
            }),
          });
          const data = await response.json();
          if (!response.ok) item.error = data.message ?? "审核失败";
          else {
            item.finalPrompt = data.preview?.finalPrompt ?? data.prompt;
            item.configurationHash = data.preview?.configurationHash ?? data.configurationHash;
            item.requestHash = data.preview?.requestHash ?? data.requestHash;
            item.productionParameters = data.preview?.parameters ?? data.parameters;
            const capabilities = data.preview?.capabilities ?? data.capabilities;
            if (capabilities) item.references.push(locale === "en" ? `Native audio: ${capabilities.nativeAudio}; audio control: ${capabilities.audioControl}; reference audio limit: ${capabilities.maxReferenceAudios}. Exact speech, voice and subtitles are prompt constraints.` : `原生声音：${capabilities.nativeAudio === "supported" ? "支持" : capabilities.nativeAudio === "unsupported" ? "不支持" : "未知"}；音频控制：${capabilities.audioControl === "native_parameter" ? "原生参数" : "提示词约束"}；参考音频上限：${capabilities.maxReferenceAudios}。精确台词、音色与字幕为提示词要求。`);
            if (data.issues?.length) item.references.push(...data.issues.map((issue: { message: string }) => issue.message));
            if (data.preview?.sources)
              item.references.push(
                ...data.preview.sources
                  .filter((source: { key: string }) =>
                    [
                      "frame_mode",
                      "canvas_references",
                      "asset_references",
                      "segments",
                      "output",
                    ].includes(source.key),
                  )
                  .map(
                    (source: { label: string; value: string }) =>
                      `${source.label}：${source.value}`,
                  ),
              );
          }
        } catch (error) {
          item.error = error instanceof Error ? error.message : "审核失败";
        }
        return item;
      }));
      setReview(items);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "审核失败");
    } finally {
      setReviewPreparing(false);
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function submitReview() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const pending = review.filter(
        (item) => item.status !== "已提交" && !item.error,
      );
      if (!pending.length) return;
      const captured = current.current;
      for (const item of pending) {
        const live = captured.nodes.find((node) => node.id === item.node.id);
        if (!live || JSON.stringify(live) !== JSON.stringify(item.node))
          throw new Error("节点已修改，请重新审核");
        const compiled = compileCanvasInput(
          captured,
          live,
          live.outputKind ?? (live.kind === "video" ? "video" : "image"),
        );
        if (
          compiled.prompt !== item.prompt ||
          JSON.stringify(compiled.inputs) !== item.inputSignature
        )
          throw new Error("引用内容已变化，请重新审核");
      }
      replace({
        ...captured,
        nodes: captured.nodes.map((node) => {
          const item = pending.find((item) => item.node.id === node.id);
          if (!item) return node;
          const kind =
            node.outputKind ?? (node.kind === "video" ? "video" : "image");
          return {
            ...node,
            promptVersions: [
              ...(node.promptVersions ?? []),
              {
                id: crypto.randomUUID(),
                kind,
                prompt:
                  kind === "video" ? (node.videoText ?? node.text) : node.text,
                createdAt: new Date().toISOString(),
              },
            ].slice(-12),
          };
        }),
      });
      if (!(await state.save())) throw new Error("画布保存失败，任务未提交");
      setReview((previous) =>
        previous.map((item) => ({
          ...item,
          node:
            current.current.nodes.find((node) => node.id === item.node.id) ??
            item.node,
        })),
      );
      let submissionFailures = 0;
      for (const item of pending) {
        try {
          const kind =
            item.node.outputKind ??
            (item.node.kind === "video" ? "video" : "image");
          const response = await fetch(url + "/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nodeId: item.node.id,
              revision: state.revision.current,
              kind,
              channelId: item.model!.channelId,
              model: item.model!.modelId,
              idempotencyKey: item.key,
              previewConfigurationHash: item.configurationHash,
              previewRequestHash: item.requestHash,
            }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.message ?? "提交失败");
          setReview((previous) =>
            previous.map((entry) =>
              entry.key === item.key ? { ...entry, status: "已提交" } : entry,
            ),
          );
        } catch (error) {
          submissionFailures++;
          setReview((previous) =>
            previous.map((entry) =>
              entry.key === item.key
                ? {
                    ...entry,
                    status: "提交失败",
                    error: error instanceof Error ? error.message : "提交失败",
                  }
                : entry,
            ),
          );
        }
      }
      if (!submissionFailures && pending.length + review.filter(item => item.status === "已提交").length === review.length) {
        setReviewOpen(false);
        toast.success(t("生成任务已提交", "Generation tasks submitted"));
      }
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function showEpisodeStart(source: CanvasDocument) {
    if (source.nodes.length <= 8) {
      fit(source);
      return;
    }
    const firstPanel = [...panels].sort((a, b) => a.panelIndex - b.panelIndex)[0];
    const firstNode = source.nodes.find(node => node.kind === "panel" && node.panelId === firstPanel?.id);
    if (!firstNode) {
      fit(source);
      return;
    }
    const firstOutput = source.nodes.filter(node => ["image", "video"].includes(node.kind) && source.edges.some(edge => edge.from === firstNode.id && edge.to === node.id)).sort((a, b) => a.x - b.x)[0];
    const firstBranch = [firstNode, ...(firstOutput ? [firstOutput] : [])];
    const section = source.branchGroups?.find(group => group.nodeIds.includes(firstNode.id));
    const minX = Math.min(...firstBranch.map(node => node.x));
    const minY = Math.min(section?.y ?? firstNode.y, ...firstBranch.map(node => node.y));
    const width = Math.max(...firstBranch.map(node => node.x + CARD_WIDTH)) - minX;
    const height = Math.max(...firstBranch.map(node => node.y + CARD_HEIGHT)) - minY;
    const rect = container.current?.getBoundingClientRect();
    const k = Math.max(0.2, Math.min(0.75, ((rect?.width ?? 900) - 48) / width, ((rect?.height ?? 600) - 48) / height));
    replace({ ...source, viewport: { x: 24 - minX * k, y: 24 - minY * k, k } }, false);
  }

  function fit(source: CanvasDocument = current.current) {
    if (!source.nodes.length) return;
    const items = [
      ...source.nodes.filter(node => showReusableBranches || selected.has(node.id) || !isReusableCanvasBranch(node, source, catalog, snapshot.tasks)),
      ...(source.layoutMode === "branches" ? (source.branchGroups ?? []) : []),
    ];
    if (!items.length) return;
    const minX = Math.min(...items.map((n) => n.x)),
      minY = Math.min(...items.map((n) => n.y));
    const w = Math.max(...items.map((n) => n.x + CARD_WIDTH)) - minX,
      h = Math.max(...items.map((n) => n.y + CARD_HEIGHT)) - minY;
    const rect = container.current?.getBoundingClientRect();
    const k = Math.max(
      0.05,
      Math.min(
        1,
        ((rect?.width ?? 900) - 80) / w,
        ((rect?.height ?? 600) - 80) / h,
      ),
    );
    replace(
      {
        ...source,
        viewport: {
          x: ((rect?.width ?? 900) - w * k) / 2 - minX * k,
          y: ((rect?.height ?? 600) - h * k) / 2 - minY * k,
          k,
        },
      },
      false,
    );
  }
  function showBranches() {
    const arranged = arrangeEpisodeBranches(current.current, panels, locale);
    if (arranged.nodes.length > 0 && arranged.nodes.length <= 8) {
      replace(arranged);
      fit(arranged);
      return;
    }
    const firstGroup = arranged.branchGroups?.[0];
    const firstNodes = arranged.nodes.filter((node) =>
      firstGroup?.nodeIds.includes(node.id),
    );
    const top = Math.min(
      firstGroup?.y ?? 40,
      ...firstNodes.map((node) => node.y),
    );
    replace({ ...arranged, viewport: { x: 24, y: 24 - top * 0.75, k: 0.75 } });
  }
  function exportDocument() {
    const blob = new Blob([JSON.stringify(current.current, null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = href;
    link.download = `canvas-${episodeId}.json`;
    link.click();
    URL.revokeObjectURL(href);
  }
  async function importFiles(files: File[]) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      for (const file of files) {
        const kind = file.type.startsWith("image/")
          ? "image"
          : file.type.startsWith("video/")
            ? "video"
            : file.type.startsWith("audio/")
              ? "audio"
              : undefined;
        if (!kind) {
          toast.error(`${file.name}：仅支持图片、视频和音频`);
          continue;
        }
        const form = new FormData();
        form.set("file", file);
        form.set("kind", kind);
        form.set("targetType", "project");
        form.set("targetId", projectId);
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/assets/upload`,
          { method: "POST", body: form },
        );
        const data = await response.json();
        if (!response.ok) {
          toast.error(`${file.name}：${data.message ?? "导入失败"}`);
          continue;
        }
        const position = newNodePosition(),
          node: CanvasCard = {
            id: crypto.randomUUID(),
            kind,
            title: file.name,
            text: "",
            assetId: data.asset.id,
            ...position,
          };
        replace({
          ...current.current,
          nodes: [...current.current.nodes, node],
        });
        choose(node.id);
      }
      setCatalog(await loadStudioAssetCatalog(projectId));
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (uploadInput.current) uploadInput.current.value = "";
    }
  }
  const toolbarProps: CanvasToolbarProps = {
    episodes: snapshot.project.episodes,
    episodeId,
    onSelectEpisode,
    locale,
    tool,
    busy,
    saving: state.saving,
    dirty: state.dirty,
    saveError: state.saveError,
    nodeCount: visibleNodes.length,
    reusableBranchCount: reusableIds.size,
    showReusableBranches,
    onToggleReusableBranches: () => setShowReusableBranches(value => !value),
    selectedCount: selected.size,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    outlineOpen,
    libraryOpen: library,
    canAssembleEpisodeGraph: panels.length > 0,
    freeLayout: document.layoutMode === "free",
    contextualAssetLinks: document.layoutMode === "episode",
    onTool: setTool,
    onCreate: create,
    onOutline: () => setOutlineOpen(!outlineOpen),
    onLibrary: () => setLibrary(!library),
    onImport: () => uploadInput.current?.click(),
    onUndo: () => state.undo(),
    onRedo: () => state.undo(true),
    onDuplicate: duplicate,
    onFree: () =>
      replace({
        ...current.current,
        layoutMode: "free",
        branchGroups: undefined,
      }),
    onFit: () => fit(),
    onExport: exportDocument,
    onSave: () => void state.save(),
    onReview: () => void startReview(),
    onAssembleEpisodeGraph: assembleEpisodeGraph,
  };
  if (state.loading || state.error)
    return (
      <div className="p-6 text-sm">
        {state.error || t("加载画布…", "Loading canvas…")}
      </div>
    );
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {editingPanel && (
        <PanelEditorDialog
          key={editingPanel.id}
          locale={locale}
          panel={editingPanel}
          onSave={savePanel}
          open
          showTrigger={false}
          onOpenChange={(open) => {
            if (!open) setEditingPanelId(undefined);
          }}
        />
      )}
      <CanvasHeader {...toolbarProps} />
      <input
        ref={uploadInput}
        hidden
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        onChange={(event) =>
          void importFiles(Array.from(event.target.files ?? []))
        }
      />
      {state.saveError && (
        <div
          role="alert"
          className="border-b bg-destructive/5 px-4 py-2 text-xs text-destructive"
        >
          {state.saveError} ·{" "}
          {t("请保存或导出备份后再离开", "Save or export before leaving")}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {library && (
          <CanvasLibrary
            catalog={catalog}
            panels={panels}
            locale={locale}
            onAdd={addNode}
            onClose={() => setLibrary(false)}
          />
        )}
        {!library && outlineOpen && (
          <CanvasOutline
            document={{ ...document, nodes: visibleNodes, edges: document.edges.filter(edge => !hiddenIds.has(edge.from) && !hiddenIds.has(edge.to)) }}
            selected={selected}
            locale={locale}
            onSelect={(id) => {
              const node = current.current.nodes.find((item) => item.id === id);
              if (!node) return;
              choose(id);
              locate(node);
            }}
          />
        )}
        <div className="relative min-h-0 min-w-0 flex-1">
          <CanvasViewport
            containerRef={container}
            viewport={document.viewport}
            tool={tool}
            onCanvasDeselect={() => {
              if (busyRef.current) return;
              setSelected(new Set());
              setEdgeId(undefined);
            }}
            onViewportChange={(viewport) => {
              if (!busyRef.current)
                replace({ ...current.current, viewport }, false);
            }}
            onCanvasMouseDown={(event) => {
              if (busyRef.current) return;
              setEdgeId(undefined);
              if (!event.shiftKey) setSelected(new Set());
              gesture.current = {
                startX: event.clientX,
                startY: event.clientY,
                origin: point(event.clientX, event.clientY),
                add: event.shiftKey,
                moved: false,
              };
            }}
            onCanvasDoubleClick={(event) => {
              if (!busyRef.current)
                create("text", point(event.clientX, event.clientY));
            }}
            onDrop={(event) => {
              event.preventDefault();
              void importFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <svg
              className="absolute left-0 top-0 overflow-visible"
              width="1"
              height="1"
            >
              <defs>
                <marker
                  id={arrowId}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M 1 1 L 9 5 L 1 9"
                    fill="none"
                    stroke="context-stroke"
                    strokeWidth="1.5"
                  />
                </marker>
              </defs>
              {document.layoutMode === "branches" &&
                document.branchGroups?.flatMap((group) =>
                  group.nodeIds.map((id) => {
                    const node = document.nodes.find((item) => item.id === id);
                    if (!node) return null;
                    const branch = canvasBranchPath(
                      group.x + 240,
                      group.y + PORT_Y,
                      node.x,
                      node.y + PORT_Y,
                    );
                    return (
                      <path
                        key={`${group.id}-${id}`}
                        d={branch.path}
                        fill="none"
                        stroke="var(--muted-foreground)"
                        strokeOpacity={0.4}
                        strokeWidth={2}
                        strokeDasharray="6 5"
                        className="pointer-events-none"
                      />
                    );
                  }),
                )}
              {document.edges.map((edge) => {
                if (hiddenIds.has(edge.from) || hiddenIds.has(edge.to)) return null;
                const from = document.nodes.find((n) => n.id === edge.from),
                  to = document.nodes.find((n) => n.id === edge.to);
                if (!from || !to) return null;
                const episode = document.layoutMode === "episode";
                const assetReference = episode && edge.purpose === "story_asset" && to.kind === "panel";
                if (assetReference && edgeId !== edge.id && !selected.has(from.id) && !selected.has(to.id)) return null;
                const sequence = episode && ["shot_sequence", "causality", "episode_bridge"].includes(edge.purpose ?? "");
                const output = episode && (to.episodeLayer === "shot_video" || to.episodeLayer === "asset_image" ||
                  (from.kind === "panel" && ["image", "video", "audio"].includes(to.kind)));
                const verticalEpisodeEdge =
                  document.layoutMode === "episode" && document.episodeLayoutVersion !== EPISODE_CANVAS_LAYOUT_VERSION &&
                  ((edge.purpose === "story_asset" &&
                    ((Boolean(to.panelId) && from.y >= to.y + CARD_HEIGHT) ||
                      to.episodeLayer === "asset_image")) ||
                    edge.purpose === "shot_video" ||
                    (from.kind === "panel" && to.episodeLayer === "shot_video") ||
                    (["character", "location", "prop"].includes(from.kind) && to.episodeLayer === "asset_image"));
                const branch = sequence && document.episodeLayoutVersion === EPISODE_CANVAS_LAYOUT_VERSION
                  ? canvasEpisodeSequencePath(from, to)
                  : output && document.episodeLayoutVersion === EPISODE_CANVAS_LAYOUT_VERSION
                  ? canvasEpisodeOutputPath(from, to)
                  : verticalEpisodeEdge
                  ? (() => {
                      const downToImage = to.episodeLayer === "asset_image";
                      const x = from.x + CARD_WIDTH / 2;
                      const y = downToImage ? from.y + CARD_HEIGHT : from.y;
                      const tx = to.x + CARD_WIDTH / 2;
                      const ty = downToImage ? to.y : to.y + CARD_HEIGHT;
                      const middleY = (y + ty) / 2;
                      return {
                        path: `M ${x} ${y} C ${x} ${middleY}, ${tx} ${middleY}, ${tx} ${ty}`,
                        labelX: (x + tx) / 2,
                        labelY: middleY - 12,
                      };
                    })()
                  : canvasBranchPath(
                      from.x + CARD_WIDTH,
                      from.y + PORT_Y,
                      to.x,
                      to.y + PORT_Y,
                    );
                const d = branch.path;
                return (
                  <g
                    key={edge.id}
                    data-connection-id={edge.id}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => {
                      setSelected(new Set());
                      setEdgeId(edge.id);
                    }}
                  >
                    <path
                      d={d}
                      fill="none"
                      stroke={
                        edgeId === edge.id
                          ? "var(--primary)"
                          : edge.purpose === "causality" || edge.purpose === "shot_sequence" ||
                              edge.purpose === "episode_bridge"
                            ? "var(--primary)"
                            : "var(--muted-foreground)"
                      }
                      strokeWidth={
                        edgeId === edge.id
                          ? 3
                          : edge.purpose === "causality" || edge.purpose === "shot_sequence" ||
                              edge.purpose === "episode_bridge"
                            ? 2.5
                            : 1.5
                      }
                      strokeDasharray={
                        edge.purpose === "story_asset" ? "6 5" : undefined
                      }
                      markerEnd={`url(#${arrowId})`}
                    />
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={18}
                      className="cursor-pointer"
                    />
                    {(edgeId === edge.id || (!verticalEpisodeEdge &&
                      !(
                        document.layoutMode === "episode" &&
                        ["causality", "shot_sequence", "story_asset"].includes(
                          edge.purpose ?? "",
                        )
                      ))) && (
                      <text
                        x={branch.labelX}
                        y={branch.labelY}
                        textAnchor="middle"
                        fill="var(--muted-foreground)"
                        fontSize={12}
                        paintOrder="stroke"
                        stroke="var(--background)"
                        strokeWidth={5}
                        strokeLinejoin="round"
                      >
                        {edgeLabel(edge, from, locale)}
                      </text>
                    )}
                  </g>
                );
              })}
              {connections.source &&
                connections.cursor &&
                (() => {
                  const from = document.nodes.find(
                    (n) => n.id === connections.source,
                  );
                  if (!from) return null;
                  return (
                    <path
                      d={`M ${from.x + CARD_WIDTH} ${from.y + PORT_Y} L ${connections.cursor.x} ${connections.cursor.y}`}
                      stroke="var(--primary)"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                    />
                  );
                })()}
            </svg>
            {document.layoutMode === "episode" &&
              document.branchGroups?.map(group => (
                <button
                  key={group.id}
                  type="button"
                  className="absolute flex h-12 items-center justify-between gap-4 border-b px-1 text-left text-sm font-semibold text-foreground"
                  style={{ left: group.x, top: group.y, width: Math.max(CARD_WIDTH, ...document.nodes.filter(node => group.nodeIds.includes(node.id)).map(node => node.x + CARD_WIDTH - group.x)) }}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={() => { setEdgeId(undefined); setSelected(new Set(group.nodeIds)); }}
                >
                  <span className="truncate">{group.label}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">{group.nodeIds.length}{t(" 个节点", " nodes")}</span>
                </button>
              ))}
            {document.layoutMode === "branches" &&
              document.branchGroups?.map((group) => {
                const members = document.nodes.filter((node) =>
                  group.nodeIds.includes(node.id),
                );
                if (!members.length) return null;
                return (
                  <button
                    key={group.id}
                    type="button"
                    data-node-id={group.id}
                    className="absolute flex h-24 w-60 flex-col justify-center gap-2 rounded-xl border bg-card px-4 text-left shadow-sm hover:border-primary focus-visible:ring-2 focus-visible:ring-primary"
                    style={{ left: group.x, top: group.y + PORT_Y - 48 }}
                    title={t(
                      "分组线表示镜头归属，不作为生成参考",
                      "Grouping lines organize shots; they are not generation inputs",
                    )}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => {
                      setEdgeId(undefined);
                      setSelected(new Set(members.map((node) => node.id)));
                    }}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{group.label}</span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {members[0].title}
                      {members.length > 1
                        ? ` — ${members[members.length - 1].title}`
                        : ""}{" "}
                      · {members.length}
                      {t(" 个节点", " nodes")}
                    </span>
                  </button>
                );
              })}
            {visibleNodes.map((node) => (
              <CanvasNode
                key={node.id}
                node={node}
                summary={canvasCardSummary(node, catalog, panels, locale, document)}
                durationSeconds={panels.find(panel => panel.id === (node.panelId ?? document.nodes.find(source => source.kind === "panel" && document.edges.some(edge => edge.from === source.id && edge.to === node.id))?.panelId))?.durationSeconds}
                usageCount={["character", "location", "prop"].includes(node.kind)
                  ? panels.filter(panel => node.kind === "character" ? panel.characters.includes(node.title) : node.kind === "location" ? panel.locationName === node.title : panel.props.includes(node.title)).length
                  : undefined}
                linkedPrompt={
                  linkedCanvasAsset(node, catalog)?.generationPrompt
                }
                inputs={document.edges
                  .filter((edge) => edge.to === node.id)
                  .map(
                    (edge) =>
                      document.nodes.find((item) => item.id === edge.from)
                        ?.title,
                  )
                  .filter((title): title is string => !!title)}
                media={nodeMedia(node, catalog, panels, document)}
                task={canvasNodeTask(node, snapshot.tasks, catalog, document)}
                imageAvailability={canvasImageAvailability(node, catalog, document, locale)}
                selected={selected.has(node.id)}
                connecting={connections.source === node.id}
                target={connections.target === node.id}
                locale={locale}
                onSelect={(add) => choose(node.id, add)}
                onDrag={(event) => dragNode(node, event)}
                onConnect={(event) => connections.begin(node.id, event)}
                onComplete={() => connections.complete(node.id)}
                busy={busy}
                onBranch={(kind) => createBranch(node, kind)}
              />
            ))}
            {marquee && (
              <div
                className="pointer-events-none absolute border border-primary bg-primary/10"
                style={{
                  left: marquee.x,
                  top: marquee.y,
                  width: marquee.w,
                  height: marquee.h,
                }}
              />
            )}
          </CanvasViewport>
          {!document.nodes.length && !library && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="pointer-events-auto max-w-md rounded-2xl border bg-background p-6 text-center shadow-sm">
                <h2 className="font-medium">
                  {t("开始创作这一集", "Create this episode")}
                </h2>
                <p className="my-3 text-sm text-muted-foreground">
                  {t(
                    "添加角色和场景，连到镜头；生成后选入制作流程。",
                    "Connect assets to shots, generate, and select results for production.",
                  )}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="outline" onClick={() => create("image")}>
                    {t("图片", "Image")}
                  </Button>
                  <Button variant="outline" onClick={() => create("video")}>
                    {t("视频", "Video")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => onOpenStage("audio")}
                  >
                    {t("音频", "Audio")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => onOpenStage("writing")}
                  >
                    {t("剧本", "Script")}
                  </Button>
                  <Button onClick={() => setLibrary(true)}>
                    {t("添加项目镜头与素材", "Add project assets")}
                  </Button>
                </div>
              </div>
            </div>
          )}
          <CanvasDock {...toolbarProps} />
          <p className="pointer-events-none absolute bottom-1 left-3 text-[10px] text-muted-foreground">
            {t(
              "左键拖动画布 · 滚轮缩放 · 选择工具框选",
              "Left drag to pan · Wheel zoom · Select tool to marquee",
            )}{" "}
            · {Math.round(document.viewport.k * 100)}%
          </p>
        </div>
        {(active || activeEdge) && (
          <CanvasInspector
            node={active}
            edge={activeEdge}
            document={document}
            catalog={catalog}
            panels={panels}
            models={active ? modelList(active) : []}
            locale={locale}
            busy={busy}
            onPatch={patch}
            onBranch={(kind) => active && createBranch(active, kind)}
            onSelectNode={(id) => {
              const node = current.current.nodes.find((item) => item.id === id);
              if (node) {
                choose(id);
                locate(node);
              }
            }}
            onEdge={(purpose) => {
              if (!activeEdge || busyRef.current) return;
              const error = validateEdge(
                activeEdge.from,
                activeEdge.to,
                purpose,
                activeEdge.id,
              );
              if (error) {
                toast.error(error);
                return;
              }
              replace({
                ...current.current,
                edges: current.current.edges.map((edge) =>
                  edge.id === activeEdge.id ? { ...edge, purpose } : edge,
                ),
              });
            }}
            onRemove={remove}
            onClose={() => {
              setSelected(new Set());
              setEdgeId(undefined);
            }}
            onReview={() => void startReview()}
            onOpenPanel={onOpenPanel}
            onSavePanel={savePanel}
            onApplyMedia={() => void applyMedia()}
            onSetBaseline={(entityId) => void setAssetBaseline(entityId)}
            onOpenAssets={onOpenStage}
            onLipSync={() => void reviewLipSync()}
          />
        )}
      </div>
      <Dialog
        open={reviewOpen}
        onOpenChange={(open) => {
          if (!busy) setReviewOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogTitle>{t("生成前审核", "Review generation")}</DialogTitle>
          <DialogDescription>
            {t(
              "确认保存的提示词、模型和输入。视频同步生成对白、画外音、心声和场景声音，字幕在项目后期合成。",
              "Review saved prompts and inputs. Generate dialogue, voiceover, inner monologue and scene sound with the video; compose subtitles in post.",
            )}
          </DialogDescription>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            {reviewPreparing ? (
              <div role="status" className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                {t("正在保存画布并加载审核内容…", "Saving canvas and loading review…")}
              </div>
            ) : null}
            {reviewError ? <p role="alert" className="text-sm text-destructive">{reviewError}</p> : null}
            {review.map((item) => (
              <section key={item.key} className="rounded-lg border p-3">
                <div className="flex justify-between font-medium">
                  <span>{item.node.title}</span>
                  <span className="text-xs">{item.status}</span>
                </div>
                <p className="my-2 text-xs text-muted-foreground">
                  {t("模型：", "Model: ")}
                  {item.model ? getStudioModelName(item.model) : t("未配置模型", "No model configured")}
                  {item.model?.channelName.trim() ? ` · ${item.model.channelName.trim()}` : ""}
                </p>
                <p className="text-xs">
                  {t("输入：", "Inputs: ")}
                  {item.references.join(" / ") ||
                    t(
                      "没有画布连线输入；关联镜头仍会使用制作流程中的默认参考。",
                      "No canvas inputs; linked shots use their production references.",
                    )}
                </p>
                <details className="mt-2" open>
                  <summary className="cursor-pointer text-xs">
                    {t("实际提示词", "Submitted prompt")}
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-6">
                    {item.finalPrompt ?? item.prompt}
                  </p>
                </details>
                {item.productionParameters ? <details className="mt-2"><summary className="cursor-pointer rounded py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">{locale === "en" ? "Actual request parameters" : "实际请求参数"}</summary><pre className="mt-2 whitespace-pre-wrap break-all rounded-md border p-3 text-xs">{JSON.stringify(item.productionParameters, null, 2)}</pre></details> : null}
                {item.error && (
                  <p role="alert" className="mt-2 text-xs text-destructive">
                    {item.error}
                  </p>
                )}
                {item.status === "提交失败" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      setReview((previous) =>
                        previous.map((entry) =>
                          entry.key === item.key
                            ? { ...entry, error: undefined, status: "待确认" }
                            : entry,
                        ),
                      )
                    }
                  >
                    {t("重试此项", "Retry item")}
                  </Button>
                )}
              </section>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setReviewOpen(false)}
            >
              {t("关闭", "Close")}
            </Button>
            <Button
              disabled={
                busy ||
                !review.some((item) => item.status === "待确认" && !item.error)
              }
              onClick={() => void submitReview()}
            >
              {reviewPreparing
                ? t("审核准备中…", "Preparing review…")
                : busy
                ? t("提交中…", "Submitting…")
                : t("确认生成", "Confirm generation")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!lipReview}
        onOpenChange={(open) => {
          if (!open && !busy) setLipReview(undefined);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{t("确认配音与口型", "Confirm lip sync")}</DialogTitle>
          <DialogDescription>
            {t(
              "只让指定角色说这句台词，其他角色保持沉默。",
              "Only the selected speaker delivers this dialogue.",
            )}
          </DialogDescription>
          <p className="whitespace-pre-wrap">
            {lipReview?.speaker}：{lipReview?.content}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("配音时长", "Audio duration")} {lipReview?.audioDuration ?? "—"}s
            · {t("镜头时长", "Shot duration")} {lipReview?.videoDuration ?? "—"}
            s
          </p>
          {lipReview?.audioDuration &&
            lipReview.videoDuration &&
            lipReview.audioDuration > lipReview.videoDuration && (
              <p className="text-xs text-destructive">
                {t(
                  "配音长于镜头，请先调整镜头时长，避免台词截断。",
                  "Audio exceeds the shot duration. Adjust the shot before generating.",
                )}
              </p>
            )}
          {lipReview?.audioUrl && <audio controls src={lipReview.audioUrl} />}
          <NativeSelect
            aria-label={t("口型模型", "Lip sync model")}
            disabled={busy}
            value={lipModelId}
            onChange={(event) => setLipModelId(event.target.value)}
            className="h-9 rounded border bg-background px-2"
          >
            {lipSyncModels.map((model) => (
              <NativeSelectOption key={model.id} value={model.id}>
                {getStudioModelName(model)}{model.channelName.trim() ? ` · ${model.channelName.trim()}` : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onOpenStage("audio")}
            >
              {t("去声音工作台调整", "Edit audio")}
            </Button>
            <Button
              disabled={
                busy ||
                !!(
                  lipReview?.audioDuration &&
                  lipReview.videoDuration &&
                  lipReview.audioDuration > lipReview.videoDuration
                )
              }
              onClick={() => void submitLipSync()}
            >
              {t("确认生成口型", "Generate lip sync")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
