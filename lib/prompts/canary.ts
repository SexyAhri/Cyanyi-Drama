import { PROMPT_CATALOG } from "./catalog";
import { PROMPT_IDS, type PromptId } from "./ids";
import { renderPrompt } from "./registry";
import type { PromptLocale } from "./types";

type CanaryKey = `${PromptId}:${PromptLocale}`;

export const PROMPT_CANARY_MANIFEST = {
  "story_character_analysis:zh": "c388b9db862dded938fe0a9dcb0711d1a72bce7fdb702a89596fa68ce121c23b",
  "story_character_analysis:en": "ca858c26a3ab5331f8772c475ec0d2d0c512ef18d7c27d994f7e64b43c981def",
  "story_location_prop_analysis:zh": "86e0c1e75de8302819d0934ac10a45d1274e3aa09cc0b8ae2b7c917ac47aec3b",
  "story_location_prop_analysis:en": "266b8f3174905d1992496706c540465512f20a815580b4571b2da84349593e71",
  "story_clip_segmentation:zh": "cb8ce74cb72d81388d63114ff9a8438aadb96bc07ee84b889c78669092323481",
  "story_clip_segmentation:en": "e30f7cc615591fe70277e77b73569889f5fd641e877dfc8bb0320a754528b6b0",
  "story_screenplay_beats:zh": "eb64e9e068848d159714a3d5e6ef93a96d4b90d48510d3876efbadc865478d09",
  "story_screenplay_beats:en": "f933b4ce1fa1538ba529e6b1b81b80934a1e790dba34084fc51a5403313d18fb",
  "story_screenplay_dialogue:zh": "a6efe0e820dce6b0b85377d0010a07f896ee5d9a0a7cdf8b239e4627cb192cb9",
  "story_screenplay_dialogue:en": "85093af31f059d73160349e7539e499bdfb0241e76de1c10d14801a36738dfea",
  "story_screenplay_narration:zh": "5a36f1bc171b7a97d172abb99ea3f15159e489f4b034da5fc8c3e9410706c245",
  "story_screenplay_narration:en": "fffa9f05a9bcdfb68542f41b3ce1bac76a4a3099acc730e3d0a1d4052991ea76",
  "story_screenplay_effects:zh": "7807a8ee4c53c38944f24b98b8d39ad28fd62f96c4e6f0b3417e62bd79f6cc36",
  "story_screenplay_effects:en": "df3fcc95cb6db89a7945d96a90d3745135ce835c6293a50cf7debc87e795e268",
  "story_screenplay_assembly:zh": "abd53ba28c92917af12326e9d24a8a4247aadd20d22b01c975ff374db171efe1",
  "story_screenplay_assembly:en": "194c3ff6e14796cf86f8ef3fe79106041b9cc033bd42decb5142f996575764ce",
  "story_screenplay_revision:zh": "85c7b63347925dfaac6c85bbd53725bf0455df2b09fb6484e9181d1f7b3955ef",
  "story_screenplay_revision:en": "1e2f206e0c23ca7ca1dcd3e4a8edbecaa2a7e50131675a62b3414381d3a8ef28",
  "story_storyboard_planning:zh": "94bf1616c6755225a9ee2978a356e90598c8bb18e70d31491183fee40b520eb2",
  "story_storyboard_planning:en": "c17959248dcb3471f1f7902ab8ada3d7483cf2775e1f2afaa459e523c6a0226c",
  "story_cinematography:zh": "c0d0712d979e66f7ece5e22afea6e3dc31b9ae95e6fecfc10c2ef85f15d7059d",
  "story_cinematography:en": "2cfa94a7bb87a8ff0f2ff6519e4fae352f208bf4c4379798748e9ccf60d1da9f",
  "story_acting_direction:zh": "6234be57d7db0084e6f2d9c4c401d372b4f3e52532bac16a9367982f2b1cbf2e",
  "story_acting_direction:en": "b4463c7b10b25b1d3e4946befe56bbb7ec50d80fc7cd0e50085ac3d8537d1e23",
  "story_storyboard_refinement:zh": "26e8ec2a8a76751a3e6e36f69442c4117ba34b4c67e5cd731a69af4442bd0d8c",
  "story_storyboard_refinement:en": "2c3a866c1bb7248c10f54340dc98025db27b633676e5b8e2adec3a5a94a2197e",
  "story_voice_analysis:zh": "875b736f6c2786c196fd7b97ccb6f489f22d52df082861bd8b4932d6ea98a4f8",
  "story_voice_analysis:en": "b517d4e8069dd4e841206262c8a7f934db81d8d266a9a5d2913972cf742c79cb",
  "story_voice_performance_design:zh": "e970df0ff57716a96950112671cf1f19e2803c7dd36b4102224d7a3cb5796898",
  "story_voice_performance_design:en": "64cac3170fda29ce27fb3d756b4f5a4764179510fad319c9df2c5b9290686ceb",
  "story_continuity_review:zh": "4da2d6099b56b8196ffa2207e0ec02c389cf5339eae619be043cb4b6f4063be7",
  "story_continuity_review:en": "7fec7ef5494ae9b5480b3dfe00171617379701f450d25ad5b69bc3d24a3aa769",
  "asset_visual_extraction:zh": "bd6620b7e31479e486bd6cbda46269b620b3b55b758ff4ccf4b0aea4121c3399",
  "asset_visual_extraction:en": "5c1acc32f9496f0f6f0c9932546a1c21eb5b11b3ed3432a60f31d524b61dd8c7",
  "asset_visual_design:zh": "5c2008c582bd6a6be026b84965beef86bd1e568b038aec8bfe1c23de74435a27",
  "asset_visual_design:en": "78654af706d9fd1d88208583965dd79f1b0d2a80820e975f215dd02abdf30c27",
  "storyboard_media_prompt_design:zh": "3fb9297b9d2523999fb901a4c0c7b9924d243ffd8fd57c8f1776484f1bcacc1e",
  "storyboard_media_prompt_design:en": "52e09ac82bed003f84d3ab0ef05d7b038544a4fe6e42ea8be247d0805c5be59b",
  "character_reference_description:zh": "2efa65b79f552d35990d93fc149d95ef08ac3a3b3df2adc7c5f83624dc4400a3",
  "character_reference_description:en": "e61b5baa74900ff2db4e36ad88b0881a22af43dbc11d33a6bf87d1e6b46addcc",
  "episode_split:zh": "e2bf3baa71ee40d2355bb973aec8b919be3c8ec01ab682f96c8dad4265e13124",
  "episode_split:en": "f04153d11057bbd8800178d4a310074e9c1a4e7ed937c9fcc9c6b9faeefbdcfb",
  "episode_adaptation:zh": "20a3d2bca611e05bb2ad0694a646751d2e327101b88617465ddf2629a67a7363",
  "episode_adaptation:en": "11684e5e10ce8730b1717341ad07c28a7d5e93b84f451547deed47ec0a4cbc63",
  "studio_workflow_agent:zh": "3cbe91f53fc2e37feb4583a3728f85b63bad8ad6d246572e828c9032c3ad16e6",
  "studio_workflow_agent:en": "88fb5ec9b7c6265bde9deb88192a66200b82ace7797688814bdb177d6219bf79",
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
      if (!expected)
        issues.push({ key, code: "PROMPT_CANARY_MISSING" });
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
