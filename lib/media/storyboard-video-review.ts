import { listOwnedProjectMediaAssets } from "@/lib/assets/project-store";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { currentProductionConfiguration, withProductionConfiguration } from "@/lib/production-configuration/context";
import { resolveProductionConfiguration } from "@/lib/production-configuration/store";
import { PROMPT_IDS, renderPrompt } from "@/lib/prompts";
import { sampleVideoFrames } from "@/lib/providers/local/video-frames";
import { resolvePromptDesignProvider, resolveStoryboardPromptContext, serializePanel, StoryboardPromptDesignError, type StoryboardPromptInput } from "./storyboard-prompt-design";
import { videoVisualReviewSchema, type VideoVisualReviewResult } from "./visual-review-contract";

export async function reviewStoryboardVideo(input: Omit<StoryboardPromptInput, "kind">) {
  const context = await resolveStoryboardPromptContext(input);
  const videoAssetId = context.panel.videoAssetId;
  if (!videoAssetId) throw new StoryboardPromptDesignError("请先采用一个视频再进行抽帧诊断", 409);
  const provider = await resolvePromptDesignProvider(input);
  const [video] = await listOwnedProjectMediaAssets(input.userId, input.projectId, [videoAssetId], ["video"]);
  const referenceAssetIds = context.panel.imageAssetId ? [context.panel.imageAssetId] : [];
  const references = await listOwnedProjectMediaAssets(input.userId, input.projectId, referenceAssetIds, ["image"]);
  const sampled = await sampleVideoFrames(video.url);
  const frames = sampled.frames.map(({ frameNumber, second }) => ({ frameNumber, second }));
  const prompt = renderPrompt({ id: PROMPT_IDS.STORYBOARD_VIDEO_REVIEW, locale: input.locale, variables: {
    shot_json: JSON.stringify({ shot: serializePanel(context.panel), adjacent: context.adjacent.map(serializePanel), assetProfiles: context.assetProfiles }),
    reference_frames_json: JSON.stringify(references.map((asset, index) => ({ imageNumber: index + 1, assetId: asset.id, role: "first_frame" }))),
    sample_frames_json: JSON.stringify(frames.map((frame, index) => ({ ...frame, imageNumber: references.length + index + 1 }))),
  } });
  // Preserve facts and attachment mapping even when a user supplies a custom Agent template.
  prompt.platformContract = prompt.text;
  const configuration = currentProductionConfiguration()?.snapshot ?? await resolveProductionConfiguration(input.userId, input);
  const result = await withProductionConfiguration(input.userId, configuration, () => requestOpenAiStructured({
    ...provider, prompt, schema: videoVisualReviewSchema, requireVisionModel: true,
    imageUrls: [...references.map((asset) => asset.url), ...sampled.frames.map((frame) => frame.imageUrl)], temperature: 0.2,
    validate: (data) => data.findings.flatMap((finding, index) => finding.frameNumbers.some((number) => !frames.some((frame) => frame.frameNumber === number))
      ? [{ code: "SAMPLE_FRAME_INVALID", path: `findings.${index}.frameNumbers`, message: "只能引用实际附带的采样帧编号" }] : []),
  }));
  const output: VideoVisualReviewResult = {
    review: result.data, videoAssetId, referenceAssetIds, frames, durationSeconds: sampled.durationSeconds,
    coverage: "sampled_frames_only", audio: "not_checked", continuousMotion: "not_checked",
  };
  return { ...output, rawOutput: result.outputText, trace: result.trace };
}
