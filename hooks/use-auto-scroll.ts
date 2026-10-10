"use client";

import { useEffect, useRef, useState } from "react";

const ACTIVATION_THRESHOLD = 50;
const MIN_SCROLL_UP_THRESHOLD = 10;

export function useAutoScroll(dependencies: React.DependencyList) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousScrollTop = useRef<number | null>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  const scrollToBottom = () => {
    setShouldAutoScroll(true);
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      previousScrollTop.current = containerRef.current.scrollTop;
    }
  };

  const handleScroll = () => {
    if (!containerRef.current) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const distanceFromBottom = Math.abs(
      scrollHeight - scrollTop - clientHeight,
    );
    const isScrollingUp = previousScrollTop.current !== null
      ? scrollTop < previousScrollTop.current
      : false;
    const scrollUpDistance = previousScrollTop.current !== null
      ? previousScrollTop.current - scrollTop
      : 0;
    const isDeliberateScrollUp =
      isScrollingUp && scrollUpDistance > MIN_SCROLL_UP_THRESHOLD;

    if (isDeliberateScrollUp) {
      setShouldAutoScroll(false);
    } else {
      setShouldAutoScroll(distanceFromBottom < ACTIVATION_THRESHOLD);
    }

    previousScrollTop.current = scrollTop;
  };

  const handleTouchStart = () => {
    setShouldAutoScroll(false);
  };

  useEffect(() => {
    if (containerRef.current) {
      previousScrollTop.current = containerRef.current.scrollTop;
    }
  }, []);

  useEffect(() => {
    if (shouldAutoScroll) {
      const viewport = containerRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }
    // The dependency list mirrors the chatbot-kit hook API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    const viewport = containerRef.current;
    const content = viewport?.firstElementChild;
    if (!viewport || !content || !shouldAutoScroll) return;
    const observer = new ResizeObserver(() => {
      viewport.scrollTop = viewport.scrollHeight;
      previousScrollTop.current = viewport.scrollTop;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [shouldAutoScroll]);

  return {
    containerRef,
    scrollToBottom,
    handleScroll,
    shouldAutoScroll,
    handleTouchStart,
  };
}
