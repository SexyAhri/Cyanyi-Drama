import { z } from "zod";

const coordinate = z.number().finite().min(-1000000).max(1000000);
export const canvasPurposeSchema = z.enum([
  "context",
  "reference",
  "first_frame",
  "last_frame",
  "dialogue",
  "causality",
  "shot_sequence",
  "story_asset",
  "episode_bridge",
  "shot_video",
]);
export const canvasDocumentSchema = z.object({
  layoutMode: z.enum(["branches", "episode", "free"]).optional(),
  branchGroups: z
    .array(
      z.object({
        id: z.string().max(100),
        label: z.string().max(300),
        nodeIds: z.array(z.string().max(100)).max(1000),
        x: coordinate,
        y: coordinate,
      }),
    )
    .max(1000)
    .optional(),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        kind: z.enum([
          "text",
          "panel",
          "image",
          "video",
          "audio",
          "character",
          "location",
          "prop",
        ]),
        title: z.string().max(300),
        text: z.string().max(30000),
        videoText: z.string().max(30000).optional(),
        x: coordinate,
        y: coordinate,
        panelId: z.string().max(100).optional(),
        assetId: z.string().max(100).optional(),
        entityId: z.string().max(100).optional(),
        sourceEpisodeId: z.string().max(100).optional(),
        episodeLayer: z.enum(["shot_video", "asset_image"]).optional(),
        outputKind: z.enum(["image", "video"]).optional(),
        modelId: z.string().max(300).optional(),
        panelPromptBase: z
          .object({
            image: z.string().max(30000),
            video: z.string().max(30000),
          })
          .optional(),
        promptVersions: z
          .array(
            z.object({
              id: z.string().max(100),
              kind: z.enum(["image", "video"]),
              prompt: z.string().max(60000),
              createdAt: z.string().max(40),
            }),
          )
          .max(12)
          .optional(),
      }),
    )
    .max(1000),
  edges: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        from: z.string().max(100),
        to: z.string().max(100),
        purpose: canvasPurposeSchema.optional(),
      }),
    )
    .max(3000),
  viewport: z.object({
    x: coordinate,
    y: coordinate,
    k: z.number().min(0.05).max(5),
  }),
});
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>;
export type CanvasCard = CanvasDocument["nodes"][number];
export type CanvasEdge = CanvasDocument["edges"][number];
export type CanvasPurpose = z.infer<typeof canvasPurposeSchema>;

export function canvasEdgePurpose(
  edge: CanvasEdge,
  from: CanvasCard,
): CanvasPurpose {
  return (
    edge.purpose ??
    (from.kind === "text"
      ? "context"
      : from.kind === "audio"
        ? "dialogue"
        : "reference")
  );
}

export function canvasConnectionError(
  from: CanvasCard,
  to: CanvasCard,
  purpose: CanvasPurpose,
) {
  if (from.id === to.id) return "不能连接节点自身";
  if (purpose === "causality")
    return from.panelId && to.panelId ? "" : "剧情因果线只能连接本集镜头";
  if (purpose === "shot_sequence")
    return from.kind === "panel" && to.kind === "panel" && from.panelId && to.panelId ? "" : "镜头顺序线只能连接本集镜头";
  if (purpose === "episode_bridge")
    return from.sourceEpisodeId && to.panelId ? "" : "跨集承接线需要从上一集结尾连到本集镜头";
  if (purpose === "shot_video")
    return from.kind === "panel" && to.kind === "video" && from.panelId && (!to.panelId || from.panelId === to.panelId)
      ? ""
      : "镜头视频线需要连接同一镜头与其视频节点";
  if (purpose === "story_asset")
    return ["character", "location", "prop"].includes(from.kind) &&
      Boolean(from.entityId) &&
      (Boolean(to.panelId) || to.kind === "image")
      ? ""
      : "资产关联线需要连接角色、场景或道具与本集镜头或图片节点";
  if (!["panel", "image", "video"].includes(to.kind))
    return "请连接到图片、视频或镜头节点";
  if (purpose === "context")
    return from.text.trim() ? "" : "源节点还没有可引用的文字";
  if (purpose === "dialogue")
    return from.kind !== "audio"
      ? "台词音频需要音频节点"
      : !to.panelId
        ? "请先关联正式镜头，再处理配音和口型"
        : "";
  if (from.kind === "audio" || from.kind === "video")
    return "此用途需要图片节点或角色、场景素材";
  if (
    (purpose === "first_frame" || purpose === "last_frame") &&
    to.kind === "image"
  )
    return "首尾帧只能用于视频或镜头节点";
  if (!from.assetId && !from.panelId) return "请先为源节点生成或选择图片版本";
  return "";
}

export function compileCanvasInput(
  document: CanvasDocument,
  node: CanvasCard,
  kind: "image" | "video",
) {
  const inputs = document.edges
    .filter((edge) => edge.to === node.id)
    .flatMap((edge) => {
      const source = document.nodes.find((item) => item.id === edge.from);
      return source
        ? [{ edge, source, purpose: canvasEdgePurpose(edge, source) }]
        : [];
    });
  const prompt = [
    kind === "video" ? (node.videoText ?? node.text) : node.text,
    ...inputs
      .filter((item) => item.purpose === "context")
      .map((item) => `${item.source.title}：${item.source.text}`),
  ]
    .filter((value) => value?.trim())
    .join("\n\n");
  return { prompt, inputs };
}
