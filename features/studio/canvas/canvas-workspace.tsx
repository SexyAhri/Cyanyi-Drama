"use client";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { GitBranch } from "lucide-react";
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
import { useCanvasConnections } from "./use-canvas-connections";
import { useCanvasDocument } from "./use-canvas-document";
import {
  arrangeEpisodeBranches,
  canvasBranchPath,
  mergeCanvasBranchGroups,
} from "./canvas-layout";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  PORT_Y,
  edgeLabel,
  nodeMedia,
  panelCard,
  kindLabel,
  canvasSelection,
  linkedCanvasAsset,
} from "./canvas-view-model";
import type { CanvasCard, CanvasDocument, CanvasPurpose } from "./types";

type Review = {
  node: CanvasCard;
  model?: StudioModelOption;
  prompt: string;
  finalPrompt?: string;
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
}) {
  const url = `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/canvas`;
  const state = useCanvasDocument(url);
  const { document, current, replace } = state;
  const arrowId = `canvas-arrow-${useId().replace(/:/g, "")}`;
  const [catalog, setCatalog] = useState<ProjectAssetCatalog>();
  const [storyboard, setStoryboard] = useState<StudioStoryboardData>();
  const panels = storyboard?.storyboard?.panels ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edgeId, setEdgeId] = useState<string>();
  const [editingPanelId, setEditingPanelId] = useState<string>();
  const editingPanel = panels.find((panel) => panel.id === editingPanelId);
  const [tool, setTool] = useState<"select" | "pan">("pan");
  const [library, setLibrary] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [review, setReview] = useState<Review[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
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
    const position = center();
    const next = {
      ...card,
      x: position.x - CARD_WIDTH / 2,
      y: position.y - CARD_HEIGHT / 2,
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
    if (reveal) locate(current.current.nodes.find((node) => node.id === next.id)!);
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
    const media = nodeMedia(source, catalog, panels);
    if (source.kind !== "text" && media?.kind !== "image") {
      toast.error(
        t(
          "请先为源节点选择一个图片版本，再创建分支",
          "Choose an image version for this node before branching",
        ),
      );
      return;
    }
    const pinned =
      media?.kind === "image" ? { ...source, assetId: media.id } : source;
    const assetPrompt = linkedCanvasAsset(source, catalog)?.generationPrompt;
    const target: CanvasCard = {
      id: crypto.randomUUID(),
      kind,
      outputKind: kind,
      title: `${source.title} · ${kindLabel(kind, locale)}`.slice(0, 300),
      text:
        kind === "image"
          ? assetPrompt
            ? [assetPrompt, source.text]
                .filter(Boolean)
                .join("\n\n")
                .slice(0, 30000)
            : source.kind === "text"
              ? ""
              : source.text
          : "",
      videoText: kind === "video" ? (source.videoText ?? "") : "",
      x: source.x + CARD_WIDTH + 180,
      y: source.y,
    };
    const purpose: CanvasPurpose =
      source.kind === "text"
        ? "context"
        : kind === "video"
          ? "first_frame"
          : "reference";
    const error = canvasConnectionError(pinned, target, purpose);
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
          node.id === source.id ? pinned : node,
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
    const error = canvasConnectionError(from, to, purpose);
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
    if (!source.assetId && !source.panelId) {
      const preview = nodeMedia(source, catalog, panels);
      if (preview?.kind === "image")
        source = { ...source, assetId: preview.id };
    }
    const destination = current.current.nodes.find((node) => node.id === to)!;
    const video = (destination.outputKind ?? destination.kind) === "video";
    const hasFirstFrame = current.current.edges.some(
      (edge) => edge.to === to && edge.purpose === "first_frame",
    );
    const purpose =
      video && !hasFirstFrame && ["image", "panel"].includes(source.kind)
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
    void Promise.allSettled([
      loadStudioAssetCatalog(projectId, abort.signal),
      loadStudioStoryboard(projectId, episodeId, abort.signal),
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
      if (!busyRef.current) void state.refresh();
    });
    return () => abort.abort();
  }, [projectId, episodeId, snapshot.tasks]);
  useEffect(() => {
    if (state.loading || !storyboard || layoutInitialized.current) return;
    layoutInitialized.current = true;
    if (current.current.layoutMode === "branches") {
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
  }, [state.loading, storyboard]);
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
  }, [current, replace]);
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
  async function applyMedia() {
    if (!active?.panelId) return;
    const media = nodeMedia(active, catalog, panels);
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
    try {
      if (!(await state.save())) throw new Error("请先保存画布再审核");
      const items: Review[] = [];
      for (const node of nodes) {
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
        else {
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
        }
        items.push(item);
      }
      setReview(items);
      setReviewOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "审核失败");
    } finally {
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
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function fit(source: CanvasDocument = current.current) {
    if (!source.nodes.length) return;
    const items = [
      ...source.nodes,
      ...(source.layoutMode === "branches" ? (source.branchGroups ?? []) : []),
    ];
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
        const position = center(),
          node: CanvasCard = {
            id: crypto.randomUUID(),
            kind,
            title: file.name,
            text: "",
            assetId: data.asset.id,
            x:
              position.x -
              CARD_WIDTH / 2 +
              ((current.current.nodes.length * 16) % 160),
            y: position.y - CARD_HEIGHT / 2,
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
    locale,
    tool,
    busy,
    saving: state.saving,
    dirty: state.dirty,
    saveError: state.saveError,
    nodeCount: document.nodes.length,
    selectedCount: selected.size,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    outlineOpen,
    libraryOpen: library,
    branches: document.layoutMode === "branches",
    onTool: setTool,
    onCreate: create,
    onOutline: () => setOutlineOpen(!outlineOpen),
    onLibrary: () => setLibrary(!library),
    onImport: () => uploadInput.current?.click(),
    onUndo: () => state.undo(),
    onRedo: () => state.undo(true),
    onDuplicate: duplicate,
    onArrange: showBranches,
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
            document={document}
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
                const from = document.nodes.find((n) => n.id === edge.from),
                  to = document.nodes.find((n) => n.id === edge.to);
                if (!from || !to) return null;
                const x = from.x + CARD_WIDTH,
                  y = from.y + PORT_Y,
                  tx = to.x,
                  ty = to.y + PORT_Y;
                const branch = canvasBranchPath(x, y, tx, ty);
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
                          : "var(--muted-foreground)"
                      }
                      strokeWidth={edgeId === edge.id ? 3 : 2}
                      markerEnd={`url(#${arrowId})`}
                    />
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={18}
                      className="cursor-pointer"
                    />
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
            {document.nodes.map((node) => (
              <CanvasNode
                key={node.id}
                node={node}
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
                media={nodeMedia(node, catalog, panels)}
                task={snapshot.tasks.find(
                  (task) => task.targetId === (node.panelId ?? node.id),
                )}
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
              "确认保存的提示词、模型和输入。视频先生成无声画面，台词音频在声音工作台处理。",
              "Review saved prompts and inputs. Videos are silent; dialogue is processed in the audio workspace.",
            )}
          </DialogDescription>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            {review.map((item) => (
              <section key={item.key} className="rounded-lg border p-3">
                <div className="flex justify-between font-medium">
                  <span>{item.node.title}</span>
                  <span className="text-xs">{item.status}</span>
                </div>
                <p className="my-2 text-xs text-muted-foreground">
                  {item.model?.name ?? "未配置模型"} · {item.model?.channelName}
                </p>
                <p className="text-xs">
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
              {busy
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
                {model.name} · {model.channelName}
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
