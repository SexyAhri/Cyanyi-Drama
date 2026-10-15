export function billingUnitLabel(unit: string, locale: "zh-CN" | "en" = "zh-CN") {
  if (locale === "en") return unit;
  return ({ request: "次", image: "张", second: "秒", minute: "分钟", character: "字符", "1k_character": "千字符", "1m_character": "百万字符", "1m_input_tokens": "百万输入 Token", "1m_output_tokens": "百万输出 Token", "1m_cached_input_tokens": "百万缓存读取 Token", "1m_cache_write_tokens": "百万缓存写入 Token", task: "任务", mixed: "组合用量", tokens: "Token", input_tokens: "输入令牌", output_tokens: "输出令牌" } as Record<string, string>)[unit] ?? "用量";
}

export function billingBreakdownLines(metadata?: string | null, locale: "zh-CN" | "en" = "zh-CN"): string[] {
  if (!metadata) return [];
  try {
    const parsed = JSON.parse(metadata);
    if (!parsed.tokenMetered || !Array.isArray(parsed.components)) return [];
    const labels: Record<string, string> = locale === "zh-CN"
      ? { "1m_input_tokens": "输入（未缓存）", "1m_output_tokens": "输出", "1m_cached_input_tokens": "缓存读取", "1m_cache_write_tokens": "缓存写入" }
      : { "1m_input_tokens": "Uncached input", "1m_output_tokens": "Output", "1m_cached_input_tokens": "Cache read", "1m_cache_write_tokens": "Cache write" };
    return parsed.components.filter((component: { unit?: string }) => component && labels[component.unit ?? ""]).map((component: { unit: string; quantity: number; unitPrice: string; amount: string }) =>
      `${labels[component.unit]} ${Math.round(Number(component.quantity) * 1e6).toLocaleString(locale)} Token × ¥${component.unitPrice}/M = ¥${component.amount}`);
  } catch { return []; }
}

const usageCostActionZh: Record<string, string> = {
  chat_completion: "对话模型请求",
  model_request: "模型请求",
  story_package_generation: "剧集策划生成",
  story_voice_performance_design: "对白表演设计",
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

