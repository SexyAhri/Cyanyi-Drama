"use client";

import type { RuntimeSettings } from "./runtime-contract";

const RUNTIME_SETTINGS_UPDATED_EVENT = "cyanyi:runtime-settings-updated";

export async function loadRuntimeSettings() {
  const response = await fetch("/api/settings/runtime", { cache: "no-store" });
  const payload = await readRuntimeSettingsResponse(response);

  if (!response.ok || !payload.settings) {
    throw new Error(payload.message || "运行设置加载失败");
  }

  return payload.settings;
}

export async function saveRuntimeSettings(settings: RuntimeSettings) {
  const response = await fetch("/api/settings/runtime", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  const payload = await readRuntimeSettingsResponse(response);

  if (!response.ok || !payload.settings) {
    throw new Error(payload.message || "运行设置保存失败");
  }

  window.dispatchEvent(
    new CustomEvent<RuntimeSettings>(RUNTIME_SETTINGS_UPDATED_EVENT, {
      detail: payload.settings,
    }),
  );
  return payload.settings;
}

async function readRuntimeSettingsResponse(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return {
      message: response.ok
        ? "运行设置接口返回了空响应"
        : `运行设置请求失败（HTTP ${response.status}）`,
    };
  }

  try {
    return JSON.parse(text) as {
      message?: string;
      settings?: RuntimeSettings;
    };
  } catch {
    return { message: `运行设置接口返回了无效响应（HTTP ${response.status}）` };
  }
}

export function subscribeToRuntimeSettings(
  listener: (settings: RuntimeSettings) => void,
) {
  const handleUpdate = (event: Event) => {
    listener((event as CustomEvent<RuntimeSettings>).detail);
  };

  window.addEventListener(RUNTIME_SETTINGS_UPDATED_EVENT, handleUpdate);
  return () =>
    window.removeEventListener(RUNTIME_SETTINGS_UPDATED_EVENT, handleUpdate);
}
