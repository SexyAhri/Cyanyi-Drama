import { fetchWithProviderRetry } from "@/lib/providers/http";

import {
  message,
  nestedString,
  readObject,
  stringAt,
  toDataUrl,
  trimPath,
  trimUrl,
  waitForPoll,
} from "./shared";
import type { LipSyncProviderAdapter } from "./types";

export const falLipSyncProvider: LipSyncProviderAdapter = {
  async generate(input) {
    const baseUrl = trimUrl(input.baseUrl || "https://queue.fal.run");
    const [videoUrl, audioUrl] = await Promise.all([
      toDataUrl(input.videoUrl),
      toDataUrl(input.audioUrl),
    ]);
    const response = await fetchWithProviderRetry(
      `${baseUrl}/${trimPath(input.model)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Key ${input.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ video_url: videoUrl, audio_url: audioUrl }),
      },
    );
    const payload = await readObject(response);
    if (!response.ok)
      throw new Error(
        `FAL_LIPSYNC_SUBMIT_FAILED:${response.status}:${message(payload)}`,
      );
    const requestId = stringAt(payload, "request_id");
    if (!requestId) throw new Error("FAL_LIPSYNC_TASK_ID_MISSING");
    const [owner, alias] = trimPath(input.model).split("/");
    if (!owner || !alias) throw new Error("FAL_LIPSYNC_MODEL_INVALID");

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await waitForPoll();
      const statusResponse = await fetchWithProviderRetry(
        `${baseUrl}/${owner}/${alias}/requests/${encodeURIComponent(requestId)}/status?logs=0`,
        { headers: { Authorization: `Key ${input.apiKey}` } },
      );
      if (!statusResponse.ok) continue;
      const statusPayload = await readObject(statusResponse);
      const status = stringAt(statusPayload, "status").toUpperCase();
      if (status === "FAILED")
        throw new Error(`FAL_LIPSYNC_FAILED:${message(statusPayload)}`);
      if (status !== "COMPLETED") continue;
      const responseUrl = stringAt(statusPayload, "response_url");
      const resultResponse = await fetchWithProviderRetry(
        responseUrl ||
          `${baseUrl}/${trimPath(input.model)}/requests/${encodeURIComponent(requestId)}`,
        {
          headers: {
            Authorization: `Key ${input.apiKey}`,
            Accept: "application/json",
          },
        },
      );
      const result = await readObject(resultResponse);
      if (!resultResponse.ok)
        throw new Error(
          `FAL_LIPSYNC_RESULT_FAILED:${resultResponse.status}:${message(result)}`,
        );
      const url = nestedString(result, ["video", "url"]);
      if (!url) throw new Error("FAL_LIPSYNC_RESULT_URL_MISSING");
      return { url, providerTaskId: requestId };
    }
    throw new Error("FAL_LIPSYNC_POLL_TIMEOUT");
  },
};
