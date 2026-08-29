export const PROMPT_IDS = {
  STORY_CHARACTER_ANALYSIS: "story_character_analysis",
  STORY_LOCATION_PROP_ANALYSIS: "story_location_prop_analysis",
  STORY_CLIP_SEGMENTATION: "story_clip_segmentation",
  STORY_SCREENPLAY_CONVERSION: "story_screenplay_conversion",
  STORY_SCREENPLAY_REVISION: "story_screenplay_revision",
  STORY_STORYBOARD_PLANNING: "story_storyboard_planning",
  STORY_CINEMATOGRAPHY: "story_cinematography",
  STORY_ACTING_DIRECTION: "story_acting_direction",
  STORY_STORYBOARD_REFINEMENT: "story_storyboard_refinement",
  STORY_VOICE_ANALYSIS: "story_voice_analysis",
  STORY_CONTINUITY_REVIEW: "story_continuity_review",
  ASSET_VISUAL_EXTRACTION: "asset_visual_extraction",
  ASSET_VISUAL_DESIGN: "asset_visual_design",
  STORYBOARD_MEDIA_PROMPT_DESIGN: "storyboard_media_prompt_design",
  CHARACTER_REFERENCE_DESCRIPTION: "character_reference_description",
  EPISODE_SPLIT: "episode_split",
  EPISODE_ADAPTATION: "episode_adaptation",
  STUDIO_WORKFLOW_AGENT: "studio_workflow_agent",
} as const;

export type PromptId = (typeof PROMPT_IDS)[keyof typeof PROMPT_IDS];
