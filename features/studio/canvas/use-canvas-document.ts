"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasDocument } from "./types";
import { mergeCanvasPresentation } from "./canvas-merge";

const empty: CanvasDocument = {
  nodes: [],
  edges: [],
  viewport: { x: 40, y: 40, k: 0.8 },
};
export function useCanvasDocument(url: string) {
  const [document, setDocument] = useState<CanvasDocument>(empty);
  const current = useRef(document);
  const revision = useRef(0);
  const saved = useRef(document);
  const past = useRef<CanvasDocument[]>([]);
  const future = useRef<CanvasDocument[]>([]);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const savingPromise = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    void fetch(url, { signal: abort.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? "加载失败");
        if (abort.signal.aborted) return;
        current.current = data.document ?? empty;
        saved.current = current.current;
        revision.current = data.revision;
        past.current = [];
        future.current = [];
        setHistory({ canUndo: false, canRedo: false });
        setDocument(current.current);
        setLoading(false);
      })
      .catch((error) => {
        if (!abort.signal.aborted) {
          setError(error.message);
          setLoading(false);
        }
      });
    return () => {
      mounted.current = false;
      abort.abort();
    };
  }, [url]);
  const replace = useCallback((next: CanvasDocument, record = true) => {
    if (record) {
      past.current = [...past.current, current.current].slice(-60);
      future.current = [];
    }
    current.current = next;
    setHistory({
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
    });
    setDocument(next);
    setDirty(next !== saved.current);
  }, []);
  const save = useCallback(async (): Promise<boolean> => {
    if (savingPromise.current) {
      await savingPromise.current;
      return current.current === saved.current;
    }
    if (current.current === saved.current) return true;
    let captured = current.current;
    setSaving(true);
    setSaveError("");
    const work = (async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const response = await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              document: captured,
              revision: revision.current,
            }),
          });
          const data = await response.json();
          if (response.status === 409) {
            const latestResponse = await fetch(url);
            const latest = await latestResponse.json();
            if (!latestResponse.ok || !mounted.current)
              throw new Error(data.message ?? "保存失败");
            const remote: CanvasDocument = latest.document ?? empty;
            const merged = mergeCanvasPresentation(
              saved.current,
              current.current,
              remote,
            );
            if (!merged)
              throw new Error(
                "画布内容已在其他页面更新，请导出当前草稿后重新加载",
              );
            captured = merged;
            current.current = merged;
            saved.current = remote;
            revision.current = latest.revision;
            past.current = [];
            future.current = [];
            setHistory({ canUndo: false, canRedo: false });
            setDocument(merged);
            setDirty(true);
            continue;
          }
          if (!response.ok) throw new Error(data.message ?? "保存失败");
          revision.current = data.revision;
          saved.current = captured;
          if (mounted.current) setDirty(current.current !== captured);
          return current.current === captured;
        }
        throw new Error("画布正在更新，请稍后重试保存");
      } catch (error) {
        if (mounted.current)
          setSaveError(error instanceof Error ? error.message : "保存失败");
        return false;
      } finally {
        savingPromise.current = null;
        if (mounted.current) setSaving(false);
      }
    })();
    savingPromise.current = work;
    return work;
  }, [url]);
  const refresh = useCallback(async () => {
    if (savingPromise.current || current.current !== saved.current) return;
    const captured = current.current;
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (
        !response.ok ||
        !mounted.current ||
        savingPromise.current ||
        current.current !== captured
      )
        return;
      if (data.revision === revision.current) return;
      current.current = data.document ?? empty;
      saved.current = current.current;
      revision.current = data.revision;
      past.current = [];
      future.current = [];
      setHistory({ canUndo: false, canRedo: false });
      setDocument(current.current);
      setDirty(false);
      setSaveError("");
    } catch {
      /* The current draft remains available when refreshing fails. */
    }
  }, [url]);
  useEffect(() => {
    if (loading || !dirty || saveError || saving) return;
    const timer = window.setTimeout(() => {
      void save();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [document, dirty, loading, saveError, saving, save]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function undo(redo = false) {
    const from = redo ? future : past,
      to = redo ? past : future;
    const next = from.current.pop();
    if (!next) return;
    to.current.push(current.current);
    replace(next, false);
  }
  function checkpoint() {
    past.current = [...past.current, current.current].slice(-60);
    future.current = [];
    setHistory({ canUndo: true, canRedo: false });
  }
  return {
    document,
    current,
    revision,
    loading,
    error,
    saveError,
    saving,
    dirty,
    replace,
    save,
    refresh,
    undo,
    checkpoint,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  };
}
