import type { AgentComposerMetadata } from "./model-messages";
import type { AgentMessage } from "./types";
type ChatMediaToolIntent = { enableImage: boolean; enableVideo: boolean };

function hasPattern(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

export function getLastMediaToolKind(messages: AgentMessage[] = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const toolName = messages[index]?.toolCall?.name;

    if (toolName === "image_generation") {
      return "image" as const;
    }

    if (toolName === "video_generation") {
      return "video" as const;
    }
  }

  return null;
}

export function detectChatMediaToolIntent({
  composer,
  content,
  messages,
}: {
  composer?: AgentComposerMetadata;
  content: string;
  messages?: AgentMessage[];
}): ChatMediaToolIntent {
  const text = content.trim();

  if (!text) {
    return {
      enableImage: false,
      enableVideo: false,
    };
  }

  const imageReferenceCount =
    (composer?.referenceImages?.length ?? 0) +
    (composer?.referenceImage ? 1 : 0);
  const hasReferenceImages = imageReferenceCount > 0;

  const analysisPatterns = [
    /describe|analy[sz]e|explain|identify|summari[sz]e|extract|ocr|caption|what(?:'s| is) in/i,
    /解释|分析|描述|识别|总结|提取|翻译|读图|看图|是什么|什么意思|检查|查看|有没有|是否|工具|agent|ocr/i,
  ];
  const imageGenerationPatterns = [
    /generate (an? )?(image|picture|photo|poster|cover|illustration)|create (an? )?(image|picture|poster|illustration)|render (an? )?image|edit (this )?image|make (an? )?(image|poster|cover)|image edit/i,
    /生图|生成.*(图片|图像|照片|海报|封面)|画.*图|做.*图|出.*图|图片生成|图像生成|海报|封面|插画|改图|修图|以图生图|参考图|(?:帮我)?(?:画|绘制|制作|创建|生成|做|来|整).{0,12}(?:一张|一幅|张图|图片|图像|照片|海报|封面|插画)|(?:先给我|给我|请给我).{0,4}(?:一张|一幅|张图|图片|图像|照片|海报|封面|插画)/i,
  ];
  const videoGenerationPatterns = [
    /generate (a )?video|create (a )?video|make (a )?video|animate|animation|motion clip|camera move/i,
    /生成.*视频|做.*视频|出.*视频|视频生成|动画|短片|运镜|镜头运动|(?:帮我)?(?:生成|制作|创建|做|来|整).{0,12}(?:一段|一个|个|段)视频|(?:先给我|给我|请给我).{0,4}(?:一段|一个|个|段)视频/i,
  ];
  const retryPatterns = [
    /retry|try again|regenerate|continue generating/i,
    /重试|再试|重新生成|继续生成|再来一次/i,
  ];
  const imageEditPatterns = [
    /keep .* unchanged|replace|swap|change .* to|use .* as reference/i,
    /保持|不变|替换|改成|换成|换掉|套上|参考.*衣服|参考.*款式/i,
  ];

  const wantsImage = hasPattern(text, imageGenerationPatterns);
  const wantsVideo = hasPattern(text, videoGenerationPatterns);
  const wantsAnalysis = hasPattern(text, analysisPatterns);
  const wantsRetry = hasPattern(text, retryPatterns);
  const wantsImageEdit =
    hasReferenceImages && hasPattern(text, imageEditPatterns);
  const asksAboutCapability =
    /(?:有没有|是否|能不能|能否|可以吗|检查|查看).*(?:图片|视频|生成|工具|agent|调用)/i.test(
      text,
    ) || /(?:图片|视频|生成|工具|agent).*(?:吗|么|？|\?)\s*$/i.test(text);

  if (asksAboutCapability && !wantsImageEdit) {
    return {
      enableImage: false,
      enableVideo: false,
    };
  }

  if (wantsAnalysis && !wantsImage && !wantsVideo && !wantsImageEdit) {
    return {
      enableImage: false,
      enableVideo: false,
    };
  }

  if (wantsImageEdit) {
    return {
      enableImage: true,
      enableVideo: false,
    };
  }

  if (wantsImage || wantsVideo) {
    return {
      enableImage: wantsImage,
      enableVideo: wantsVideo,
    };
  }

  if (wantsRetry) {
    const lastMediaToolKind = getLastMediaToolKind(messages);

    return {
      enableImage: lastMediaToolKind === "image",
      enableVideo: lastMediaToolKind === "video",
    };
  }

  if (
    hasReferenceImages &&
    !wantsAnalysis &&
    /prompt|提示词|改一下|优化一下|怎么做|怎么改/i.test(text)
  ) {
    return {
      enableImage: false,
      enableVideo: false,
    };
  }

  return {
    enableImage: false,
    enableVideo: false,
  };
}

