"use client";

import { useEffect, useState } from "react";

import { fallbackComposerTemplates } from "./composer-data";
import type { AgentComposerTemplate } from "./types";

type TemplatesResponse = {
  items?: AgentComposerTemplate[];
};

export function useComposerTemplates(enabled: boolean) {
  const [templates, setTemplates] = useState<AgentComposerTemplate[]>(
    fallbackComposerTemplates,
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let ignore = false;

    async function loadTemplates() {
      setIsLoading(true);

      try {
        const response = await fetch("/api/templates?limit=16");

        if (!response.ok) {
          throw new Error("Failed to load templates.");
        }

        const payload = (await response.json()) as TemplatesResponse;

        if (!ignore && payload.items?.length) {
          setTemplates(payload.items);
        }
      } catch {
        if (!ignore) {
          setTemplates(fallbackComposerTemplates);
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    void loadTemplates();

    return () => {
      ignore = true;
    };
  }, [enabled]);

  return {
    isLoading,
    templates,
  };
}
