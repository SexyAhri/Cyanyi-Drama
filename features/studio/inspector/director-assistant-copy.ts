import type { StudioAgentContext, StudioLocale } from "../types";

export const directorAssistantCopy = {
  "zh-CN": {
    title: "导演助手",
    description: "读取项目资料，提供创作建议并推进制作。",
    ask: "检查项目、调整内容，或让我启动制作流程…",
    send: "发送",
    selected: "当前选择",
    noSelection: "未选中对象",
    messages: "导演助手对话",
    model: "助手模型",
    working: "正在整理建议",
    empty: "这集，想怎么拍？",
    emptyCanvas: "从这个画面开始",
    canvas: "画布创作",
    episode: "整集",
    project: "项目",
    context: "当前上下文",
    inputHint: "Enter 发送 · Shift + Enter 换行",
    approvalHint: "修改会先展示，确认后执行",
    errorTitle: "回复未完成",
    errorDetails: "查看错误详情",
    errorRecovery: "你的输入已保留，可以调整后重新发送。",
    jump: "回到最新回复",
    draft: "填入输入框",
    needsApproval: "有操作待确认",
    noModel: "尚未选择模型",
    target: "修改目标",
    editShot: "编辑镜头内容",
    pickTarget: "选择镜头或画布节点",
    noTargets: "先在画布添加镜头或节点",
    targetHint: "点击画布卡片或在此选择，再输入修改要求。",
  },
  en: {
    title: "Director assistant",
    description: "Review project data, develop ideas, and advance production.",
    ask: "Review the project, suggest edits, or start a production step…",
    send: "Send",
    selected: "Selected",
    noSelection: "No object selected",
    messages: "Director conversation",
    model: "Assistant model",
    working: "Preparing suggestions",
    empty: "How should this episode unfold?",
    emptyCanvas: "Start with this frame",
    canvas: "Canvas",
    episode: "Episode",
    project: "Project",
    context: "Current context",
    inputHint: "Enter to send · Shift + Enter for a new line",
    approvalHint: "Review changes before they are applied",
    errorTitle: "Reply interrupted",
    errorDetails: "View error details",
    errorRecovery: "Your input is preserved. Edit it and send again.",
    jump: "Jump to latest reply",
    draft: "Add to composer",
    needsApproval: "Action awaiting approval",
    noModel: "Select a model",
    target: "Editing target",
    editShot: "Edit shot details",
    pickTarget: "Choose a shot or canvas node",
    noTargets: "Add a shot or node to the canvas first",
    targetHint:
      "Select a canvas card or choose here, then describe your changes.",
  },
} as const;

export function getDirectorSuggestions(
  context: StudioAgentContext,
  locale: StudioLocale,
) {
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  if (
    context.view === "canvas" &&
    ["character", "location", "prop"].includes(context.selection?.kind ?? "")
  )
    return [
      {
        title: t("完善形象", "Refine appearance"),
        prompt: t(
          "根据当前选中的角色或场景设定，给出具体的形象与风格建议。",
          "Suggest concrete appearance and style improvements from the selected asset's available description.",
        ),
      },
      {
        title: t("检查使用", "Check usage"),
        prompt: t(
          "检查当前资产是否选好了参考图片，以及哪些镜头或节点正在引用它，给出下一步建议。",
          "Check the selected asset's reference image and which shots or nodes use it. Suggest the next step.",
        ),
      },
      {
        title: t("如何复用", "Reuse this asset"),
        prompt: t(
          "告诉我怎么把当前角色或场景用于镜头，并在后续画面中保持一致。",
          "Explain how to use this character or location in shots and maintain consistency across later images.",
        ),
      },
    ];
  if (context.view === "canvas" && context.canvasNodeId)
    return [
      {
        title: t("完善画面", "Refine this frame"),
        prompt: t(
          "分析当前选中的节点及其引用，建议如何改善构图、人物表演和画面一致性。先给出建议。",
          "Review the selected node and its references. Suggest improvements to composition, performance, and visual consistency.",
        ),
      },
      {
        title: t("调整提示词", "Refine the prompt"),
        prompt: t(
          "请为当前选中节点提出一版更自然、动作更连贯的提示词草稿，保留角色和场景设定，展示修改前后供我确认。",
          "Propose a more natural, continuous prompt for the selected node. Preserve the characters and setting, and show the changes for review.",
        ),
      },
      {
        title: t("检查引用", "Check references"),
        prompt: t(
          "检查当前节点的角色、场景、首尾帧和台词音频引用，说明有没有缺失或不兼容的输入。",
          "Check the selected node's characters, setting, frames, and dialogue references for missing or incompatible inputs.",
        ),
      },
    ];
  if (context.stageId === "storyboard" || context.stageId === "shots")
    return [
      {
        title: t("镜头建议", "Shot direction"),
        prompt: t(
          "根据当前镜头与已有制作状态，给出构图、镜头运动和人物表演建议。",
          "Suggest composition, camera movement, and performance for the current shot, using the available production state.",
        ),
      },
      {
        title: t("衔接检查", "Continuity review"),
        prompt: t(
          "检查当前可见的镜头衔接信息，指出角色位置、动作、视线和场景连续性需要确认的地方。没有数据的部分请明确说明。",
          "Review available shot continuity: position, movement, eyelines, and setting. Identify missing information explicitly.",
        ),
      },
      {
        title: t("失败原因", "Review failures"),
        prompt: t(
          "列出当前阶段失败的任务，说明可见错误原因与下一步处理建议。",
          "List failed tasks in this stage and explain the visible errors and next steps.",
        ),
      },
    ];
  if (context.stageId === "audio")
    return [
      {
        title: t("台词表演", "Dialogue performance"),
        prompt: t(
          "根据当前可见的台词与镜头信息，给出演员语气、停顿与节奏建议。",
          "Suggest delivery, pauses, and pacing from the available dialogue and shot information.",
        ),
      },
      {
        title: t("口型检查", "Lip sync review"),
        prompt: t(
          "检查当前声音阶段可见的任务与素材状态，说明口型生成还缺什么，特别关注说话人与台词对应。",
          "Review the audio stage for lip sync prerequisites, especially speaker and dialogue alignment.",
        ),
      },
      {
        title: t("失败原因", "Review failures"),
        prompt: t(
          "分析声音阶段失败任务的可见错误，并建议下一步。",
          "Explain visible errors in failed audio tasks and suggest next steps.",
        ),
      },
    ];
  return [
    {
      title: t("制作进度", "Production status"),
      prompt: t(
        "总结当前剧集与阶段的制作进度，指出接下来最应该处理的事情。",
        "Summarize this episode's production state and recommend the next step.",
      ),
    },
    {
      title: t("创作建议", "Creative direction"),
      prompt: t(
        "根据当前项目、阶段和选中对象，给出具体的创作建议；缺少的信息请说明。",
        "Give concrete creative advice from the current project, stage, and selection. Identify missing information.",
      ),
    },
    {
      title: t("检查问题", "Review issues"),
      prompt: t(
        "检查当前阶段的失败、阻塞和待确认内容，给出处理顺序。",
        "Review failures, blockers, and pending decisions in this stage, and prioritize them.",
      ),
    },
  ];
}
