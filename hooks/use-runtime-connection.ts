"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ChannelModelUpdate,
  ModelOption,
  RuntimeChannel,
  RuntimeConnectionSettings,
} from "@/components/agent/shell";
import { inferModelCapabilities } from "@/lib/agent/provider-types";

const STORAGE_KEY = "agent-ui-runtime-connection";
const LEGACY_DEMO_MODEL_IDS = new Set([
  "openai/gpt-5-mini",
  "anthropic/claude-haiku-4.5",
]);

type StoredRuntimeConnection = {
  apiKey?: string;
  baseUrl?: string;
  protocol?: RuntimeConnectionSettings["protocol"];
  modelId?: string;
  models?: ModelOption[];
  channelRoutes?: Record<string, RuntimeChannel>;
};

type ModelsResponse = {
  message?: string;
  models?: ModelOption[];
};

type RuntimeApiChannel = {
  id: string;
  name: string;
  protocol: RuntimeChannel["protocol"];
  baseUrl: string;
  apiKeys: string[];
  models?: Array<ModelOption & { selected?: boolean }>;
};

export function useRuntimeConnection(initialModels: ModelOption[]) {
  const [connection, setConnection] = useState<RuntimeConnectionSettings>({
    apiKey: "",
    baseUrl: "",
    protocol: "openai-compatible",
    status: "idle",
  });
  const [models, setModels] = useState<ModelOption[]>(() =>
    normalizeRuntimeModels(initialModels),
  );
  const [selectedModel, setSelectedModel] = useState(
    getConversationModels(normalizeRuntimeModels(initialModels))[0]?.id ?? "",
  );
  const [channelRoutes, setChannelRoutes] = useState<
    Record<string, RuntimeChannel>
  >({});
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const stored = raw ? (JSON.parse(raw) as StoredRuntimeConnection) : null;

      if (!stored) {
        return;
      }

      setConnection({
        apiKey: "",
        baseUrl: stored.baseUrl ?? "",
        protocol: stored.protocol ?? "openai-compatible",
        status: "idle",
      });

      if (stored.models) {
        setModels(normalizeRuntimeModels(stored.models));
      }

      if (stored.channelRoutes) {
        setChannelRoutes(
          Object.fromEntries(
            Object.entries(stored.channelRoutes).map(([id, route]) => [
              id,
              { ...route, apiKey: "", apiKeys: [] },
            ]),
          ),
        );
      }

      if (
        stored.modelId &&
        stored.models?.some(
          (model) =>
            model.id === stored.modelId &&
            Boolean(model.channelId) &&
            isConversationModel(model) &&
            !LEGACY_DEMO_MODEL_IDS.has(model.id),
        )
      ) {
        setSelectedModel(stored.modelId);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHasHydrated(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/channels", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to load channels.");
        }
        return (await response.json()) as { channels?: RuntimeApiChannel[] };
      })
      .then((payload) => {
        if (cancelled || !Array.isArray(payload.channels)) {
          return;
        }

        const activeModels = payload.channels.flatMap((channel) =>
          (channel.models ?? [])
            .filter((model) => model.selected)
            .map((model) => ({
              ...model,
              channelId: channel.id,
              channelName: channel.name,
              protocol: channel.protocol,
            })),
        );
        const activeRoutes = Object.fromEntries(
          payload.channels.map((channel) => [
            channel.id,
            {
              channelId: channel.id,
              channelName: channel.name,
              protocol: channel.protocol,
              baseUrl: channel.baseUrl,
              apiKey: channel.apiKeys[0] ?? "",
              apiKeys: channel.apiKeys,
            },
          ]),
        );

        setModels(normalizeRuntimeModels(activeModels));
        setChannelRoutes(activeRoutes);
        setSelectedModel((current) => {
          const nextModels = normalizeRuntimeModels(activeModels);
          return current && nextModels.some(
            (model) => model.id === current && isConversationModel(model),
          )
            ? current
            : (getConversationModels(nextModels)[0]?.id ?? "");
        });
      })
      .catch(() => {
        // Keep the local cache when the channel API is temporarily unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        apiKey: "",
        baseUrl: connection.baseUrl,
        protocol: connection.protocol,
        modelId: selectedModel,
        models,
        channelRoutes: Object.fromEntries(
          Object.entries(channelRoutes).map(([id, route]) => [
            id,
            { ...route, apiKey: "", apiKeys: [] },
          ]),
        ),
      } satisfies StoredRuntimeConnection),
    );
  }, [
    channelRoutes,
    connection.apiKey,
    connection.baseUrl,
    connection.protocol,
    hasHydrated,
    models,
    selectedModel,
  ]);

  useEffect(() => {
    const normalized = normalizeRuntimeModels(models);
    if (
      normalized.length !== models.length ||
      normalized.some((model, index) => model.id !== models[index]?.id)
    ) {
      setModels(normalized);
    }
  }, [models]);

  useEffect(() => {
    setSelectedModel((current) =>
      current &&
      models.some(
        (model) => model.id === current && isConversationModel(model),
      )
        ? current
        : (getConversationModels(models)[0]?.id ?? ""),
    );
  }, [models]);

  const fetchModels = useCallback(async () => {
    if (connection.status === "loading") {
      return;
    }

    if (!connection.baseUrl.trim() || !connection.apiKey.trim()) {
      setConnection((current) => ({
        ...current,
        status: "error",
        statusMessage: "Base URL and API Key are required.",
      }));
      return;
    }

    setConnection((current) => ({
      ...current,
      status: "loading",
      statusMessage: undefined,
    }));

    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey: connection.apiKey,
          baseUrl: connection.baseUrl,
          protocol: connection.protocol,
        }),
      });
      const payload = (await response.json()) as ModelsResponse;

      if (!response.ok) {
        throw new Error(payload.message || "Failed to fetch models.");
      }

      const nextModels = payload.models ?? [];
      const channelModels = nextModels.map((model) => ({
        ...model,
        id: composeChannelModelId("default", model.modelId || model.id),
        name: `${model.name} · 默认渠道`,
        modelId: model.modelId || model.id,
        channelId: "default",
        channelName: "默认渠道",
      }));

      setModels((current) => [
        ...current.filter((model) => model.channelId !== "default"),
        ...normalizeRuntimeModels(channelModels),
      ]);
      setSelectedModel((current) =>
        channelModels.some(
          (model) => model.id === current && isConversationModel(model),
        )
          ? current
          : (getConversationModels(channelModels)[0]?.id ?? current),
      );
      setConnection((current) => ({
        ...current,
        status: "success",
        statusMessage: `${nextModels.length} models`,
      }));
    } catch (error) {
      setConnection((current) => ({
        ...current,
        status: "error",
        statusMessage: getReadableErrorMessage(error),
      }));
    }
  }, [
    connection.apiKey,
    connection.baseUrl,
    connection.protocol,
    connection.status,
  ]);

  const clearConnection = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setConnection({
      apiKey: "",
      baseUrl: "",
      status: "idle",
      statusMessage: undefined,
    });
    setModels([]);
    setSelectedModel("");
  }, []);

  const addChannelModels = useCallback((update: ChannelModelUpdate) => {
    setModels((current) => [
      ...current.filter(
        (model) =>
          Boolean(model.channelId) && model.channelId !== update.channelId,
      ),
      ...normalizeRuntimeModels(
        update.models.filter((model) => model.channelId === update.channelId),
      ),
    ]);
    setChannelRoutes((current) => ({
      ...current,
      [update.channelId]: {
        channelId: update.channelId,
        channelName: update.channelName,
        protocol: update.protocol,
        baseUrl: update.baseUrl,
        apiKey: "",
        apiKeys: [],
      },
    }));
  }, []);

  const metadata = useMemo(() => {
    const selected = models.find((model) => model.id === selectedModel);
    const route = selected?.channelId
      ? channelRoutes[selected.channelId]
      : undefined;
    const baseUrl = route?.baseUrl || connection.baseUrl.trim();
    const apiKey = route ? getPrimaryApiKey(route) : connection.apiKey.trim();
    const protocol =
      route?.protocol || connection.protocol || "openai-compatible";
    const modelRoutes = Object.fromEntries(
      models
        .filter((model) => model.channelId && channelRoutes[model.channelId])
        .map((model) => {
          const modelRoute = channelRoutes[model.channelId!];
          return [
            model.id,
            {
              model: model.modelId || model.id,
              channelId: modelRoute.channelId,
              protocol: modelRoute.protocol,
              baseUrl: modelRoute.baseUrl,
              apiKey: getPrimaryApiKey(modelRoute),
            },
          ];
        }),
    );

    return {
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
      protocol,
      model: selected?.modelId || selectedModel,
      modelKey: selectedModel,
      ...(selected?.channelId ? { channelId: selected.channelId } : {}),
      ...(Object.keys(modelRoutes).length > 0 ? { modelRoutes } : {}),
    };
  }, [
    channelRoutes,
    connection.apiKey,
    connection.baseUrl,
    connection.protocol,
    models,
    selectedModel,
  ]);

  return {
    clearConnection,
    connection,
    fetchModels,
    metadata,
    models,
    selectedModel,
    addChannelModels,
    setConnection,
    setSelectedModel,
  };
}

function getPrimaryApiKey(route: RuntimeChannel) {
  return route.apiKeys?.find((apiKey) => apiKey.trim())?.trim() || route.apiKey;
}

function composeChannelModelId(channelId: string, modelId: string) {
  return `${channelId}::${modelId}`;
}

function normalizeRuntimeModels(models: ModelOption[]) {
  return [
    ...new Map(
      models
        .filter(
          (model) =>
            Boolean(model.channelId) && !LEGACY_DEMO_MODEL_IDS.has(model.id),
        )
        .map((model) => [model.id, model]),
    ).values(),
  ];
}

function getConversationModels(models: ModelOption[]) {
  return models.filter(isConversationModel);
}

function isConversationModel(model: ModelOption) {
  const declaredModalities = model.capabilities?.modalities ?? [];
  const inferredModalities = inferModelCapabilities(
    model.modelId || model.id,
  ).modalities;
  const modalities = new Set([...declaredModalities, ...inferredModalities]);

  return !(["image", "video", "audio", "lipsync", "voicedesign"] as const).some(
    (modality) => modalities.has(modality),
  );
}

function getReadableErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Failed to fetch models.";
  const normalized = message.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return "Failed to fetch models.";
  }

  return normalized.length > 180
    ? `${normalized.slice(0, 177).trimEnd()}...`
    : normalized;
}
