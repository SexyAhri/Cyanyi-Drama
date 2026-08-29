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
  "story_screenplay_conversion:zh": "15cdf33db3a49beb87f555936148d128fe918c6ab55fa4e328f0e9651813b926",
  "story_screenplay_conversion:en": "472857d74ae27c81ac001a0e7b552adc5d4807e778cb568ab0472841fa1705e7",
  "story_screenplay_revision:zh": "85c7b63347925dfaac6c85bbd53725bf0455df2b09fb6484e9181d1f7b3955ef",
  "story_screenplay_revision:en": "1e2f206e0c23ca7ca1dcd3e4a8edbecaa2a7e50131675a62b3414381d3a8ef28",
  "story_storyboard_planning:zh": "c4d4d45452d5b64a94bbd26faf4f7ab05fffc75af709efaf3c59951bb38e7b42",
  "story_storyboard_planning:en": "e3b57cd7f00fc8fc2e4bc09bb4c682795d0ada000d7c96343f3e21b6d0d26fc8",
  "story_cinematography:zh": "f4f6a384c5600173356b622f81b527292560f24c4af70818754eaebef09c903d",
  "story_cinematography:en": "8598bac0036463527698d29037420158c9655f1cc4d5c69899936e527ec22a8d",
  "story_acting_direction:zh": "d5e2a65340a72d208693d592f2fa32b4763531ad26b99b51e9ccaf1597a38e39",
  "story_acting_direction:en": "e19847bdc6e173142d2ab814d4dfab695b8e02c5a35ffd8fedcfc4679cc971ff",
  "story_storyboard_refinement:zh": "bfa23322729b196e2f8b12f60b32aca19502ef2c195c92b7c33ead86d2c0f7e3",
  "story_storyboard_refinement:en": "84133b13d5b7cfb9d907f728fd90b5938d6733918766a51ee17e23b62cb0a7f6",
  "story_voice_analysis:zh": "36620705dc903042411acc2e554caf8444d1ae9c86a3743a7279dff8ff5b04fb",
  "story_voice_analysis:en": "166e19e3fcc60cb6b5d1df23aa0676c91c2c55ad4223251913d3ca5768b7fa8f",
  "story_continuity_review:zh": "626260e62666dc125bbaf1abe1d50449552ddf52c2cdbe74cca345a6933e621f",
  "story_continuity_review:en": "f39eea86791902ca697bffdc7f017cb99f14a76a3f712539ea2f8740a13a740e",
  "asset_visual_extraction:zh": "bd6620b7e31479e486bd6cbda46269b620b3b55b758ff4ccf4b0aea4121c3399",
  "asset_visual_extraction:en": "5c1acc32f9496f0f6f0c9932546a1c21eb5b11b3ed3432a60f31d524b61dd8c7",
  "asset_visual_design:zh": "25750145e05401ad34045ef243ad46b886ad16c46df33087d12052abff563e10",
  "asset_visual_design:en": "b24cbba2ca983fba34c1a64d9251d05f269578a9b1b0c19cdd2b0495408eb4da",
  "character_reference_description:zh": "2efa65b79f552d35990d93fc149d95ef08ac3a3b3df2adc7c5f83624dc4400a3",
  "character_reference_description:en": "e61b5baa74900ff2db4e36ad88b0881a22af43dbc11d33a6bf87d1e6b46addcc",
  "episode_split:zh": "e2bf3baa71ee40d2355bb973aec8b919be3c8ec01ab682f96c8dad4265e13124",
  "episode_split:en": "f04153d11057bbd8800178d4a310074e9c1a4e7ed937c9fcc9c6b9faeefbdcfb",
  "episode_adaptation:zh": "56cf4fceadcdd3b6bc89b189fe1ee3ca31fefe7998b72e57449435ab18f27136",
  "episode_adaptation:en": "f296965eba4d100d6990198b0184dbcf302dc731de591a516dc2e72042a36d92",
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
