export const ACTION_PHASES = [
  "anticipation",
  "charge",
  "release",
  "travel",
  "impact",
  "aftermath",
] as const;

export const ACTION_DESIGN_KINDS = [
  "fight",
  "duel",
  "skill",
  "defense",
  "movement",
] as const;

export const VFX_CUE_CATEGORIES = [
  "skill_energy",
  "weapon_trail",
  "shockwave",
  "explosion_debris",
  "elemental_spell",
  "speed_afterimage",
  "shield_barrier",
  "transformation_summon",
  "environment_interaction",
] as const;

export const SFX_CUE_TYPES = [
  "foley",
  "weapon",
  "energy",
  "impact",
  "environment",
  "destruction",
] as const;

export type ActionPhase = (typeof ACTION_PHASES)[number];
export type VfxCueCategory = (typeof VFX_CUE_CATEGORIES)[number];
export type SfxCueType = (typeof SFX_CUE_TYPES)[number];
