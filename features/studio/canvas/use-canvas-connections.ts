"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import type { CanvasDocument } from "./types";
import { CARD_WIDTH, PORT_Y } from "./canvas-view-model";

export function useCanvasConnections(
  container: RefObject<HTMLDivElement | null>,
  document: RefObject<CanvasDocument>,
  onConnect: (from: string, to: string) => void,
) {
  const [source, setSource] = useState<string>();
  const [cursor, setCursor] = useState<{ x: number; y: number }>();
  const [target, setTarget] = useState<string>();
  const sourceRef = useRef<string | undefined>(undefined);
  const gesture = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const connect = useRef(onConnect);
  useLayoutEffect(() => { connect.current = onConnect; }, [onConnect]);

  function cancel() {
    sourceRef.current = undefined; gesture.current = null;
    setSource(undefined); setCursor(undefined); setTarget(undefined);
  }
  function complete(to: string) {
    const from = sourceRef.current;
    if (!from || from === to) return;
    if (!document.current.nodes.some(node => node.id === from) || !document.current.nodes.some(node => node.id === to)) { cancel(); return; }
    connect.current(from, to); cancel();
  }
  function begin(from: string, event?: PointerEvent<HTMLButtonElement>) {
    event?.stopPropagation(); event?.preventDefault();
    if (event && event.button !== 0) return;
    const node = document.current.nodes.find(item => item.id === from);
    if (!node) return;
    sourceRef.current = from; setSource(from); setTarget(undefined);
    setCursor({ x: node.x + CARD_WIDTH, y: node.y + PORT_Y });
    if (event) {
      gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  useEffect(() => {
    const findTarget = (x: number, y: number) => window.document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-connection-target]")?.dataset.connectionTarget;
    const move = (event: globalThis.PointerEvent) => {
      if (!sourceRef.current) return;
      const rect = container.current?.getBoundingClientRect(); if (!rect) return;
      const drag = gesture.current;
      if (drag && event.pointerId !== drag.pointerId) return;
      if (drag && Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 4) drag.moved = true;
      const view = document.current.viewport;
      setCursor({ x: (event.clientX - rect.left - view.x) / view.k, y: (event.clientY - rect.top - view.y) / view.k });
      const candidate = findTarget(event.clientX, event.clientY);
      setTarget(candidate === sourceRef.current ? undefined : candidate);
    };
    const up = (event: globalThis.PointerEvent) => {
      const drag = gesture.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      gesture.current = null;
      if (!drag.moved) return;
      const to = findTarget(event.clientX, event.clientY);
      if (to && to !== sourceRef.current) complete(to); else cancel();
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel); window.addEventListener("keydown", key); window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); window.removeEventListener("keydown", key); window.removeEventListener("blur", cancel); };
  }, [container, document]);

  return { source, cursor, target, begin, complete, cancel };
}
