"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  generateStudioPanelImage,
  generateStudioPanelVideo,
  loadStudioAssetCatalog,
  loadStudioStoryboard,
} from "../api";
import type {
  ProjectAssetCatalog,
  StudioModelOption,
  WorkspaceSnapshot,
} from "../types";
import { CanvasViewport } from "./canvas-viewport";
import { useCanvasConnections } from "./use-canvas-connections";
import type { CanvasCard, CanvasDocument, ViewportTransform } from "./types";

const empty: CanvasDocument = {
  nodes: [],
  edges: [],
  viewport: { x: 40, y: 40, k: 0.8 },
};
export function CanvasWorkspace({
  projectId,
  episodeId,
  imageModels,
  videoModels,
  snapshot,
  onRefresh,
  registerBeforeLeave,
}: {
  projectId: string;
  episodeId: string;
  imageModels: StudioModelOption[];
  videoModels: StudioModelOption[];
  snapshot: WorkspaceSnapshot;
  onRefresh: () => Promise<unknown>;
  registerBeforeLeave: (handler: (() => Promise<boolean>) | undefined) => void;
}) {
  const [document, setDocument] = useState<CanvasDocument>(empty);
  const [catalog, setCatalog] = useState<ProjectAssetCatalog>();
  const [selected, setSelected] = useState<string>();

  const [tool, setTool] = useState<"select" | "pan">("select");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [kind, setKind] = useState<"image" | "video">("image");
  const [modelId, setModelId] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const arrowId = useId().replace(/:/g, "");
  const current = useRef(document);
  const revision = useRef(0);
  const past = useRef<CanvasDocument[]>([]);
  const future = useRef<CanvasDocument[]>([]);
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    startX: number;
    startY: number;
  } | null>(null);
  const savingRef = useRef(false);
  const generationRef = useRef(false);
  const url = `/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/canvas`;
  const models = kind === "image" ? imageModels : videoModels;
  const active = document.nodes.find((node) => node.id === selected);

  const replace = useCallback((next: CanvasDocument, record = true) => {
    if (record) {
      past.current.push(current.current);
      past.current = past.current.slice(-60);
      future.current = [];
    }
    current.current = next;
    setDocument(next);
    setDirty(true);
    setHistoryVersion((value) => value + 1);
  }, []);
  const connections = useCanvasConnections(container, current, (from, to) => {
    const state = current.current;
    if (state.edges.some((edge) => edge.from === from && edge.to === to))
      return;
    replace({
      ...state,
      edges: [...state.edges, { id: crypto.randomUUID(), from, to }],
    });
    setSelected(to);
  });
  const linkFrom = connections.source;

  const viewportChange = useCallback(
    (viewport: ViewportTransform) =>
      replace({ ...current.current, viewport }, false),
    [replace],
  );

  useEffect(() => {
    const abort = new AbortController();
    void fetch(url, { signal: abort.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? "加载失败");
        if (abort.signal.aborted) return;
        current.current = data.document ?? empty;
        setDocument(current.current);
        revision.current = data.revision;
        setDirty(false);
        setLoading(false);
      })
      .catch((error) => {
        if (!abort.signal.aborted) {
          setLoadError(error.message);
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [url]);
  useEffect(() => {
    const abort = new AbortController();
    void loadStudioAssetCatalog(projectId, abort.signal)
      .then(setCatalog)
      .catch((error) => {
        if (!abort.signal.aborted) toast.error(error.message);
      });
    return () => abort.abort();
  }, [projectId, snapshot.tasks]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const item = drag.current;
      if (!item) return;
      replace(
        {
          ...current.current,
          nodes: current.current.nodes.map((node) =>
            node.id === item.id
              ? {
                  ...node,
                  x:
                    item.x +
                    (event.clientX - item.startX) / current.current.viewport.k,
                  y:
                    item.y +
                    (event.clientY - item.startY) / current.current.viewport.k,
                }
              : node,
          ),
        },
        false,
      );
    };
    const stop = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };
  }, [replace]);

  async function save() {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    const captured = current.current;
    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document: captured,
          revision: revision.current,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "保存失败");
      revision.current = data.revision;
      if (captured === current.current) setDirty(false);
      toast.success("画布已保存");
      return captured === current.current;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  useEffect(() => {
    registerBeforeLeave(async () => !dirty || (await save()));
    return () => registerBeforeLeave(undefined);
  });
  function add(cards: CanvasCard[]) {
    const state = current.current;
    const existing = new Set(state.nodes.map((node) => node.id));
    replace({
      ...state,
      nodes: [
        ...state.nodes,
        ...cards.filter((node) => !existing.has(node.id)),
      ],
    });
  }
  async function importPanels() {
    setBusy("import");
    try {
      const data = await loadStudioStoryboard(projectId, episodeId);
      const cards = (data.storyboard?.panels ?? []).map(
        (panel, index): CanvasCard => ({
          id: `panel-${panel.id}`,
          kind: "panel",
          panelId: panel.id,
          title: `镜头 ${panel.panelIndex + 1}`,
          text: panel.imagePrompt ?? panel.description ?? "",
          videoText: panel.videoPrompt ?? "",
          assetId: panel.videoAssetId ?? panel.imageAssetId ?? undefined,
          x: (index % 4) * 360,
          y: Math.floor(index / 4) * 400,
        }),
      );
      if (!cards.length) {
        toast.info("当前剧集还没有分镜");
        return;
      }
      add(cards);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入失败");
    } finally {
      setBusy(undefined);
    }
  }
  function undo(redo = false) {
    const from = redo ? future : past;
    const to = redo ? past : future;
    const next = from.current.pop();
    if (!next) return;
    to.current.push(current.current);
    current.current = next;
    setDocument(next);
    setDirty(true);
    setHistoryVersion((value) => value + 1);
  }
  function remove() {
    replace({
      ...current.current,
      nodes: current.current.nodes.filter((node) => node.id !== selected),
      edges: current.current.edges.filter(
        (edge) =>
          edge.from !== selected &&
          edge.to !== selected &&
          edge.id !== selected,
      ),
    });
    setSelected(undefined);
    connections.cancel();
  }
  function fit() {
    const nodes = current.current.nodes;
    const rect = container.current?.getBoundingClientRect();
    if (!rect || !nodes.length) return;
    const x = Math.min(...nodes.map((node) => node.x));
    const y = Math.min(...nodes.map((node) => node.y));
    const width = Math.max(...nodes.map((node) => node.x + 300)) - x;
    const height = Math.max(...nodes.map((node) => node.y + 340)) - y;
    const k = Math.max(
      0.05,
      Math.min(1, (rect.width - 80) / width, (rect.height - 80) / height),
    );
    viewportChange({
      x: (rect.width - width * k) / 2 - x * k,
      y: (rect.height - height * k) / 2 - y * k,
      k,
    });
  }
  async function generate() {
    if (!active?.panelId || generationRef.current) return;
    const model = models.find((item) => item.id === modelId) ?? models[0];
    if (!model) return;
    generationRef.current = true;
    setBusy(active.id);
    try {
      if (dirty && !(await save())) return;
      const sources = document.edges
        .filter((edge) => edge.to === active.id)
        .map((edge) => document.nodes.find((node) => node.id === edge.from))
        .filter(
          (node): node is CanvasCard =>
            !!node && node.kind === "text" && !!node.text.trim(),
        );
      const prompt = [
        (kind === "video" ? active.videoText : active.text) ?? "",
        ...sources.map((node) => `${node.title}：${node.text}`),
      ]
        .filter(Boolean)
        .join("\n\n");
      const input = {
        channelId: model.channelId,
        model: model.modelId,
        prompt: prompt || undefined,
      };
      if (kind === "image")
        await generateStudioPanelImage(
          projectId,
          episodeId,
          active.panelId,
          input,
        );
      else
        await generateStudioPanelVideo(
          projectId,
          episodeId,
          active.panelId,
          input,
        );
      toast.success("任务已提交，可在制作动态查看进度");
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      generationRef.current = false;
      setBusy(undefined);
    }
  }
  function exportCanvas() {
    const blob = new Blob([JSON.stringify(current.current, null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = href;
    anchor.download = `canvas-${episodeId}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  }
  if (loading)
    return (
      <div className="p-8 text-sm text-muted-foreground">正在加载画布…</div>
    );
  if (loadError)
    return (
      <div className="p-8 text-sm text-destructive">
        {loadError}
        <Button onClick={() => window.location.reload()}>重新加载</Button>
      </div>
    );

  return (
    <div
      className="relative flex h-full min-h-[450px] flex-col"
      data-history-version={historyVersion}
      tabIndex={0}
      aria-label="无限创作画布"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          void save();
          return;
        }
        const target = event.target as HTMLElement;
        if (target.closest("input,textarea,select,[contenteditable=true]"))
          return;
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "z"
        ) {
          event.preventDefault();
          undo(event.shiftKey);
        }
        if (event.key === "Delete" && selected) {
          event.preventDefault();
          remove();
        }
        if (
          active &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        ) {
          event.preventDefault();
          const step = event.shiftKey ? 50 : 10;
          replace({
            ...current.current,
            nodes: current.current.nodes.map((node) =>
              node.id === active.id
                ? {
                    ...node,
                    x:
                      node.x +
                      (event.key === "ArrowLeft"
                        ? -step
                        : event.key === "ArrowRight"
                          ? step
                          : 0),
                    y:
                      node.y +
                      (event.key === "ArrowUp"
                        ? -step
                        : event.key === "ArrowDown"
                          ? step
                          : 0),
                  }
                : node,
            ),
          });
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2 text-xs">
        <Button
          size="sm"
          variant={tool === "select" ? "secondary" : "ghost"}
          onClick={() => setTool("select")}
        >
          选择
        </Button>
        <Button
          size="sm"
          variant={tool === "pan" ? "secondary" : "ghost"}
          onClick={() => setTool("pan")}
        >
          拖动画布
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const rect = container.current?.getBoundingClientRect();
            const view = current.current.viewport;
            add([
              {
                id: crypto.randomUUID(),
                kind: "text",
                title: "创作笔记",
                text: "",
                x: ((rect?.width ?? 600) / 2 - view.x) / view.k,
                y: (80 - view.y) / view.k,
              },
            ]);
          }}
        >
          添加文本
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() => void importPanels()}
        >
          导入分镜
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setLibraryOpen((value) => !value)}
        >
          素材库
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!past.current.length}
          onClick={() => undo()}
        >
          撤销
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!future.current.length}
          onClick={() => undo(true)}
        >
          重做
        </Button>
        <Button size="sm" variant="ghost" onClick={fit}>
          适应画布
        </Button>
        <Button size="sm" variant="ghost" onClick={exportCanvas}>
          导出
        </Button>
        <span className="ml-auto text-muted-foreground">
          {dirty ? "未保存" : "已保存"}
        </span>
        <Button
          size="sm"
          disabled={saving || !dirty}
          onClick={() => void save()}
        >
          {saving ? "保存中…" : "保存画布"}
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <CanvasViewport
          containerRef={container}
          viewport={document.viewport}
          tool={tool}
          backgroundMode="dots"
          onViewportChange={viewportChange}
          onCanvasMouseDown={() => {
            setSelected(undefined);
            connections.cancel();
          }}
          onCanvasDeselect={() => setSelected(undefined)}
        >
          <svg
            className="pointer-events-none absolute overflow-visible"
            width="1"
            height="1"
          >
            <defs>
              <marker id={arrowId} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
              </marker>
            </defs>
            {document.edges.map((edge) => {
              const from = document.nodes.find((node) => node.id === edge.from);
              const to = document.nodes.find((node) => node.id === edge.to);
              if (!from || !to) return null;
              const sx = from.x + 300,
                sy = from.y + 28,
                ex = to.x,
                ey = to.y + 28,
                curve = Math.max(Math.abs(ex - sx) * 0.5, 50);
              return (
                <g key={edge.id}>
                <path
                  data-connection-id={edge.id}
                  d={`M ${sx} ${sy} C ${sx + curve} ${sy}, ${ex - curve} ${ey}, ${ex} ${ey}`}
                  stroke="transparent" fill="none" strokeWidth="20" style={{ pointerEvents: "stroke", cursor: "pointer" }}
                  onClick={(event) => { event.stopPropagation(); setSelected(edge.id); }}
                />
                <path
                  key={edge.id}
                  data-connection-id={edge.id}
                  d={`M ${sx} ${sy} C ${sx + curve} ${sy}, ${ex - curve} ${ey}, ${ex} ${ey}`}
                  stroke={
                    selected === edge.id
                      ? "var(--primary)"
                      : "var(--muted-foreground)"
                  }
                  fill="none"
                  strokeWidth="3"
                  className="pointer-events-none"
                  markerEnd={`url(#${arrowId})`}
                />
                </g>
              );
            })}
            {linkFrom && connections.cursor && (() => {
              const from = document.nodes.find(node => node.id === linkFrom);
              if (!from) return null;
              const target = document.nodes.find(node => node.id === connections.target);
              const sx = from.x + 300, sy = from.y + 28;
              const ex = target?.x ?? connections.cursor.x, ey = target ? target.y + 28 : connections.cursor.y;
              const curve = Math.max(Math.abs(ex - sx) * 0.5, 50);
              return <path d={`M ${sx} ${sy} C ${sx + curve} ${sy}, ${ex - curve} ${ey}, ${ex} ${ey}`} stroke="var(--primary)" strokeWidth="2" strokeDasharray="6 4" fill="none" className="pointer-events-none" />;
            })()}
          </svg>
          {document.nodes.map((node) => {
            const task = snapshot.tasks.find(
              (item) => item.targetId === node.panelId,
            );
            const media =
              (node.panelId
                ? catalog?.assets.find(
                    (item) =>
                      item.sourceTargetId === node.panelId &&
                      item.taskStatus === "succeeded" &&
                      item.kind === kind,
                  )
                : undefined) ??
              catalog?.assets.find((item) => item.id === node.assetId);
            return (
              <section
                key={node.id}
                data-node-id={node.id}
                className={`absolute w-75 rounded-xl border bg-card shadow-sm ${selected === node.id ? "ring-2 ring-primary" : ""}`}
                style={{ left: node.x, top: node.y }}
                onClick={(event) => {
                  if (
                    event.target instanceof Element &&
                    event.target.closest(
                      "input,textarea,select,video,[data-connection-source],[data-connection-target]",
                    )
                  )
                    return;
                  setSelected(node.id);
                }}
              >
                <button
                  type="button"
                  data-connection-target={node.id}
                  aria-label={`连接到${node.title}`}
                  title="输入端口"
                  className="absolute -left-4 top-3 z-10 flex size-8 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-primary"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    connections.complete(node.id);
                  }}
                ><span className={`size-4 rounded-full border-2 border-background bg-muted-foreground ${connections.target === node.id ? "ring-4 ring-primary bg-primary" : ""}`} /></button>
                <button
                  type="button"
                  data-connection-source={node.id}
                  aria-label={`从${node.title}开始连线`}
                  title="输出端口：拖到目标输入端口，或点击后再点目标输入端口"
                  className="absolute -right-4 top-3 z-10 flex size-8 touch-none items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-primary"
                  onPointerDown={(event) => connections.begin(node.id, event)}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.detail === 0) connections.begin(node.id);
                  }}
                ><span className={`size-4 rounded-full border-2 border-background bg-primary ${linkFrom === node.id ? "ring-4 ring-primary/30" : ""}`} /></button>
                <button
                  type="button"
                  className="flex w-full touch-none items-center justify-between rounded-t-xl border-b px-3 py-2 text-left text-sm font-medium cursor-grab"
                  onPointerDown={(event) => {
                    if (event.button !== 0 || linkFrom) return;
                    event.stopPropagation();
                    setSelected(node.id);
                    past.current.push(current.current);
                    past.current = past.current.slice(-60);
                    future.current = [];
                    drag.current = {
                      id: node.id,
                      x: node.x,
                      y: node.y,
                      startX: event.clientX,
                      startY: event.clientY,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                >
                  {node.title}
                  <span className="text-xs text-muted-foreground">
                    {
                      {
                        text: "文本",
                        panel: "分镜",
                        image: "图片",
                        video: "视频",
                      }[node.kind]
                    }
                  </span>
                </button>
                {media?.url &&
                  (media.kind === "video" ? (
                    <video
                      controls
                      preload="metadata"
                      src={media.url}
                      className="h-36 w-full object-contain"
                      data-canvas-no-zoom
                    />
                  ) : (
                    <img
                      alt={node.title}
                      src={media.url}
                      draggable={false}
                      className="h-36 w-full object-contain"
                    />
                  ))}
                <textarea
                  aria-label={`${node.title}${node.panelId && kind === "video" ? "视频提示词" : "提示词或笔记"}`}
                  data-canvas-no-zoom
                  className="nodrag h-28 w-full resize-none bg-transparent p-3 text-xs outline-none focus:ring-1 focus:ring-primary"
                  value={
                    node.panelId && kind === "video"
                      ? (node.videoText ?? "")
                      : node.text
                  }
                  placeholder="写下创意或镜头提示词…"
                  onFocus={() => setSelected(node.id)}
                  onChange={(event) =>
                    replace({
                      ...current.current,
                      nodes: current.current.nodes.map((item) =>
                        item.id === node.id
                          ? {
                              ...item,
                              [node.panelId && kind === "video"
                                ? "videoText"
                                : "text"]: event.target.value,
                            }
                          : item,
                      ),
                    })
                  }
                />
                {task?.error && (
                  <p className="px-3 py-2 text-xs text-destructive">
                    {task.error.message}
                  </p>
                )}
                <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    {task
                      ? {
                          queued: "排队中",
                          running: `生成中 ${task.progress}%`,
                          succeeded: "已完成",
                          failed: "生成失败",
                          canceled: "已取消",
                        }[task.status]
                      : "创作中"}
                  </span>
                  <button
                    type="button"
                    aria-label={`从${node.title}开始连线`}
                    onClick={(event) => {
                      event.stopPropagation();
                      connections.begin(node.id);
                    }}
                  >
                    连接 →
                  </button>
                </div>
              </section>
            );
          })}
        </CanvasViewport>
        {!document.nodes.length && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            添加创作笔记，或导入本集分镜与素材
          </div>
        )}
        {libraryOpen && (
          <aside className="absolute left-3 top-3 max-h-[70%] w-64 overflow-y-auto rounded-xl border bg-popover p-3 shadow-lg">
            <div className="mb-3 flex justify-between text-sm font-medium">
              项目素材
              <button
                onClick={() => setLibraryOpen(false)}
                aria-label="关闭素材库"
              >
                ×
              </button>
            </div>
            {!catalog?.assets.length && (
              <p className="text-xs text-muted-foreground">暂无素材</p>
            )}
            {catalog?.assets
              .filter(
                (asset) => asset.kind === "image" || asset.kind === "video",
              )
              .map((asset, index) => (
                <button
                  key={asset.id}
                  className="mb-2 block w-full rounded border p-2 text-left text-xs"
                  onClick={() =>
                    add([
                      {
                        id: `asset-${asset.id}`,
                        kind: asset.kind === "video" ? "video" : "image",
                        assetId: asset.id,
                        title: `素材 ${index + 1}`,
                        text: "",
                        x: -document.viewport.x / document.viewport.k + 80,
                        y: -document.viewport.y / document.viewport.k + 80,
                      },
                    ])
                  }
                >
                  {asset.kind === "image" && asset.url && (
                    <img
                      src={asset.url}
                      alt=""
                      className="mb-1 h-20 w-full object-contain"
                    />
                  )}
                  素材 {index + 1} · {asset.kind}
                </button>
              ))}
          </aside>
        )}
        <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs">
          <button
            aria-label="缩小"
            onClick={() =>
              viewportChange({
                ...document.viewport,
                k: Math.max(0.05, document.viewport.k / 1.2),
              })
            }
          >
            −
          </button>
          {Math.round(document.viewport.k * 100)}%
          <button
            aria-label="放大"
            onClick={() =>
              viewportChange({
                ...document.viewport,
                k: Math.min(5, document.viewport.k * 1.2),
              })
            }
          >
            ＋
          </button>
          <span className="hidden sm:inline text-muted-foreground">
            空格拖拽 · 滚轮缩放
          </span>
        </div>
        {linkFrom && (
          <div className="absolute bottom-14 left-3 rounded border bg-background p-2 text-xs">
            拖到或点击目标左侧输入端口；文本节点内容将加入目标镜头的生成提示词。{" "}
            <button onClick={() => connections.cancel()}>取消</button>
          </div>
        )}
        {selected && (
          <div className="absolute bottom-3 right-3 flex max-w-[90%] flex-wrap items-center gap-2 rounded-xl border bg-background p-3 shadow-lg">
            {active?.panelId && (
              <>
                <select
                  aria-label="生成类型"
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value as "image" | "video");
                    setModelId("");
                  }}
                  className="bg-background text-xs"
                >
                  <option value="image">生成图片</option>
                  <option value="video">生成视频</option>
                </select>
                <select
                  aria-label="生成模型"
                  value={modelId || models[0]?.id || ""}
                  onChange={(event) => setModelId(event.target.value)}
                  className="max-w-48 bg-background text-xs"
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={
                    !!busy ||
                    !models.length ||
                    snapshot.tasks.some(
                      (task) =>
                        task.targetId === active.panelId &&
                        ["pending", "queued", "running", "processing"].includes(
                          task.status,
                        ),
                    )
                  }
                  onClick={() => void generate()}
                >
                  {busy === active.id ? "提交中…" : "生成"}
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={remove}>
              移出画布
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
