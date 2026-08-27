"use client";

import { useEffect, useState } from "react";

const WIDE_LAYOUT_QUERY = "(min-width: 1280px)";

export function useStudioWideLayout() {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(WIDE_LAYOUT_QUERY);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return wide;
}
