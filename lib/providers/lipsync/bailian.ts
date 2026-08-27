import { fetchWithProviderRetry } from "@/lib/providers/http";

import {
  firstResultUrl,
  message,
  nestedString,
  publicPullUrl,
  readObject,
  stringAt,
  trimUrl,
  waitForPoll,
} from "./shared";
import type { LipSyncProviderAdapter } from "./types";

export const bailianLipSyncProvider: LipSyncProviderAdapter = {
  async generate(input) {
    const trimmed = trimUrl(input.baseUrl || "https://dashscope.aliyuncs.com");
    const apiBase = trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
    const response = await fetchWithProviderRetry(
      `${apiBase}/services/aigc/image2video/video-synthesis`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
          "X-DashScope-Async": "enable",
          "X-DashScope-OssResourceResolve": "enable",
        },
        body: JSON.stringify({
          model: input.model,
          input: {
            video_url: publicPullUrl(input.videoUrl, "video_url"),
            audio_url: publicPullUrl(input.audioUrl, "audio_url"),
          },
        }),
      },
    );
    const payload = await readObject(response);
    if (!response.ok)
      throw new Error(
        `BAILIAN_LIPSYNC_SUBMIT_FAILED:${response.status}:${message(payload)}`,
      );
    const taskId = nestedString(payload, ["output", "task_id"]);
    if (!taskId) throw new Error("BAILIAN_LIPSYNC_TASK_ID_MISSING");

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await waitForPoll();
      const statusResponse = await fetchWithProviderRetry(
        `${apiBase}/tasks/${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${input.apiKey}` } },
      );
      const statusPayload = await readObject(statusResponse);
      if (!statusResponse.ok)
        throw new Error(
          `BAILIAN_LIPSYNC_QUERY_FAILED:${statusResponse.status}`,
        );
      const status = (
        nestedString(statusPayload, ["output", "task_status"]) ||
        stringAt(statusPayload, "task_status")
      ).toUpperCase();
      if (["FAILED", "CANCELED", "UNKNOWN"].includes(status))
        throw new Error(`BAILIAN_LIPSYNC_FAILED:${message(statusPayload)}`);
      if (status !== "SUCCEEDED") continue;
      const url =
        nestedString(statusPayload, ["output", "video_url"]) ||
        firstResultUrl(statusPayload);
      if (!url) throw new Error("BAILIAN_LIPSYNC_RESULT_URL_MISSING");
      return { url, providerTaskId: taskId };
    }
    throw new Error("BAILIAN_LIPSYNC_POLL_TIMEOUT");
  },
};
