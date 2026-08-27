export const PRODUCTION_DEPARTMENTS = [
  {
    id: "development",
    agents: ["producer", "director", "story_editor", "screenwriter"],
    deliverableTypes: [
      "creative_brief",
      "production_bible",
      "story_bible",
      "screenplay_lock",
    ],
    requiredGates: ["creative", "production"],
  },
  {
    id: "script",
    agents: ["script_coordinator", "script_supervisor", "casting_director"],
    deliverableTypes: [
      "script_breakdown",
      "scene_schedule",
      "continuity_bible",
    ],
    requiredGates: ["creative", "continuity"],
  },
  {
    id: "art",
    agents: [
      "production_designer",
      "art_director",
      "character_designer",
      "environment_designer",
      "prop_costume_designer",
      "color_script_artist",
    ],
    deliverableTypes: [
      "visual_bible",
      "color_script",
      "character_design",
      "environment_design",
      "prop_costume_design",
    ],
    requiredGates: ["creative", "art"],
  },
  {
    id: "previs",
    agents: [
      "director",
      "cinematographer",
      "storyboard_director",
      "acting_director",
    ],
    deliverableTypes: [
      "directors_treatment",
      "shot_list",
      "previs",
      "animatic",
    ],
    requiredGates: ["creative", "camera", "continuity"],
  },
  {
    id: "shot",
    agents: ["shot_producer", "generation_operator", "continuity_supervisor"],
    deliverableTypes: ["shot_package", "selects", "shot_qc"],
    requiredGates: ["creative", "technical"],
  },
  {
    id: "vfx",
    agents: ["vfx_supervisor", "fx_artist", "compositor"],
    deliverableTypes: ["vfx_breakdown", "vfx_shot_package", "composite_qc"],
    requiredGates: ["vfx", "technical"],
  },
  {
    id: "sound",
    agents: [
      "sound_supervisor",
      "dialogue_editor",
      "foley_artist",
      "music_supervisor",
      "re_recording_mixer",
    ],
    deliverableTypes: ["dialogue_adr", "cue_sheet", "sound_mix"],
    requiredGates: ["creative", "sound", "legal"],
  },
  {
    id: "post",
    agents: ["editor", "colorist", "online_editor"],
    deliverableTypes: ["edit_decision_list", "picture_lock", "color_master"],
    requiredGates: ["creative", "technical"],
  },
  {
    id: "delivery",
    agents: ["qc_supervisor", "delivery_producer"],
    deliverableTypes: ["qc_report", "subtitle_package", "delivery_master"],
    requiredGates: ["technical", "content", "delivery"],
  },
] as const;

export type ProductionDepartmentId =
  (typeof PRODUCTION_DEPARTMENTS)[number]["id"];
export type ProductionDeliverableType =
  (typeof PRODUCTION_DEPARTMENTS)[number]["deliverableTypes"][number];

export function getProductionDepartment(id: string) {
  return PRODUCTION_DEPARTMENTS.find((department) => department.id === id);
}

export function departmentOwnsDeliverableType(
  departmentId: string,
  deliverableType: string,
) {
  const department = getProductionDepartment(departmentId);
  return Boolean(
    department?.deliverableTypes.some((item) => item === deliverableType),
  );
}
