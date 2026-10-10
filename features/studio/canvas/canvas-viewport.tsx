"use client";

import React, { useEffect, useRef, useState } from "react";
import type { ViewportTransform } from "./types";

type CanvasViewportProps = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewport: ViewportTransform;
  tool: "select" | "pan";
  backgroundMode?: "dots" | "lines" | "blank";
  onViewportChange: (viewport: ViewportTransform) => void;
  onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onCanvasDeselect?: () => void;
  onCanvasDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
};

export function CanvasViewport({ containerRef, viewport, tool, backgroundMode = "dots", onViewportChange, onCanvasMouseDown, onCanvasDeselect, onCanvasDoubleClick, onContextMenu, onDrop, children }: CanvasViewportProps) {
  const latest = useRef({ viewport, onViewportChange });
  latest.current = { viewport, onViewportChange };
  const space = useRef(false);
  const hovered = useRef(false);
  const suppressClick = useRef(false);
  const frame = useRef<number | null>(null);
  const pending = useRef<ViewportTransform | null>(null);
  const pan = useRef<{ pointerId: number; startX: number; startY: number; viewport: ViewportTransform; moved: boolean } | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [panning, setPanning] = useState(false);

  function flush() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (pending.current) latest.current.onViewportChange(pending.current);
    pending.current = null;
  }

  useEffect(() => {
    const editing = (target: EventTarget | null) => target instanceof Element && !!target.closest("input,textarea,select,[contenteditable=true]");
    const keyDown = (event: KeyboardEvent) => {
      const canvas = containerRef.current;
      if (event.code !== "Space" || editing(event.target) || !canvas) return;
      if (!hovered.current && !(event.target instanceof Node && canvas.contains(event.target))) return;
      event.preventDefault(); space.current = true; setSpacePressed(true);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (space.current) event.preventDefault();
      space.current = false; setSpacePressed(false);
    };
    const blur = () => {
      space.current = false; hovered.current = false; setSpacePressed(false);
      const gesture = pan.current;
      pan.current = null; setPanning(false);
      if (gesture && containerRef.current?.hasPointerCapture(gesture.pointerId)) containerRef.current.releasePointerCapture(gesture.pointerId);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      if (pending.current) latest.current.onViewportChange(pending.current);
      pending.current = null;
    };
    window.addEventListener("keydown", keyDown); window.addEventListener("keyup", keyUp); window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keyDown); window.removeEventListener("keyup", keyUp); window.removeEventListener("blur", blur);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [containerRef]);

  useEffect(() => {
    const canvas = containerRef.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-canvas-no-zoom]")) return;
      event.preventDefault();
      if (pan.current) return;
      const rect = canvas.getBoundingClientRect();
      const view = latest.current.viewport;
      const k = Math.max(0.05, Math.min(5, view.k * Math.pow(1.1, -event.deltaY / 100)));
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      latest.current.onViewportChange({ x: x - (x - view.x) / view.k * k, y: y - (y - view.y) / view.k * k, k });
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [containerRef]);

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (pan.current) return;
    suppressClick.current = false;
    const target = event.target instanceof Element ? event.target : null;
    const shouldPan = event.button === 1 || (event.button === 0 && (space.current || tool === "pan"));
    if (!shouldPan) return;
    if (event.button === 0 && !space.current && target?.closest("[data-node-id],[data-connection-id],[data-canvas-no-zoom],button,a,summary,input,textarea,select,video,audio,[contenteditable=true]")) return;
    if (event.button !== 1 && !space.current && target?.closest("input,textarea,select,video,[contenteditable=true]")) return;
    event.preventDefault(); event.stopPropagation();
    suppressClick.current = true;
    if (event.button === 0 && !space.current) onCanvasDeselect?.();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    pan.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, viewport: latest.current.viewport, moved: false };
    setPanning(true);
  }
  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const gesture = pan.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
    if (Math.abs(dx) + Math.abs(dy) < 3 && !gesture.moved) return;
    gesture.moved = true;
    pending.current = { ...gesture.viewport, x: gesture.viewport.x + dx, y: gesture.viewport.y + dy };
    if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; if (pending.current) latest.current.onViewportChange(pending.current); pending.current = null; });
  }
  function finishPan(event: React.PointerEvent<HTMLDivElement>) {
    const gesture = pan.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.stopPropagation(); flush(); pan.current = null; setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const grid = 48 * viewport.k;
  const dot = viewport.k < 0.12 ? 0.8 : 1.15;
  return <div ref={containerRef} tabIndex={0} aria-label="画布视口" className="relative h-full w-full touch-none select-none overflow-hidden outline-none"
    style={{ background: "var(--background)", cursor: panning ? "grabbing" : spacePressed || tool === "pan" ? "grab" : undefined }}
    onPointerEnter={() => { hovered.current = true; }} onPointerLeave={() => { hovered.current = false; }}
    onPointerDownCapture={pointerDown} onPointerMoveCapture={pointerMove} onPointerUpCapture={finishPan} onPointerCancelCapture={finishPan} onLostPointerCapture={finishPan}
    onPointerDown={event => {
      suppressClick.current = false;
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest("[data-node-id],[data-connection-id]"))) return;
      event.currentTarget.focus({ preventScroll: true }); onCanvasMouseDown?.(event); onCanvasDeselect?.();
    }}
    onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
    onDoubleClick={event => { if (!(event.target instanceof Element && event.target.closest("[data-node-id],[data-connection-id],[data-canvas-no-zoom]"))) onCanvasDoubleClick?.(event); }}
    onContextMenu={onContextMenu} onDragOver={event => event.preventDefault()} onDrop={onDrop}>
    {backgroundMode !== "blank" && <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: backgroundMode === "dots" ? `radial-gradient(circle, var(--muted-foreground) ${dot}px, transparent ${dot + 0.2}px)` : "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)", backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${viewport.x % grid}px ${viewport.y % grid}px` }} />}
    <div className="absolute origin-top-left" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})` }}>{children}</div>
  </div>;
}
