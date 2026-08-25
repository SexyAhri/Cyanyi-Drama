"use client";

import { useLayoutEffect, useRef } from "react";

type UseAutosizeTextAreaProps = {
  ref: React.RefObject<HTMLTextAreaElement | null>;
  maxHeight?: number;
  borderWidth?: number;
  dependencies: React.DependencyList;
};

export function useAutosizeTextArea({
  ref,
  maxHeight = Number.MAX_SAFE_INTEGER,
  borderWidth = 0,
  dependencies,
}: UseAutosizeTextAreaProps) {
  const originalHeight = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!ref.current) {
      return;
    }

    const currentRef = ref.current;
    const borderAdjustment = borderWidth * 2;

    if (originalHeight.current === null) {
      originalHeight.current = currentRef.scrollHeight - borderAdjustment;
    }

    currentRef.style.removeProperty("height");

    const scrollHeight = currentRef.scrollHeight;
    const clampedToMax = Math.min(scrollHeight, maxHeight);
    const clampedToMin = Math.max(clampedToMax, originalHeight.current);

    currentRef.style.height = `${clampedToMin + borderAdjustment}px`;
    // The dependencies array is part of the hook contract, matching the
    // chatbot-kit source so callers can control when autosizing reruns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [borderWidth, maxHeight, ref, ...dependencies]);
}
