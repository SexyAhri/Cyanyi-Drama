import { fetchWithProviderRetry } from "@/lib/providers/http";

import {
  message,
  publicPullUrl,
  readObject,
  stringAt,
  trimUrl,
  waitForPoll,
} from "./shared";
import type { LipSyncProviderAdapter } from "./types";

export const viduLipSyncProvider: LipSyncProviderAdapter = {
  async generate(input) {
    const videoUrl = publicPullUrl(input.videoUrl, "video_url");
    const audioUrl = publicPullUrl(input.audioUrl, "audio_url");
    const trimmed = trimUrl(input.baseUrl || "https://api.vidu.cn");
    const apiBase = trimmed.endsWith("/ent/v2")
      ? trimmed
      : `${trimmed}/ent/v2`;
    const response = await fetchWithProviderRetry(`${apiBase}/lip-sync`, {
      method: "POST",
      headers: {
        Authorization: `Token ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ video_url: videoUrl, audio_url: audioUrl }),
    });
    const payload = await readObject(response);
    if (!response.ok)
      throw new Error(
        `VIDU_LIPSYNC_SUBMIT_FAILED:${response.status}:${message(payload)}`,
      );
    const taskId = stringAt(payload, "task_id");
    if (!taskId) throw new Error("VIDU_LIPSYNC_TASK_ID_MISSING");

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await waitForPoll();
      const statusResponse = await fetchWithProviderRetry(
        `${apiBase}/tasks/${encodeURIComponent(taskId)}/creations`,
        { headers: { Authorization: `Token ${input.apiKey}` } },
      );
      const statusPayload = await readObject(statusResponse);
      if (!statusResponse.ok)
        throw new Error(`VIDU_LIPSYNC_QUERY_FAILED:${statusResponse.status}`);
      const state = stringAt(statusPayload, "state").toLowerCase();
      if (state === "failed")
        throw new Error(
          `VIDU_LIPSYNC_FAILED:${stringAt(statusPayload, "err_code")}`,
        );
      if (state !== "success") continue;
      const creations = statusPayload.creations;
      const url =
        Array.isArray(creations) &&
        creations[0] &&
        typeof creations[0] === "object"
          ? stringAt(creations[0] as Record<string, unknown>, "url")
          : "";
      if (!url) throw new Error("VIDU_LIPSYNC_RESULT_URL_MISSING");
      return { url, providerTaskId: taskId };
    }
    throw new Error("VIDU_LIPSYNC_POLL_TIMEOUT");
  },
};
