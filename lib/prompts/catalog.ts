import { PROMPT_IDS, type PromptId } from "./ids";
import type { AgentContract, PromptCatalogEntry } from "./types";

export const PROMPT_CATALOG: Record<PromptId, PromptCatalogEntry> = {
  [PROMPT_IDS.STORY_CHARACTER_ANALYSIS]: {
    pathStem: "domain/story_character_analysis",
    version: 3,
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
    version: 5,
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
    version: 4,
    variables: [
      "source_units_json",
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
  [PROMPT_IDS.STORY_SCREENPLAY_BEATS]: {
    pathStem: "domain/story_screenplay_beats",
    version: 4,
    variables: [
      "clip_id",
      "clip_text",
      "production_plan_json",
      "character_library",
      "location_library",
      "prop_library",
      "world_bible_json",
      "project_style",
      "story_world_directive",
      "previous_episode_context_json",
    ],
    agent: defineAgent({
      id: "screenplay_beat_editor",
      responsibility:
        "Write ordered scenes and filmable action beats for one source clip.",
      prohibited: [
        "writing dialogue",
        "writing narration",
        "designing VFX or SFX",
      ],
      stopRules: ["Stop when the clip has been expressed as filmable action"],
      retryPolicy: { maxSemanticCorrections: 0, mode: "targeted" },
    }),
  },
  [PROMPT_IDS.STORY_SCREENPLAY_DIALOGUE]: {
    pathStem: "domain/story_screenplay_dialogue",
    version: 3,
    variables: [
      "clip_id",
      "clip_text",
      "beat_plan_json",
      "production_plan_json",
      "character_library",
    ],
    agent: defineAgent({
      id: "screenplay_dialogue_editor",
      responsibility:
        "Write or adapt spoken dialogue for the approved ordered scene plan.",
      prohibited: ["writing narration", "changing scene action"],
      stopRules: ["Return an empty lines list when the episode needs no dialogue"],
      retryPolicy: { maxSemanticCorrections: 0, mode: "targeted" },
    }),
  },
  [PROMPT_IDS.STORY_SCREENPLAY_NARRATION]: {
    pathStem: "domain/story_screenplay_narration",
    version: 3,
    variables: [
      "clip_id",
      "clip_text",
      "beat_plan_json",
      "production_plan_json",
      "character_library",
    ],
    agent: defineAgent({
      id: "screenplay_narration_editor",
      responsibility:
        "Write only the narration, voiceover, and inner voice needed by the screenplay.",
      prohibited: ["writing dialogue", "changing scene action"],
      stopRules: ["Return an empty lines list when narration is unnecessary"],
      retryPolicy: { maxSemanticCorrections: 0, mode: "targeted" },
    }),
  },
  [PROMPT_IDS.STORY_SCREENPLAY_EFFECTS]: {
    pathStem: "domain/story_screenplay_effects",
    version: 3,
    variables: [
      "clip_id",
      "clip_text",
      "beat_plan_json",
      "production_plan_json",
      "character_library",
      "prop_library",
      "world_bible_json",
      "project_style",
      "story_world_directive",
      "effect_library_json",
    ],
    agent: defineAgent({
      id: "screenplay_effects_designer",
      responsibility:
        "Design executable action, visual effects, and sound effects for selected beats.",
      prohibited: ["adding plot", "changing dialogue", "changing scene action"],
      stopRules: ["Return an empty designs list when no beat needs effects"],
      retryPolicy: { maxSemanticCorrections: 0, mode: "targeted" },
    }),
  },
  [PROMPT_IDS.STORY_SCREENPLAY_ASSEMBLY]: {
    pathStem: "domain/story_screenplay_assembly",
    version: 2,
    variables: [
      "clip_id",
      "scene_index",
      "clip_text",
      "scene_parts_json",
      "character_library",
      "location_library",
      "prop_library",
      "world_bible_json",
      "project_style",
      "story_world_directive",
    ],
    agent: defineAgent({
      id: "screenplay_scene_editor",
      responsibility:
        "Merge one scene's action beats, dialogue, narration, and effects into a production screenplay scene.",
      prohibited: [
        "adding plot outcomes",
        "dropping supplied spoken lines",
        "returning more than one scene",
      ],
      stopRules: ["Stop after returning the single requested scene"],
      retryPolicy: { maxSemanticCorrections: 0, mode: "targeted" },
    }),
  },
  [PROMPT_IDS.STORY_STORYBOARD_PLANNING]: {
    pathStem: "domain/story_storyboard_planning",
    version: 13,
    variables: [
      "source_text",
      "characters_json",
      "locations_json",
      "props_json",
      "world_bible_json",
      "project_style",
      "story_world_directive",
      "continuity_anchor_json",
      "production_plan_json",
      "clip_duration_seconds",
    ],
    agent: defineAgent({
      id: "storyboard_director",
      responsibility:
        "Plan speaker-focused shots with exact dialogue coverage, grounded action choreography, production VFX/SFX cues, and explicit continuity states.",
      prohibited: ["cinematography rules", "acting notes", "new plot"],
    }),
  },
  [PROMPT_IDS.STORY_CINEMATOGRAPHY]: {
    pathStem: "domain/story_cinematography",
    version: 8,
    variables: [
      "panels_json",
      "locations_json",
      "project_style",
      "story_world_directive",
    ],
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
    version: 9,
    variables: [
      "panels_json",
      "characters_json",
      "world_bible_json",
      "continuity_anchor_json",
    ],
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
    version: 11,
    variables: [
      "source_text",
      "panels_json",
      "cinematography_json",
      "acting_json",
      "production_design_json",
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
    version: 8,
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
    version: 6,
    variables: [
      "panels_json",
      "characters_json",
      "locations_json",
      "props_json",
      "project_style",
      "story_world_directive",
      "continuity_anchor_json",
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
  [PROMPT_IDS.STORY_VOICE_PERFORMANCE_DESIGN]: {
    pathStem: "domain/story_voice_performance_design",
    version: 3,
    variables: [
      "source_text",
      "characters_json",
      "panels_json",
      "voice_lines_json",
      "established_voices_json",
    ],
    agent: defineAgent({
      id: "voice_director",
      responsibility:
        "Design stable character voices and line-specific performance instructions from approved script and storyboard context.",
      prohibited: [
        "rewriting dialogue",
        "changing speakers or line order",
        "inventing story facts",
        "adding music or sound effects",
      ],
      contextPolicy: { scope: "episode", trust: "untrusted" },
      qualityGates: [
        "speaker_voice_consistency",
        "exact_line_coverage",
        "scene_grounded_performance",
        "clean_voice_output",
      ],
    }),
  },
  [PROMPT_IDS.EPISODE_ADAPTATION]: {
    pathStem: "domain/episode_adaptation",
    version: 9,
    variables: [
      "source_text",
      "target_duration_seconds",
      "manuscript_context",
      "project_context",
      "episode_continuity_context",
      "adaptation_mode",
      "custom_instructions",
    ],
    agent: defineAgent({
      id: "episode_adaptation_editor",
      responsibility:
        "Create one coherent episode adaptation for a human to review before screenplay production.",
      prohibited: [
        "overwriting or pretending to replace the source",
        "inventing plot events, identities, relationships, powers, props, dialogue facts, or outcomes",
        "changing chronology, ownership, winners, injuries, deaths, or revealed information",
        "turning visual art-style settings into unsupported story facts",
      ],
      contextPolicy: { scope: "episode", trust: "untrusted" },
      qualityGates: [
        "source_grounded_title_and_synopsis",
        "adaptation_mode_followed",
      ],
    }),
  },
  [PROMPT_IDS.ASSET_VISUAL_DESIGN]: {
    pathStem: "domain/asset_visual_design",
    version: 5,
    variables: [
      "asset_kind",
      "asset_name",
      "asset_requirements",
      "story_facts_json",
      "source_evidence_json",
      "story_world_context_json",
      "story_world_directive",
      "project_style",
    ],
    agent: defineAgent({
      id: "asset_visual_designer",
      responsibility:
        "Turn approved story facts into a concrete, reusable visual specification for one production asset.",
      prohibited: [
        "changing or contradicting supplied story facts",
        "presenting inferred visual choices as source canon",
        "adding plot events, relationships, powers, or biography",
        "designing a transient shot instead of a reusable asset",
        "using the rendering style as a substitute for the story era or world setting",
        "introducing modern wardrobe, architecture, furnishings, technology, or vehicles into a grounded premodern world",
      ],
      successCriteria: [
        "The result is concrete enough to generate a stable reference image",
        "Every inferred choice is compatible with supplied facts and project style",
        "Continuity rules identify the traits that downstream shots must preserve",
      ],
      qualityGates: [
        "usable_visual_specification",
        "story_facts_preserved",
        "visual_specification_complete",
        "inference_provenance_explicit",
        "story_world_era_compatible",
      ],
      stopRules: [
        "Stop after one complete visual specification",
        "Do not infer a fact when it would contradict or materially extend the story",
      ],
      contextPolicy: { scope: "project", trust: "untrusted" },
      evidencePolicy: { required: true, mode: "input_references" },
    }),
  },
  [PROMPT_IDS.STORYBOARD_MEDIA_PROMPT_DESIGN]: {
    pathStem: "domain/storyboard_media_prompt_design",
    version: 2,
    variables: [
      "media_kind",
      "generation_mode",
      "project_style",
      "current_shot_json",
      "adjacent_shots_json",
      "asset_profiles_json",
      "current_prompt",
    ],
    agent: defineAgent({
      id: "storyboard_media_prompt_designer",
      responsibility:
        "Design one production-ready image or video prompt for an approved storyboard shot while preserving story facts and cross-shot continuity.",
      prohibited: [
        "inventing plot events, characters, props, dialogue, powers, injuries, or outcomes",
        "changing approved character, location, prop, performance, camera, timing, VFX, or SFX facts",
        "replacing the project art style",
        "describing invisible motion in an image prompt",
        "omitting interaction beats, performance changes, timed effects, or boundary states from a video prompt",
      ],
      successCriteria: [
        "The prompt can be submitted directly to the selected image or video generator",
        "Visible composition, performance, interaction, spatial, and continuity constraints are concrete",
        "Video prompts express a chronological action timeline with start and end states",
      ],
      qualityGates: [
        "schema_valid",
        "source_facts_preserved",
        "asset_identity_preserved",
        "adjacent_shot_continuity",
        "media_specific_prompt_complete",
      ],
      stopRules: [
        "Return one prompt for the requested media kind only",
        "Prefer explicit constraints over unsupported invention",
      ],
      contextPolicy: { scope: "episode", trust: "untrusted" },
      evidencePolicy: { required: true, mode: "input_references" },
    }),
  },
  [PROMPT_IDS.STORY_SCREENPLAY_REVISION]: {
    pathStem: "domain/story_screenplay_revision",
    version: 4,
    variables: [
      "clip_id",
      "clip_text",
      "current_screenplay_json",
      "revision_request",
      "failure_context_json",
      "character_library",
      "location_library",
      "prop_library",
      "world_bible_json",
      "project_style",
      "story_world_directive",
      "effect_library_json",
    ],
    agent: defineAgent({
      id: "screenplay_revision_editor",
      responsibility:
        "Revise one screenplay clip from an explicit user request or validator failure while preserving source facts.",
      prohibited: [
        "changing original text",
        "inventing dialogue",
        "introducing ungrounded plot",
      ],
      contextPolicy: { scope: "clip", trust: "untrusted" },
      evidencePolicy: { required: true, mode: "input_references" },
      successCriteria: [
        "The requested production or performance change is applied where source evidence permits",
        "Validator-reported fields are repaired without unrelated rewriting",
        "Every dialogue line and story fact remains grounded in the clip source",
      ],
      qualityGates: [
        "schema_valid",
        "source_event_coverage",
        "canonical_entity_references",
        "dialogue_exact_source",
      ],
      stopRules: [
        "Refuse requested changes that contradict source facts",
        "Stop after producing one complete validated screenplay revision",
      ],
    }),
  },
  [PROMPT_IDS.STUDIO_WORKFLOW_AGENT]: {
    pathStem: "domain/studio_workflow_agent",
    version: 1,
    variables: ["state_json", "operation_candidates_json", "user_request"],
    agent: defineAgent({
      id: "studio_workflow_coordinator",
      responsibility:
        "Explain current production state and select safe workflow operations from explicit candidates.",
      prohibited: [
        "inventing production state",
        "selecting an unlisted target",
        "executing without approval",
      ],
      tools: [
        "pause_workflow",
        "resume_workflow",
        "revise_screenplay",
        "retry_workflow",
        "cancel_workflow",
        "retry_media_task",
        "cancel_media_task",
      ],
      contextPolicy: { scope: "episode", trust: "untrusted" },
      evidencePolicy: { required: true, mode: "input_references" },
      successCriteria: [
        "The reply answers from the supplied project and execution state",
        "Any proposed operation references one listed eligible target",
        "Read-only questions never propose an unnecessary state change",
      ],
      qualityGates: [
        "schema_valid",
        "operation_target_eligible",
        "state_claims_grounded",
      ],
      stopRules: [
        "Return no operation when no eligible target exists",
        "Stop after proposing at most one approval-gated operation",
      ],
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
