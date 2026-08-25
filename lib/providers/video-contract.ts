export type VideoReference = {
  url: string;
  mimeType?: string;
  role?: "reference_image" | "first_frame" | "last_frame";
};

export type VideoGenerationRequest = {
  prompt?: string;
  ratio?: string;
  resolution?: string;
  duration?: string;
  videoMode?: string;
};

export function buildVideoProviderContract(input: {
  protocol: string;
  model: string;
  request: VideoGenerationRequest;
  references: VideoReference[];
  createPath?: string;
  statusPath?: string;
}) {
  if (input.protocol === "volcengine-ark") {
    return {
      createPath: "contents/generations/tasks",
      statusPath: (taskId: string) =>
        `contents/generations/tasks/${encodeURIComponent(taskId)}`,
      body: {
        model: input.model,
        content: [
          { type: "text", text: input.request.prompt ?? "" },
          ...input.references.slice(0, 9).map((reference) => ({
            type: "image_url",
            image_url: { url: reference.url },
            role: reference.role ?? "reference_image",
          })),
        ],
        ratio: normalizeArkRatio(input.request.ratio),
        resolution: normalizeArkResolution(input.request.resolution),
        duration: normalizeDuration(input.request.duration),
        generate_audio: true,
        watermark: false,
      },
    };
  }

  const referenceImages = input.references
    .filter((reference) => (reference.role ?? "reference_image") === "reference_image")
    .map((reference) => reference.url);
  const firstFrame = input.references.find(
    (reference) => reference.role === "first_frame",
  )?.url;
  const lastFrame = input.references.find(
    (reference) => reference.role === "last_frame",
  )?.url;
  return {
    createPath: trimPath(input.createPath || "videos"),
    statusPath: (taskId: string) =>
      trimPath(input.statusPath || "videos/{id}").replace(
        "{id}",
        encodeURIComponent(taskId),
      ),
    body: {
      model: input.model,
      prompt: input.request.prompt ?? "",
      seconds: input.request.duration?.replace(/s$/i, ""),
      size: resolveVideoSize(input.request.ratio),
      resolution: input.request.resolution,
      ...(input.request.videoMode === "first-last"
        ? { first_frame: firstFrame, last_frame: lastFrame }
        : {}),
      ...(referenceImages.length ? { image: referenceImages } : {}),
    },
  };
}

function trimPath(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function resolveVideoSize(ratio?: string) {
  if (!ratio) return undefined;
  const normalized = ratio.trim();
  if (/^\d+x\d+$/i.test(normalized)) return normalized;
  return {
    "1:1": "1024x1024",
    "16:9": "1792x1024",
    "9:16": "1024x1792",
    "4:3": "1365x1024",
    "3:4": "1024x1365",
  }[normalized];
}

function normalizeArkRatio(ratio?: string) {
  return ratio?.trim() || "16:9";
}

function normalizeArkResolution(resolution?: string) {
  const normalized = resolution?.trim().toLowerCase();
  if (normalized === "720p" || normalized === "1080p") return normalized;
  return "1080p";
}

function normalizeDuration(duration?: string) {
  const value = Number.parseInt(duration?.replace(/s$/i, "") || "5", 10);
  return Number.isFinite(value) && value > 0 ? value : 5;
}
