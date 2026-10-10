import { PROMPT_CATALOG } from "./catalog";
import { PROMPT_IDS, type PromptId } from "./ids";
import { renderPrompt } from "./registry";
import type { PromptLocale } from "./types";

type CanaryKey = `${PromptId}:${PromptLocale}`;

export const PROMPT_CANARY_MANIFEST = {
  "production_script_organization:zh":
    "6f8ac32811966b7f7daaff5b65b019b195d24ff83bd9bf6581fb24065c53fcd1",
  "production_script_organization:en":
    "b5660aee173d046a1069adef70fffab352e6d985c3fb46f3e84aed33cbb4b09e",
  "story_character_analysis:zh":
    "c388b9db862dded938fe0a9dcb0711d1a72bce7fdb702a89596fa68ce121c23b",
  "story_character_analysis:en":
    "ca858c26a3ab5331f8772c475ec0d2d0c512ef18d7c27d994f7e64b43c981def",
  "story_location_prop_analysis:zh":
    "86e0c1e75de8302819d0934ac10a45d1274e3aa09cc0b8ae2b7c917ac47aec3b",
  "story_location_prop_analysis:en":
    "266b8f3174905d1992496706c540465512f20a815580b4571b2da84349593e71",
  "story_clip_segmentation:zh":
    "d81b8227fa6c25e715b090416cf83870e2d0992f7a69ef49610b2c91b0ace3f7",
  "story_clip_segmentation:en":
    "3f24227d1ce36c6a6a68c14e409e89d94ad8bd7914f8adb7a5b82827f7a5725d",
  "story_screenplay_beats:zh":
    "61cc11b1b1c6a0ba21f2d3f585a31862a4b13265098cdb6630718d3a3cc31e6e",
  "story_screenplay_beats:en":
    "c222930744a80fe283a126356237b57f138ef2753f17aa8dbb04e25a44150054",
  "story_screenplay_dialogue:zh":
    "eabc9fe07dd933b409a2a2ad1c4a31ac7cdfedae4e81ab59568bba45b085ebb3",
  "story_screenplay_dialogue:en":
    "2d674d6acde0767a155cd0a336957e63079d20da085306b420c940ec967ca2c6",
  "story_screenplay_narration:zh":
    "0b091f997ae71fdf47666dae499ebc26ac694c8d98a6c78f1ef0c91e0c24fcfd",
  "story_screenplay_narration:en":
    "44a06e9608c716e727254a71eb6e4dcd8fd0afb0f755fc0d6d60fb845101fb00",
  "story_screenplay_effects:zh":
    "855f443a4dc85976201a794efeafb6ab008cc2f7c4e4219302be701faee4aa42",
  "story_screenplay_effects:en":
    "ca9ec8c78f5fa4bebe5184874fda2bc98ed4cd34b62668078a2cbc59243e6295",
  "story_screenplay_revision:zh":
    "85c7b63347925dfaac6c85bbd53725bf0455df2b09fb6484e9181d1f7b3955ef",
  "story_screenplay_revision:en":
    "1e2f206e0c23ca7ca1dcd3e4a8edbecaa2a7e50131675a62b3414381d3a8ef28",
  "story_storyboard_planning:zh":
    "35577ff071e2140064a2f5888046f591af237e7fd29d454ebc57dde4d96f03d7",
  "story_storyboard_planning:en":
    "c7028eb572dec1abcd8745a21e782e7159b19809b631917b79665d22d6d8935c",
  "story_cinematography:zh":
    "c0d0712d979e66f7ece5e22afea6e3dc31b9ae95e6fecfc10c2ef85f15d7059d",
  "story_cinematography:en":
    "2cfa94a7bb87a8ff0f2ff6519e4fae352f208bf4c4379798748e9ccf60d1da9f",
  "story_acting_direction:zh":
    "6234be57d7db0084e6f2d9c4c401d372b4f3e52532bac16a9367982f2b1cbf2e",
  "story_acting_direction:en":
    "b4463c7b10b25b1d3e4946befe56bbb7ec50d80fc7cd0e50085ac3d8537d1e23",
  "story_storyboard_refinement:zh":
    "26e8ec2a8a76751a3e6e36f69442c4117ba34b4c67e5cd731a69af4442bd0d8c",
  "story_storyboard_refinement:en":
    "2c3a866c1bb7248c10f54340dc98025db27b633676e5b8e2adec3a5a94a2197e",
  "story_voice_analysis:zh":
    "875b736f6c2786c196fd7b97ccb6f489f22d52df082861bd8b4932d6ea98a4f8",
  "story_voice_analysis:en":
    "b517d4e8069dd4e841206262c8a7f934db81d8d266a9a5d2913972cf742c79cb",
  "story_voice_performance_design:zh":
    "e970df0ff57716a96950112671cf1f19e2803c7dd36b4102224d7a3cb5796898",
  "story_voice_performance_design:en":
    "64cac3170fda29ce27fb3d756b4f5a4764179510fad319c9df2c5b9290686ceb",
  "story_continuity_review:zh":
    "4da2d6099b56b8196ffa2207e0ec02c389cf5339eae619be043cb4b6f4063be7",
  "story_continuity_review:en":
    "7fec7ef5494ae9b5480b3dfe00171617379701f450d25ad5b69bc3d24a3aa769",
  "asset_visual_extraction:zh":
    "bd6620b7e31479e486bd6cbda46269b620b3b55b758ff4ccf4b0aea4121c3399",
  "asset_visual_extraction:en":
    "5c1acc32f9496f0f6f0c9932546a1c21eb5b11b3ed3432a60f31d524b61dd8c7",
  "asset_visual_design:zh":
    "05e2a4192eda307da106cfc78bb05a6188a9456ff7996e8eef515aa9fbfb84ab",
  "asset_visual_design:en":
    "a9ff6c9365a42c1bf166ad45dc21dab360f54036c11a5dc6633d8c43f28c6cc5",
  "storyboard_media_prompt_design:zh":
    "ca7703b398690c90d8f35a499a92524c0fc691f5888dc8d9a833f78ce5e097d6",
  "storyboard_media_prompt_design:en":
    "a4ba873cab3abda139c4b78c184b2c35cd2a7a1a4abffd7608acd6f8986226b0",
  "character_reference_description:zh":
    "2efa65b79f552d35990d93fc149d95ef08ac3a3b3df2adc7c5f83624dc4400a3",
  "character_reference_description:en":
    "e61b5baa74900ff2db4e36ad88b0881a22af43dbc11d33a6bf87d1e6b46addcc",
  "episode_split:zh":
    "e2bf3baa71ee40d2355bb973aec8b919be3c8ec01ab682f96c8dad4265e13124",
  "episode_split:en":
    "f04153d11057bbd8800178d4a310074e9c1a4e7ed937c9fcc9c6b9faeefbdcfb",
  "episode_adaptation:zh":
    "b4639ae37a408aae1c2418f69c2cf0598d6e656024eb6d95c50bc01b44cbc95c",
  "episode_adaptation:en":
    "1280f946dce22da85052612c7ad391c10cdd275bec52cc48ce07e8998f5cc07d",
  "studio_workflow_agent:zh":
    "a82bde87a4c3b1ca55448e7e389affc9f4416cc0fff455133ac7c4b5d49fb0b6",
  "studio_workflow_agent:en":
    "792270cd3075e2c6df575bb731bd0c0228171c085b0324b1d379d44f6c5bd02a",
} satisfies Record<CanaryKey, string>;

export type PromptCanaryIssue = {
  key: string;
  code: string;
  expected?: string;
  actual?: string;
};

export function runPromptCanaries(
  manifest: Partial<Record<CanaryKey, string>> = PROMPT_CANARY_MANIFEST,
) {
  const issues: PromptCanaryIssue[] = [];
  let checked = 0;
  for (const id of Object.values(PROMPT_IDS)) {
    const entry = PROMPT_CATALOG[id];
    for (const locale of ["zh", "en"] as const) {
      const key = `${id}:${locale}` as CanaryKey;
      const variables = Object.fromEntries(
        entry.variables.map((variable) => [variable, `[canary:${variable}]`]),
      );
      const rendered = renderPrompt({ id, locale, variables });
      checked += 1;
      const expected = manifest[key];
      if (!expected) issues.push({ key, code: "PROMPT_CANARY_MISSING" });
      else if (expected !== rendered.versionHash)
        issues.push({
          key,
          code: "PROMPT_CANARY_HASH_MISMATCH",
          expected,
          actual: rendered.versionHash,
        });
      if (/\{\{[A-Za-z0-9_]+\}\}/.test(rendered.text))
        issues.push({ key, code: "PROMPT_CANARY_PLACEHOLDER_REMAINED" });
      issues.push(...agentBehaviorIssues(id, locale));
    }
  }
  for (const key of Object.keys(manifest))
    if (!(key in PROMPT_CANARY_MANIFEST))
      issues.push({ key, code: "PROMPT_CANARY_UNKNOWN" });
  return { checked, passed: issues.length === 0, issues };
}

export function assertPromptCanaries() {
  const report = runPromptCanaries();
  if (!report.passed)
    throw new Error(
      `PROMPT_CANARY_FAILED:${report.issues.map((issue) => `${issue.key}:${issue.code}`).join(",")}`,
    );
  return report;
}

function agentBehaviorIssues(id: PromptId, locale: PromptLocale) {
  const key = `${id}:${locale}`;
  const agent = PROMPT_CATALOG[id].agent;
  const issues: PromptCanaryIssue[] = [];
  if (agent.contextPolicy.trust !== "untrusted")
    issues.push({ key, code: "AGENT_TRUST_GUARD_MISSING" });
  if (
    agent.retryPolicy.mode !== "targeted" ||
    agent.retryPolicy.maxSemanticCorrections < 0 ||
    agent.retryPolicy.maxSemanticCorrections > 1
  )
    issues.push({ key, code: "AGENT_RETRY_GUARD_INVALID" });
  if (!agent.successCriteria.length)
    issues.push({ key, code: "AGENT_SUCCESS_GUARD_MISSING" });
  if (!agent.prohibited.length)
    issues.push({ key, code: "AGENT_PROHIBITED_GUARD_MISSING" });
  if (!agent.qualityGates.length)
    issues.push({ key, code: "AGENT_QUALITY_GUARD_MISSING" });
  if (!agent.stopRules.length)
    issues.push({ key, code: "AGENT_STOP_GUARD_MISSING" });
  return issues;
}
