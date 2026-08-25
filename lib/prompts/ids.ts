export const PROMPT_IDS = {
  STORY_CHARACTER_ANALYSIS: "story_character_analysis",
  STORY_LOCATION_PROP_ANALYSIS: "story_location_prop_analysis",
  STORY_CLIP_SEGMENTATION: "story_clip_segmentation",
  STORY_SCREENPLAY_CONVERSION: "story_screenplay_conversion",
  STORY_STORYBOARD_PLANNING: "story_storyboard_planning",
  STORY_CINEMATOGRAPHY: "story_cinematography",
  STORY_ACTING_DIRECTION: "story_acting_direction",
  STORY_STORYBOARD_REFINEMENT: "story_storyboard_refinement",
  STORY_VOICE_ANALYSIS: "story_voice_analysis",
} as const;

export type PromptId = (typeof PROMPT_IDS)[keyof typeof PROMPT_IDS];
