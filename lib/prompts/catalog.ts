import { PROMPT_IDS, type PromptId } from "./ids";
import type { PromptCatalogEntry } from "./types";

export const PROMPT_CATALOG: Record<PromptId, PromptCatalogEntry> = {
  [PROMPT_IDS.STORY_CHARACTER_ANALYSIS]: {
    pathStem: "domain/story_character_analysis",
    version: 1,
    variables: ["source_text", "character_library"],
    agent: {
      id: "casting_director",
      responsibility:
        "Identify canonical characters and evidence-backed profiles.",
      prohibited: ["scene planning", "shot design", "inventing characters"],
    },
  },
  [PROMPT_IDS.STORY_LOCATION_PROP_ANALYSIS]: {
    pathStem: "domain/story_location_prop_analysis",
    version: 1,
    variables: ["source_text", "location_library", "prop_library"],
    agent: {
      id: "production_designer",
      responsibility:
        "Identify reusable locations and continuity-critical props.",
      prohibited: ["character profiling", "shot design", "inventing assets"],
    },
  },
  [PROMPT_IDS.STORY_CLIP_SEGMENTATION]: {
    pathStem: "domain/story_clip_segmentation",
    version: 1,
    variables: [
      "source_text",
      "character_library",
      "location_library",
      "prop_library",
    ],
    agent: {
      id: "story_editor",
      responsibility:
        "Split source text at narrative boundaries without gaps or overlap.",
      prohibited: [
        "rewriting source text",
        "storyboard planning",
        "new dialogue",
      ],
    },
  },
  [PROMPT_IDS.STORY_SCREENPLAY_CONVERSION]: {
    pathStem: "domain/story_screenplay_conversion",
    version: 1,
    variables: [
      "clip_id",
      "clip_text",
      "character_library",
      "location_library",
      "prop_library",
    ],
    agent: {
      id: "screenwriter",
      responsibility:
        "Convert one clip into screenplay structure while preserving source facts.",
      prohibited: [
        "expanding the story",
        "inventing action",
        "changing dialogue",
      ],
    },
  },
  [PROMPT_IDS.STORY_STORYBOARD_PLANNING]: {
    pathStem: "domain/story_storyboard_planning",
    version: 1,
    variables: [
      "source_text",
      "characters_json",
      "locations_json",
      "props_json",
    ],
    agent: {
      id: "storyboard_director",
      responsibility: "Plan ordered shots that cover the source narrative.",
      prohibited: ["cinematography rules", "acting notes", "new plot"],
    },
  },
  [PROMPT_IDS.STORY_CINEMATOGRAPHY]: {
    pathStem: "domain/story_cinematography",
    version: 1,
    variables: ["panels_json", "locations_json"],
    agent: {
      id: "cinematographer",
      responsibility:
        "Define camera, lighting, composition, and continuity rules.",
      prohibited: ["changing plot", "changing dialogue", "adding characters"],
    },
  },
  [PROMPT_IDS.STORY_ACTING_DIRECTION]: {
    pathStem: "domain/story_acting_direction",
    version: 1,
    variables: ["panels_json", "characters_json"],
    agent: {
      id: "acting_director",
      responsibility:
        "Define evidence-backed performance direction per character and shot.",
      prohibited: ["camera planning", "new dialogue", "new actions"],
    },
  },
  [PROMPT_IDS.STORY_STORYBOARD_REFINEMENT]: {
    pathStem: "domain/story_storyboard_refinement",
    version: 1,
    variables: [
      "source_text",
      "panels_json",
      "cinematography_json",
      "acting_json",
    ],
    agent: {
      id: "storyboard_editor",
      responsibility:
        "Merge planning, cinematography, and acting into production panels.",
      prohibited: [
        "changing shot count",
        "new plot",
        "dropping source content",
      ],
    },
  },
  [PROMPT_IDS.STORY_VOICE_ANALYSIS]: {
    pathStem: "domain/story_voice_analysis",
    version: 1,
    variables: ["source_text", "characters_json", "panels_json"],
    agent: {
      id: "dialogue_editor",
      responsibility:
        "Extract spoken lines and map them to speakers and ordered panels.",
      prohibited: [
        "narration as dialogue",
        "rewriting dialogue",
        "shot changes",
      ],
    },
  },
};
