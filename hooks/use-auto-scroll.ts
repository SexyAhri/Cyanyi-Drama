"use client";

import { useEffect, useRef, useState } from "react";

const ACTIVATION_THRESHOLD = 50;
const MIN_SCROLL_UP_THRESHOLD = 10;

export function useAutoScroll(dependencies: React.DependencyList) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousScrollTop = useRef<number | null>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
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
    const isScrollingUp = previousScrollTop.current
      ? scrollTop < previousScrollTop.current
      : false;
    const scrollUpDistance = previousScrollTop.current
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
      scrollToBottom();
    }
    // The dependency list mirrors the chatbot-kit hook API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return {
    containerRef,
    scrollToBottom,
    handleScroll,
    shouldAutoScroll,
    handleTouchStart,
  };
}
