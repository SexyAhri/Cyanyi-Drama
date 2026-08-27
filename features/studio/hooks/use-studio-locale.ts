"use client";

import { useEffect, useState } from "react";

import type { StudioLocale } from "../types";

const STORAGE_KEY = "cyanyi-drama:studio-locale";

export function useStudioLocale() {
  const [locale, setLocale] = useState<StudioLocale>("zh-CN");

  useEffect(() => {
    let persisted: string | null = null;
    try {
      persisted = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
    const initial = normalizeStudioLocale(persisted);
    setLocale(initial);
    applyStudioLocale(initial);
  }, []);

  function toggleLocale() {
    setLocale((current) => {
      const next = current === "zh-CN" ? "en" : "zh-CN";
      applyStudioLocale(next);
      return next;
    });
  }

  return { locale, toggleLocale };
}

export function normalizeStudioLocale(value: string | null | undefined) {
  return value === "en" ? "en" : "zh-CN";
}

function applyStudioLocale(locale: StudioLocale) {
  document.documentElement.lang = locale;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // The visible locale still updates when persistence is unavailable.
  }
}
