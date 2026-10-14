export function billingUnitLabel(unit: string, locale: "zh-CN" | "en" = "zh-CN") {
  if (locale === "en") return unit;
  return ({ request: "次", image: "张", second: "秒", minute: "分钟", character: "字符", "1k_character": "千字符", task: "任务", mixed: "组合用量", tokens: "令牌", input_tokens: "输入令牌", output_tokens: "输出令牌" } as Record<string, string>)[unit] ?? "用量";
}

const usageCostActionZh: Record<string, string> = {
  chat_completion: "对话模型请求",
  model_request: "模型请求",
  "agent test run estimate": "Agent 试运行费用估算",
  canvas_node: "画布节点生成",
  character_appearance: "角色形象图生成",
  character: "角色图片生成",
  location: "场景图片生成",
  prop: "道具图片生成",
  storyboard_panel: "分镜素材生成",
  global_character_appearance: "全局角色形象生成",
  global_location_image: "全局场景图片生成",
  global_voice_design: "全局角色声音设计",
  episode: "剧集制作任务",
  episode_assets: "剧集资产图生成",
  episode_audio: "剧集配音生成",
  lip_sync: "口型同步",
  editor_render: "成片渲染",
  vfx_element: "特效元素生成",
  vfx_composite: "特效合成",
  voice_line: "角色配音生成",
  manuscript: "原著分析",
  project_asset_selection: "项目资产选择",
  image: "图片生成",
  video: "视频生成",
  audio: "音频生成",
  lipsync: "口型同步",
};

export function billingActionLabel(action: string, locale: "zh-CN" | "en" = "zh-CN") {
  if (locale === "en") return action;
  const normalized = action.trim().toLocaleLowerCase("en-US");
  if (usageCostActionZh[normalized]) return usageCostActionZh[normalized];
  if (/[^\x00-\x7f]/.test(action)) return action;
  return "其他模型任务";
}

