"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  ListFilter,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AUTODL_COMFYUI_BASE_URL } from "@/lib/providers/media/autodl-comfyui-workflows";

import type { ShellCopy } from "./chat-shell-i18n";
import type {
  ModelOption,
  ChannelModelUpdate,
  ChannelProtocol,
  RuntimeConnectionSettings,
} from "./chat-shell-types";

type ChannelConfig = {
  id: string;
  name: string;
  protocol: ChannelProtocol;
  baseUrl: string;
  apiKey: string;
  apiKeys: string[];
  apiKeyMode: "single" | "batch";
  modelIds: string[];
  modelOptions: ModelOption[];
  modelCapabilities: Record<string, ChannelCapability[]>;
};

type ChannelCapability = "image" | "video" | "text" | "audio";

type ApiChannel = {
  id: string;
  name: string;
  protocol: ChannelProtocol;
  baseUrl: string;
  apiKeys: string[];
  models?: Array<ModelOption & { selected?: boolean }>;
};

const defaultCapabilities: ChannelCapability[] = [
  "image",
  "video",
  "text",
  "audio",
];

type ChannelDraft = ChannelConfig;

type ChannelSettingsPanelProps = {
  copy: ShellCopy;
  models: ModelOption[];
  onFinish: () => void;
  onRuntimeConnectionChange: (settings: RuntimeConnectionSettings) => void;
  onRuntimeConnectionClear: () => void;
  onModelsChange?: (update: ChannelModelUpdate) => void;
  onRefreshModels?: () => void;
  runtimeConnection: RuntimeConnectionSettings;
};

export function ChannelSettingsPanel({
  copy,
  models,
  onFinish,
  onRuntimeConnectionChange,
  onRuntimeConnectionClear,
  onModelsChange,
  runtimeConnection,
}: ChannelSettingsPanelProps) {
  const [channels, setChannels] = useState<ChannelConfig[]>(() =>
    createInitialChannels(copy, runtimeConnection, models),
  );
  const [draft, setDraft] = useState<ChannelDraft | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const notifyRuntimeChannel = useCallback(
    (channel: ChannelConfig) => {
      onModelsChange?.({
        channelId: channel.id,
        channelName: channel.name,
        protocol: normalizeProtocol(channel.protocol),
        baseUrl: channel.baseUrl,
        apiKey: getPrimaryApiKey(channel),
        apiKeys: channel.apiKeys,
        models: channel.modelOptions.filter((model) =>
          channel.modelIds.includes(model.id),
        ),
      });
    },
    [onModelsChange],
  );

  useEffect(() => {
    setChannels((current) =>
      current.map((channel) =>
        channel.id === "default"
          ? {
              ...channel,
              baseUrl: runtimeConnection.baseUrl || channel.baseUrl,
              apiKey: runtimeConnection.apiKey || channel.apiKey,
              apiKeys: normalizeApiKeys(
                channel.apiKeys,
                runtimeConnection.apiKey || channel.apiKey,
              ),
              modelIds:
                models.filter((model) => model.channelId === channel.id)
                  .length > 0 && channel.modelIds.length === 0
                  ? models
                      .filter((model) => model.channelId === channel.id)
                      .map((model) => model.id)
                  : channel.modelIds,
              modelOptions: dedupeModels([
                ...channel.modelOptions,
                ...models.filter((model) => model.channelId === channel.id),
              ]),
            }
          : channel,
      ),
    );
  }, [models, runtimeConnection.apiKey, runtimeConnection.baseUrl]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/channels", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load channels.");
        return (await response.json()) as { channels?: ApiChannel[] };
      })
      .then((payload) => {
        if (
          cancelled ||
          !Array.isArray(payload.channels) ||
          payload.channels.length === 0
        )
          return;
        const next = payload.channels.map((channel) =>
          toChannelConfig(channel),
        );
        setChannels(next);
        for (const channel of next) {
          notifyRuntimeChannel(channel);
        }
      })
      .catch(() => {
        // The initial default channel keeps the panel usable while the API is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [notifyRuntimeChannel]);

  useEffect(() => {
    for (const channel of channels) {
      if (
        !channel.baseUrl ||
        !getPrimaryApiKey(channel) ||
        channel.modelOptions.length === 0
      ) {
        continue;
      }

      onModelsChange?.({
        channelId: channel.id,
        channelName: channel.name,
        protocol: normalizeProtocol(channel.protocol),
        baseUrl: channel.baseUrl,
        apiKey: getPrimaryApiKey(channel),
        apiKeys: channel.apiKeys,
        models: channel.modelOptions.filter((model) =>
          channel.modelIds.includes(model.id),
        ),
      });
    }
    // Restore persisted channel routes once when the settings panel mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modelMap = useMemo(
    () =>
      new Map(
        models
          .concat(draft?.modelOptions ?? [])
          .map((model) => [model.id, model]),
      ),
    [draft?.modelOptions, models],
  );

  function openNewChannel() {
    setDraft({
      id: `channel-${Date.now()}`,
      name: `${copy.settingsNewChannel}`,
      protocol: "openai-compatible",
      baseUrl: "",
      apiKey: "",
      apiKeys: [""],
      apiKeyMode: "single",
      modelIds: [],
      modelOptions: [],
      modelCapabilities: {},
    });
    setSheetOpen(true);
  }

  function openEditChannel(channel: ChannelConfig) {
    setDraft({
      ...channel,
      modelIds: [...channel.modelIds],
      modelOptions: [...channel.modelOptions],
      modelCapabilities: cloneCapabilities(channel.modelCapabilities),
    });
    setSheetOpen(true);
  }

  function copyChannel(channel: ChannelConfig) {
    const id = `channel-${crypto.randomUUID()}`;
    const name = `${channel.name} ${copy.settingsChannelCopySuffix}`;

    setDraft({
      ...channel,
      id,
      name,
      apiKeys: [...channel.apiKeys],
      apiKeyMode: channel.apiKeyMode,
      modelIds: [],
      modelOptions: [],
      modelCapabilities: {},
    });
    setSheetOpen(true);
  }

  function closeEditor() {
    setSheetOpen(false);
    setDraft(null);
  }

  async function saveDraft() {
    if (!draft || !draft.name.trim()) {
      return;
    }

    const normalizedDraft = {
      ...draft,
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      apiKeys: normalizeApiKeys(draft.apiKeys, draft.apiKey),
    };

    setChannels((current) => {
      const exists = current.some(
        (channel) => channel.id === normalizedDraft.id,
      );

      return exists
        ? current.map((channel) =>
            channel.id === normalizedDraft.id ? normalizedDraft : channel,
          )
        : [...current, normalizedDraft];
    });

    try {
      const response = await fetch("/api/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: normalizedDraft.id,
          name: normalizedDraft.name,
          protocol: normalizedDraft.protocol,
          baseUrl: normalizedDraft.baseUrl,
          apiKeys: normalizedDraft.apiKeys,
          models: normalizedDraft.modelOptions,
          modelIds: normalizedDraft.modelIds,
        }),
      });
      if (!response.ok) throw new Error("Failed to save channel.");
    } catch {
      // Keep the optimistic state; the next reload will retry from the server.
    }

    notifyRuntimeChannel(normalizedDraft);

    if (draft.id === "default") {
      onRuntimeConnectionChange({
        ...runtimeConnection,
        apiKey: normalizedDraft.apiKey,
        baseUrl: normalizedDraft.baseUrl,
        protocol: normalizedDraft.protocol,
        status: "idle",
        statusMessage: undefined,
      });
    }

    closeEditor();
  }

  async function deleteChannel(channel: ChannelConfig) {
    setChannels((current) => current.filter((item) => item.id !== channel.id));
    await fetch(`/api/channels?id=${encodeURIComponent(channel.id)}`, {
      method: "DELETE",
    }).catch(() => undefined);
    onModelsChange?.({
      channelId: channel.id,
      channelName: channel.name,
      protocol: normalizeProtocol(channel.protocol),
      baseUrl: channel.baseUrl,
      apiKey: getPrimaryApiKey(channel),
      apiKeys: channel.apiKeys,
      models: [],
    });

    if (channel.id === "default") {
      onRuntimeConnectionClear();
    }
  }

  async function fetchChannelModels(baseUrl: string, apiKeys: string[]) {
    const channelId = draft?.id ?? "default";
    const channelName = draft?.name || copy.settingsDefaultChannel;
    const keys = normalizeApiKeys(apiKeys, draft?.apiKey || "");
    const results = await Promise.allSettled(
      keys.map(async (apiKey) => {
        const response = await fetch("/api/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseUrl,
            apiKey,
            protocol: draft?.protocol || "openai-compatible",
          }),
        });
        const payload = (await response.json()) as {
          message?: string;
          models?: ModelOption[];
        };

        if (!response.ok) {
          throw new Error(payload.message || "Failed to fetch models.");
        }

        return payload.models ?? [];
      }),
    );
    const successfulModels = results
      .filter(
        (result): result is PromiseFulfilledResult<ModelOption[]> =>
          result.status === "fulfilled",
      )
      .flatMap((result) => result.value);

    if (successfulModels.length === 0) {
      const firstError = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )?.reason;
      throw firstError instanceof Error
        ? firstError
        : new Error("Failed to fetch models.");
    }

    return dedupeModels(
      successfulModels.map((model) => ({
        ...model,
        id: composeChannelModelId(channelId, model.modelId || model.id),
        name: `${model.name} · ${channelName}`,
        modelId: model.modelId || model.id,
        channelId,
        channelName,
      })),
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>{copy.settingsChannelsDescription}</p>
        <Button className="shrink-0" onClick={openNewChannel} type="button">
          <Plus />
          {copy.settingsAddChannel}
        </Button>
      </div>

      <div className="grid gap-3">
        {channels.map((channel) => {
          const modelCount = channel.modelIds.length;

          return (
            <div
              className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
              key={channel.id}
            >
              <div className="min-w-0">
                <p className="truncate font-semibold">{channel.name}</p>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {getProtocolLabel(channel.protocol)} ·{" "}
                  {copy.settingsChannelModelCount(modelCount)} ·{" "}
                  {channel.baseUrl || "-"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  aria-label={`${copy.settingsCopyChannel}: ${channel.name}`}
                  onClick={() => copyChannel(channel)}
                  size="icon-sm"
                  title={`${copy.settingsCopyChannel}: ${channel.name}`}
                  type="button"
                  variant="outline"
                >
                  <Copy />
                </Button>
                <Button
                  aria-label={`${copy.settingsEditChannel}: ${channel.name}`}
                  onClick={() => openEditChannel(channel)}
                  size="icon-sm"
                  title={`${copy.settingsEditChannel}: ${channel.name}`}
                  type="button"
                  variant="outline"
                >
                  <Pencil />
                </Button>
                <Button
                  aria-label={`${copy.settingsDeleteChannel}: ${channel.name}`}
                  className="text-destructive hover:text-destructive"
                  onClick={() => deleteChannel(channel)}
                  size="icon-sm"
                  title={`${copy.settingsDeleteChannel}: ${channel.name}`}
                  type="button"
                  variant="outline"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={onFinish} type="button">
          {copy.settingsFinish}
        </Button>
      </div>

      <Sheet
        onOpenChange={(open) => {
          if (!open) {
            closeEditor();
          }
        }}
        open={sheetOpen}
      >
        <SheetContent
          className="w-full overflow-y-auto data-[side=right]:sm:max-w-2xl"
          showCloseButton={false}
          side="right"
        >
          {draft ? (
            <>
              <SheetHeader className="border-b px-5 py-4">
                <div className="flex items-center gap-3">
                  <SheetClose
                    aria-label={copy.settingsCancel}
                    render={
                      <Button size="icon-sm" type="button" variant="ghost" />
                    }
                  >
                    <X />
                  </SheetClose>
                  <SheetTitle>
                    {draft.id === "default"
                      ? copy.settingsEditChannel
                      : copy.settingsNewChannel}
                  </SheetTitle>
                </div>
              </SheetHeader>

              <div className="grid gap-5 px-5 pb-5">
                <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="channel-name">
                      {copy.settingsChannelName}
                    </Label>
                    <Input
                      id="channel-name"
                      onChange={(event) =>
                        setDraft((current) =>
                          current
                            ? { ...current, name: event.target.value }
                            : current,
                        )
                      }
                      value={draft.name}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>{copy.settingsChannelProtocol}</Label>
                    <Select
                      onValueChange={(value) => {
                        if (isChannelProtocol(value ?? "")) {
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  protocol: value as ChannelProtocol,
                                  baseUrl: defaultBaseUrlForProtocol(
                                    value as ChannelProtocol,
                                    current.baseUrl,
                                  ),
                                }
                              : current,
                          );
                        }
                      }}
                      value={draft.protocol}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai-compatible">
                          OpenAI 兼容
                        </SelectItem>
                        <SelectItem value="anthropic">
                          Anthropic 官方
                        </SelectItem>
                        <SelectItem value="google-gemini">
                          Google Gemini 官方
                        </SelectItem>
                        <SelectItem value="volcengine-ark">
                          火山方舟官方
                        </SelectItem>
                        <SelectItem value="autodl-comfyui">
                          AutoDL ComfyUI
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="channel-endpoint">
                    {copy.settingsChannelEndpoint}
                  </Label>
                  <Input
                    id="channel-endpoint"
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? { ...current, baseUrl: event.target.value }
                          : current,
                      )
                    }
                    placeholder={
                      draft.protocol === "autodl-comfyui"
                        ? AUTODL_COMFYUI_BASE_URL
                        : "https://api.openai.com/v1"
                    }
                    value={draft.baseUrl}
                  />
                </div>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="channel-api-key">API Key</Label>
                    <div className="flex items-center gap-2">
                      <Select
                        onValueChange={(value) => {
                          if (value === "single" || value === "batch") {
                            setDraft((current) =>
                              current
                                ? { ...current, apiKeyMode: value }
                                : current,
                            );
                          }
                        }}
                        value={draft.apiKeyMode}
                      >
                        <SelectTrigger className="w-56">
                          <SelectValue>
                            {draft.apiKeyMode === "batch"
                              ? copy.settingsApiKeyModeBatch
                              : copy.settingsApiKeyModeSingle}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="single">
                            {copy.settingsApiKeyModeSingle}
                          </SelectItem>
                          <SelectItem value="batch">
                            {copy.settingsApiKeyModeBatch}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {draft.apiKeyMode === "batch" ? (
                    <Textarea
                      aria-label={copy.settingsChannelApiKeys}
                      className="min-h-28 resize-y"
                      id="channel-api-key"
                      onChange={(event) => {
                        const apiKeys = parseApiKeys(event.target.value);
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                apiKey: apiKeys[0] ?? "",
                                apiKeys,
                              }
                            : current,
                        );
                      }}
                      placeholder={copy.settingsApiKeyModeBatch}
                      value={draft.apiKeys.join("\n")}
                    />
                  ) : (
                    <SecretInput
                      id="channel-api-key"
                      onChange={(value) =>
                        setDraft((current) =>
                          current
                            ? { ...current, apiKey: value, apiKeys: [value] }
                            : current,
                        )
                      }
                      value={draft.apiKey}
                    />
                  )}
                </div>

                <div className="grid gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Label>{copy.settingsChannelModels}</Label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {copy.settingsChannelModelCount(draft.modelIds.length)}
                      </p>
                    </div>
                    <ModelPicker
                      channelId={draft.id}
                      copy={copy}
                      models={dedupeModels([
                        ...models.filter(
                          (model) => model.channelId === draft.id,
                        ),
                        ...draft.modelOptions,
                      ])}
                      onFetchModels={fetchChannelModels}
                      onModelsFetched={(nextModels) =>
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                modelOptions: dedupeModels([
                                  ...current.modelOptions,
                                  ...nextModels,
                                ]),
                              }
                            : current,
                        )
                      }
                      requestApiKey={draft.apiKey}
                      requestApiKeys={draft.apiKeys}
                      requestBaseUrl={draft.baseUrl}
                      selectedIds={draft.modelIds}
                      onChange={(modelIds) =>
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                modelIds,
                                modelCapabilities: normalizeCapabilities(
                                  current.modelCapabilities,
                                  modelIds,
                                ),
                              }
                            : current,
                        )
                      }
                    />
                  </div>
                  {draft.modelIds.length > 0 ? (
                    <div className="grid gap-0.5 rounded-xl border p-2">
                      {draft.modelIds.map((modelId) => (
                        <ModelRow
                          copy={copy}
                          key={modelId}
                          model={
                            modelMap.get(modelId) ?? {
                              id: modelId,
                              name: modelId,
                            }
                          }
                          onRemove={() =>
                            setDraft((current) => {
                              if (!current) {
                                return current;
                              }

                              const nextCapabilities = {
                                ...current.modelCapabilities,
                              };
                              delete nextCapabilities[modelId];

                              return {
                                ...current,
                                modelIds: current.modelIds.filter(
                                  (id) => id !== modelId,
                                ),
                                modelCapabilities: nextCapabilities,
                              };
                            })
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="grid min-h-28 place-content-center rounded-xl border p-4 text-center">
                      <p className="text-sm text-muted-foreground">
                        {copy.settingsChannelNoModels}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <SheetFooter className="border-t px-5 py-4 sm:flex-row sm:justify-end">
                <Button onClick={closeEditor} type="button" variant="outline">
                  {copy.settingsCancel}
                </Button>
                <Button onClick={saveDraft} type="button">
                  {copy.settingsSave}
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ModelPicker({
  copy,
  channelId,
  models,
  onChange,
  onFetchModels,
  onModelsFetched,
  requestApiKey,
  requestApiKeys,
  requestBaseUrl,
  selectedIds,
}: {
  channelId: string;
  copy: ShellCopy;
  models: ModelOption[];
  onChange: (modelIds: string[]) => void;
  onFetchModels: (baseUrl: string, apiKeys: string[]) => Promise<ModelOption[]>;
  onModelsFetched: (models: ModelOption[]) => void;
  requestApiKey: string;
  requestApiKeys: string[];
  requestBaseUrl: string;
  selectedIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("existing");
  const [query, setQuery] = useState("");
  const [pendingIds, setPendingIds] = useState(selectedIds);
  const [extraModels, setExtraModels] = useState<ModelOption[]>([]);
  const [fetchedModels, setFetchedModels] = useState<ModelOption[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const availableModels = useMemo(
    () =>
      dedupeModels(
        [...models, ...extraModels].filter(
          (model) => !model.channelId || model.channelId === channelId,
        ),
      ),
    [channelId, extraModels, models],
  );
  const filteredModels = availableModels.filter((model) =>
    model.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  function openPicker() {
    setPendingIds(selectedIds);
    setQuery("");
    setActiveTab("existing");
    setOpen(true);
  }

  function closePicker() {
    setOpen(false);
  }

  function confirmSelection() {
    onChange(pendingIds);
    closePicker();
  }

  async function fetchModels() {
    setFetching(true);
    setFetchError("");

    try {
      const nextModels = await onFetchModels(
        requestBaseUrl.trim(),
        requestApiKeys.length > 0 ? requestApiKeys : [requestApiKey.trim()],
      );
      onModelsFetched(nextModels);
      setFetchedModels(nextModels);
      setExtraModels((current) => dedupeModels([...current, ...nextModels]));
      setActiveTab("fetched");
    } catch (error) {
      setFetchError(
        error instanceof Error ? error.message : "Failed to fetch models.",
      );
    } finally {
      setFetching(false);
    }
  }

  return (
    <>
      <Button onClick={openPicker} size="sm" type="button" variant="outline">
        <ListFilter />
        {copy.settingsChannelSelectModels}
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{copy.settingsSelectChannelModelsTitle}</DialogTitle>
            <DialogDescription>
              {copy.settingsSelectedCurrentModels}: {pendingIds.length} /{" "}
              {availableModels.length}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.settingsSearchModels}
                value={query}
              />
            </div>
            <Button
              disabled={fetching}
              onClick={() => void fetchModels()}
              type="button"
              variant="outline"
            >
              <RefreshCw />
              {fetching ? copy.connectionLoading : copy.settingsFetchModels}
            </Button>
          </div>

          <Tabs onValueChange={setActiveTab} value={activeTab}>
            <TabsList
              className="w-full justify-start gap-5 border-b px-0 pb-0"
              variant="line"
            >
              <TabsTrigger className="flex-none px-0 pb-3" value="fetched">
                {copy.settingsFetchedModels} ({fetchedModels.length})
              </TabsTrigger>
              <TabsTrigger className="flex-none px-0 pb-3" value="existing">
                {copy.settingsExistingModels} ({availableModels.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent className="mt-4" value="fetched">
              {fetchError ? (
                <div className="grid min-h-28 place-content-center px-4 text-center text-sm text-destructive">
                  {fetchError}
                </div>
              ) : fetchedModels.length > 0 ? (
                <div className="grid max-h-72 gap-1 overflow-y-auto rounded-xl border p-2">
                  {fetchedModels.map((model) => (
                    <ModelPickerRow
                      key={model.id}
                      model={model}
                      pendingIds={pendingIds}
                      setPendingIds={setPendingIds}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid min-h-28 place-content-center text-center text-sm text-muted-foreground">
                  {copy.settingsNoSelectedModels}
                </div>
              )}
            </TabsContent>
            <TabsContent className="mt-4 grid gap-3" value="existing">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>
                  {copy.settingsSelectedCurrentModels}: {pendingIds.length} /{" "}
                  {filteredModels.length}
                </span>
                <div className="flex gap-2">
                  <Button
                    onClick={() =>
                      setPendingIds(filteredModels.map((model) => model.id))
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {copy.settingsSelectAll}
                  </Button>
                  <Button
                    onClick={() =>
                      setPendingIds((current) =>
                        current.filter(
                          (id) =>
                            !filteredModels.some((model) => model.id === id),
                        ),
                      )
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {copy.settingsClearSelection}
                  </Button>
                </div>
              </div>
              <div className="grid max-h-72 gap-1 overflow-y-auto rounded-xl border p-2">
                {filteredModels.length > 0 ? (
                  filteredModels.map((model) => (
                    <ModelPickerRow
                      key={model.id}
                      model={model}
                      pendingIds={pendingIds}
                      setPendingIds={setPendingIds}
                    />
                  ))
                ) : (
                  <p className="p-10 text-center text-sm text-muted-foreground">
                    {copy.settingsNoSelectedModels}
                  </p>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button onClick={closePicker} type="button" variant="outline">
              {copy.settingsCancel}
            </Button>
            <Button onClick={confirmSelection} type="button">
              {copy.settingsConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ModelPickerRow({
  model,
  pendingIds,
  setPendingIds,
}: {
  model: ModelOption;
  pendingIds: string[];
  setPendingIds: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg p-3 hover:bg-muted">
      <Checkbox
        aria-label={model.name}
        checked={pendingIds.includes(model.id)}
        onCheckedChange={(nextChecked) =>
          setPendingIds((current) =>
            nextChecked
              ? [...new Set([...current, model.id])]
              : current.filter((id) => id !== model.id),
          )
        }
      />
      <span className="truncate text-sm font-medium">{model.name}</span>
    </label>
  );
}

function ModelRow({
  copy,
  model,
  onRemove,
}: {
  copy: ShellCopy;
  model: ModelOption;
  onRemove: () => void;
}) {
  return (
    <div
      aria-label={model.name}
      className="flex items-center justify-between gap-2 rounded-lg px-1 py-1"
    >
      <span className="min-w-0 truncate text-sm font-medium">{model.name}</span>
      <Button
        aria-label={`${copy.settingsDeleteChannel}: ${model.name}`}
        className="text-destructive hover:text-destructive"
        onClick={onRemove}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function normalizeCapabilities(
  current: Record<string, ChannelCapability[]>,
  modelIds: string[],
) {
  return Object.fromEntries(
    modelIds.map((modelId) => [
      modelId,
      current[modelId] ?? [...defaultCapabilities],
    ]),
  );
}

function cloneCapabilities(capabilities: Record<string, ChannelCapability[]>) {
  return Object.fromEntries(
    Object.entries(capabilities).map(([modelId, values]) => [
      modelId,
      [...values],
    ]),
  );
}

function dedupeModels(models: ModelOption[]) {
  return [...new Map(models.map((model) => [model.id, model])).values()];
}

function normalizeApiKeys(
  apiKeys: string[] | undefined,
  fallbackApiKey: string,
) {
  const values = [fallbackApiKey, ...(apiKeys?.slice(1) ?? [])]
    .map((apiKey) => apiKey.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

function parseApiKeys(value: string) {
  return normalizeApiKeys(value.split(/\r?\n/), value.split(/\r?\n/)[0] ?? "");
}

function getPrimaryApiKey(channel: Pick<ChannelConfig, "apiKey" | "apiKeys">) {
  return normalizeApiKeys(channel.apiKeys, channel.apiKey)[0] ?? "";
}

function normalizeProtocol(protocol: unknown): ChannelProtocol {
  if (protocol === "anthropic" || protocol === "Anthropic") {
    return "anthropic";
  }
  if (protocol === "google-gemini" || protocol === "Google Gemini") {
    return "google-gemini";
  }
  if (
    protocol === "volcengine-ark" ||
    protocol === "Ark" ||
    protocol === "Volcengine Ark"
  ) {
    return "volcengine-ark";
  }
  if (protocol === "autodl-comfyui" || protocol === "AutoDL ComfyUI") {
    return "autodl-comfyui";
  }
  return "openai-compatible";
}

function isChannelProtocol(value: string): value is ChannelProtocol {
  return (
    value === "openai-compatible" ||
    value === "anthropic" ||
    value === "google-gemini" ||
    value === "volcengine-ark" ||
    value === "autodl-comfyui"
  );
}

function getProtocolLabel(protocol: ChannelProtocol) {
  switch (normalizeProtocol(protocol)) {
    case "anthropic":
      return "Anthropic 官方";
    case "google-gemini":
      return "Google Gemini 官方";
    case "volcengine-ark":
      return "火山方舟官方";
    case "autodl-comfyui":
      return "AutoDL ComfyUI";
    default:
      return "OpenAI 兼容";
  }
}

function defaultBaseUrlForProtocol(
  protocol: ChannelProtocol,
  currentBaseUrl: string,
) {
  if (protocol !== "autodl-comfyui") return currentBaseUrl;
  return currentBaseUrl.trim() || AUTODL_COMFYUI_BASE_URL;
}

function composeChannelModelId(channelId: string, modelId: string) {
  return `${channelId}::${modelId}`;
}

function SecretInput({
  id,
  onChange,
  value,
}: {
  id: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        className="pr-10"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder="sk-..."
        type={visible ? "text" : "password"}
        value={value}
      />
      <Button
        aria-label={visible ? "Hide API Key" : "Show API Key"}
        className="absolute top-1/2 right-1 -translate-y-1/2"
        onClick={() => setVisible((current) => !current)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}

function createInitialChannels(
  copy: ShellCopy,
  runtimeConnection: RuntimeConnectionSettings,
  models: ModelOption[],
): ChannelConfig[] {
  const defaultModels = models.filter((model) => model.channelId === "default");
  const defaultChannel: ChannelConfig = {
    id: "default",
    name: copy.settingsDefaultChannel,
    protocol: runtimeConnection.protocol ?? "openai-compatible",
    baseUrl: runtimeConnection.baseUrl || "https://api.openai.com/v1",
    apiKey: runtimeConnection.apiKey,
    apiKeys: runtimeConnection.apiKey ? [runtimeConnection.apiKey] : [],
    apiKeyMode: "single",
    modelIds: defaultModels.map((model) => model.id),
    modelOptions: defaultModels,
    modelCapabilities: Object.fromEntries(
      defaultModels.map((model) => [model.id, defaultCapabilities]),
    ),
  };

  return [defaultChannel];
}

function toChannelConfig(channel: ApiChannel): ChannelConfig {
  const modelOptions = dedupeModels(
    (channel.models ?? []).map((model) => ({
      ...model,
      channelId: channel.id,
      channelName: channel.name,
      protocol: model.protocol ?? channel.protocol,
      id:
        model.id ||
        composeChannelModelId(channel.id, model.modelId || model.name),
    })),
  );
  return {
    id: channel.id,
    name: channel.name,
    protocol: channel.protocol,
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKeys[0] ?? "",
    apiKeys: normalizeApiKeys(channel.apiKeys, channel.apiKeys[0] ?? ""),
    apiKeyMode: channel.apiKeys.length > 1 ? "batch" : "single",
    modelIds: modelOptions
      .filter(
        (model) => (model as ModelOption & { selected?: boolean }).selected,
      )
      .map((model) => model.id),
    modelOptions,
    modelCapabilities: Object.fromEntries(
      modelOptions.map((model) => [model.id, defaultCapabilities]),
    ),
  };
}
