const names: Record<string, [string, string]> = {
  studio_workflow_agent: ["项目助手", "Project assistant"],
  source_notes: ["原著资料整理", "Source notes"],
  production_script_organization: ["剧本整理", "Script organization"],
  story_character_analysis: ["角色分析", "Character analysis"],
  story_location_prop_analysis: ["场景与道具分析", "Locations & props"],
  story_clip_segmentation: ["剧情分段", "Story segmentation"],
  story_screenplay_beats: ["剧情节拍", "Screenplay beats"],
  story_screenplay_dialogue: ["对白写作", "Dialogue writing"],
  story_screenplay_narration: ["旁白写作", "Narration writing"],
  story_screenplay_effects: ["音效写作", "Sound effects writing"],
  story_screenplay_revision: ["剧本修订", "Screenplay revision"],
  story_storyboard_planning: ["分镜规划", "Storyboard planning"],
  story_cinematography: ["摄影设计", "Cinematography"],
  story_acting_direction: ["表演指导", "Acting direction"],
  story_storyboard_refinement: ["分镜细化", "Storyboard refinement"],
  story_voice_analysis: ["台词分析", "Speech analysis"],
  story_voice_performance_design: ["声音表演设计", "Voice performance"],
  story_continuity_review: ["连续性审查", "Continuity review"],
  asset_visual_extraction: ["资产视觉提取", "Visual extraction"],
  asset_visual_design: ["资产视觉设计", "Visual design"],
  storyboard_media_prompt_design: ["镜头提示词设计", "Shot prompt design"],
  storyboard_video_review: ["成片抽帧视觉诊断", "Sampled video diagnosis"],
  character_reference_description: ["角色参考描述", "Character references"],
  episode_split: ["剧集划分", "Episode splitting"],
  episode_adaptation: ["剧集改编", "Episode adaptation"],
  story_package_generation: ["故事方案", "Story package"],
  "production_storyboard-generation": ["分镜生成", "Storyboard generation"],
  "production_storyboard-review": ["分镜审查", "Storyboard review"],
  "production_storyboard-repair": ["分镜修正", "Storyboard repair"],
  "production_video-prompt-generation": [
    "视频提示词生成",
    "Video prompt generation",
  ],
  "production_asset-prompt-generation": [
    "资产提示词生成",
    "Asset prompt generation",
  ],
  "production_script-generation": ["剧本生成", "Script generation"],
};

export function agentDisplayName(
  id: string,
  fallback: string,
  english: boolean,
) {
  return names[id]?.[english ? 1 : 0] ?? fallback;
}
