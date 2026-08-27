import { PROMPT_IDS, type PromptId } from "./ids";
import type { AgentContract, PromptCatalogEntry } from "./types";

export const PROMPT_CATALOG: Record<PromptId, PromptCatalogEntry> = {
  [PROMPT_IDS.STORY_CHARACTER_ANALYSIS]: {
    pathStem: "domain/story_character_analysis",
    version: 2,
    variables: ["source_text", "character_library"],
    agent: defineAgent({
      id: "casting_director",
      responsibility:
        "Identify canonical characters and evidence-backed profiles.",
      prohibited: ["scene planning", "shot design", "inventing characters"],
    }),
  },
  [PROMPT_IDS.STORY_LOCATION_PROP_ANALYSIS]: {
    pathStem: "domain/story_location_prop_analysis",
    version: 2,
    variables: ["source_text", "location_library", "prop_library"],
    agent: defineAgent({
      id: "production_designer",
      responsibility:
        "Identify reusable locations and continuity-critical props.",
      prohibited: ["character profiling", "shot design", "inventing assets"],
    }),
  },
  [PROMPT_IDS.STORY_CLIP_SEGMENTATION]: {
    pathStem: "domain/story_clip_segmentation",
    version: 3,
    variables: [
      "source_text",
      "character_library",
      "location_library",
      "prop_library",
    ],
    agent: defineAgent({
      id: "story_editor",
      responsibility:
        "Split source text at narrative boundaries without gaps or overlap.",
      prohibited: [
        "rewriting source text",
        "storyboard planning",
        "new dialogue",
      ],
    }),
  },
  [PROMPT_IDS.STORY_SCREENPLAY_CONVERSION]: {
    pathStem: "domain/story_screenplay_conversion",
    version: 5,
    variables: [
      "clip_id",
      "clip_text",
      "character_library",
      "location_library",
      "prop_library",
    ],
    agent: defineAgent({
      id: "screenwriter",
      responsibility:
        "Convert one clip into screenplay structure while preserving source facts.",
      prohibited: [
        "expanding the story",
        "inventing action",
        "changing dialogue",
      ],
      contextPolicy: { scope: "clip", trust: "untrusted" },
    }),
  },
  [PROMPT_IDS.STORY_STORYBOARD_PLANNING]: {
    pathStem: "domain/story_storyboard_planning",
    version: 3,
    variables: [
      "source_text",
      "characters_json",
      "locations_json",
      "props_json",
    ],
    agent: defineAgent({
      id: "storyboard_director",
      responsibility:
        "Plan ordered shots with complete one-second motion beats that cover the source narrative.",
      prohibited: ["cinematography rules", "acting notes", "new plot"],
    }),
  },
  [PROMPT_IDS.STORY_CINEMATOGRAPHY]: {
    pathStem: "domain/story_cinematography",
    version: 3,
    variables: ["panels_json", "locations_json"],
    agent: defineAgent({
      id: "cinematographer",
      responsibility:
        "Define camera, lighting, composition, and continuity rules.",
      prohibited: ["changing plot", "changing dialogue", "adding characters"],
      contextPolicy: { scope: "clip", trust: "untrusted" },
      evidencePolicy: { required: true, mode: "input_references" },
    }),
  },
  [PROMPT_IDS.STORY_ACTING_DIRECTION]: {
    pathStem: "domain/story_acting_direction",
    version: 2,
    variables: ["panels_json", "characters_json"],
    agent: defineAgent({
      id: "acting_director",
      responsibility:
        "Define evidence-backed performance direction per character and shot.",
      prohibited: ["camera planning", "new dialogue", "new actions"],
      contextPolicy: { scope: "clip", trust: "untrusted" },
      evidencePolicy: { required: true, mode: "input_references" },
    }),
  },
  [PROMPT_IDS.STORY_STORYBOARD_REFINEMENT]: {
    pathStem: "domain/story_storyboard_refinement",
    version: 3,
    variables: [
      "source_text",
      "panels_json",
      "cinematography_json",
      "acting_json",
    ],
    agent: defineAgent({
      id: "storyboard_editor",
      responsibility:
        "Merge planning, cinematography, and acting into production panels.",
      prohibited: [
        "changing shot count",
        "new plot",
        "dropping source content",
      ],
      contextPolicy: { scope: "clip", trust: "untrusted" },
    }),
  },
  [PROMPT_IDS.STORY_VOICE_ANALYSIS]: {
    pathStem: "domain/story_voice_analysis",
    version: 5,
    variables: ["source_text", "characters_json", "panels_json"],
    agent: defineAgent({
      id: "dialogue_editor",
      responsibility:
        "Extract spoken lines and map them to speakers and ordered panels.",
      prohibited: [
        "narration as dialogue",
        "rewriting dialogue",
        "shot changes",
      ],
    }),
  },
  [PROMPT_IDS.STORY_CONTINUITY_REVIEW]: {
    pathStem: "domain/story_continuity_review",
    version: 1,
    variables: [
      "panels_json",
      "characters_json",
      "locations_json",
      "props_json",
    ],
    agent: defineAgent({
      id: "continuity_supervisor",
      responsibility:
        "Audit identity, asset, spatial, temporal, and visual continuity without rewriting panels.",
      prohibited: [
        "rewriting panels",
        "adding story facts",
        "changing shot count",
      ],
      successCriteria: [
        "Every error identifies the affected panel and canonical entity when available",
        "Only evidence-backed continuity conflicts are reported",
        "Passing output contains no speculative warnings",
      ],
      qualityGates: [
        "canonical_entity_references",
        "panel_order_preserved",
        "continuity_issue_evidence",
      ],
      contextPolicy: { scope: "clip", trust: "untrusted" },
      evidencePolicy: { required: true, mode: "input_references" },
    }),
  },
  [PROMPT_IDS.ASSET_VISUAL_EXTRACTION]: {
    pathStem: "domain/asset_visual_extraction",
    version: 1,
    variables: ["asset_kind_hint"],
    agent: defineAgent({
      id: "visual_asset_curator",
      responsibility:
        "Extract reusable characters, locations, and props from supplied visual references.",
      prohibited: [
        "inventing hidden story facts",
        "identifying real people",
        "shot planning",
      ],
      contextPolicy: { scope: "project", trust: "untrusted" },
      evidencePolicy: { required: true, mode: "input_references" },
      qualityGates: [
        "schema_valid",
        "visual_evidence_present",
        "entity_names_unique",
      ],
    }),
  },
  [PROMPT_IDS.CHARACTER_REFERENCE_DESCRIPTION]: {
    pathStem: "domain/character_reference_description",
    version: 1,
    variables: ["character_name"],
    agent: defineAgent({
      id: "character_reference_analyst",
      responsibility:
        "Describe stable visible character traits from supplied reference images.",
      prohibited: [
        "identifying real people",
        "inventing biography",
        "changing visible traits",
      ],
      contextPolicy: { scope: "project", trust: "untrusted" },
      evidencePolicy: { required: true, mode: "input_references" },
      qualityGates: ["schema_valid", "visible_traits_only", "identity_consistent"],
    }),
  },
  [PROMPT_IDS.EPISODE_SPLIT]: {
    pathStem: "domain/episode_split",
    version: 1,
    variables: ["source_text"],
    agent: defineAgent({
      id: "episode_editor",
      responsibility:
        "Split a complete source into ordered episode boundaries without rewriting it.",
      prohibited: ["rewriting source text", "omitting text", "inventing markers"],
      contextPolicy: { scope: "project", trust: "untrusted" },
      qualityGates: ["schema_valid", "source_boundaries_locatable", "full_source_coverage"],
    }),
  },
};

type AgentDefinition = Pick<
  AgentContract,
  "id" | "responsibility" | "prohibited"
> &
  Partial<
    Omit<AgentContract, "id" | "responsibility" | "prohibited">
  >;

function defineAgent(input: AgentDefinition): AgentContract {
  const evidencePolicy = input.evidencePolicy ?? {
    required: true,
    mode: "source_quotes" as const,
  };
  return {
    id: input.id,
    responsibility: input.responsibility,
    prohibited: input.prohibited,
    successCriteria: input.successCriteria ?? [
      "Return output that satisfies the registered schema",
      "Use only supplied evidence and canonical context",
    ],
    tools: input.tools ?? [],
    contextPolicy: input.contextPolicy ?? {
      scope: "episode",
      trust: "untrusted",
    },
    evidencePolicy,
    qualityGates: input.qualityGates ?? [
      "schema_valid",
      evidencePolicy.mode === "source_quotes"
        ? "source_grounded"
        : "input_references_valid",
      "canonical_names",
    ],
    retryPolicy: input.retryPolicy ?? {
      maxSemanticCorrections: 1,
      mode: "targeted",
    },
    stopRules: input.stopRules ?? [
      "Stop after the output passes schema and semantic validation",
      "Return an empty collection instead of inventing unsupported facts",
    ],
  };
}
