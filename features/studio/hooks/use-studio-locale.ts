"use client";

import { useState } from "react";

import type { StudioLocale } from "../types";

export function useStudioLocale() {
  const [locale, setLocale] = useState<StudioLocale>("zh-CN");

  function toggleLocale() {
    setLocale((current) => (current === "zh-CN" ? "en" : "zh-CN"));
  }

  return { locale, toggleLocale };
}
