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
  "story_screenplay_conversion:zh": "50488438bb4e6ddb53519532d0b38ba01e8e47c07a0b2e27af024ac81953df1e",
  "story_screenplay_conversion:en": "077a02463a2f9c6e842523d00e45d25e3fcaf5685b0e3208f0854a9929132e4d",
  "story_screenplay_revision:zh": "85c7b63347925dfaac6c85bbd53725bf0455df2b09fb6484e9181d1f7b3955ef",
  "story_screenplay_revision:en": "1e2f206e0c23ca7ca1dcd3e4a8edbecaa2a7e50131675a62b3414381d3a8ef28",
  "story_storyboard_planning:zh": "e6e321ec736d2be72a824c229dd47be4486919845029f1979dd4fa6a78029f46",
  "story_storyboard_planning:en": "a304aed7e309f7252888301600c4c92013b033d03f06295a71b704fb446770a4",
  "story_cinematography:zh": "3bdf693819b1e5454a1fc53840f6396ccea829433cae874684ee2ea8f506ea5a",
  "story_cinematography:en": "64e7033791bdc1266c432744b4421387354d1071d12e3a7e6d37c23e4b633339",
  "story_acting_direction:zh": "3662a3261b0890182771c510152cb78bd17d791186ad89cdc9bfbc2bbd65c40a",
  "story_acting_direction:en": "bec9bc08f87c34bcb529ebbe2e13cf965b8189e7f46f4b72b63a3499c719590b",
  "story_storyboard_refinement:zh": "83eeb26054f4adea31a278b9b3c821a6a68ce5c3b6cff3e3ea96691dd5e68a35",
  "story_storyboard_refinement:en": "32010d2830f8172c60f005e216263b1ac4fa10ca62f8c9ae239875ff4a2b5e9c",
  "story_voice_analysis:zh": "a9a20d26cab1d78028b06cd305649db886425290a7bb0d1255b8dc6e9ba84dd9",
  "story_voice_analysis:en": "4ae0ee7da892fe2ba4d36989e31825a74e3314b6416cb1e605fd0d54632b5e03",
  "story_voice_performance_design:zh": "090bfdc126be5801d33852d78914ea9aa929a65618ef95e9454bf4faebb02a0d",
  "story_voice_performance_design:en": "a0c9cf0ca364baed368566344fd62ba9eabdd83ce886da0144dec5eb035937a8",
  "story_continuity_review:zh": "34ef64e424cf420c6582e92e91371714bcebebe9bdcd7495ee4656b86441909d",
  "story_continuity_review:en": "6cdf3e19a053a1f93bdc9c5a32034d2e396ac50c7c7d1c318c1b78cb4f4542b0",
  "asset_visual_extraction:zh": "bd6620b7e31479e486bd6cbda46269b620b3b55b758ff4ccf4b0aea4121c3399",
  "asset_visual_extraction:en": "5c1acc32f9496f0f6f0c9932546a1c21eb5b11b3ed3432a60f31d524b61dd8c7",
  "asset_visual_design:zh": "25750145e05401ad34045ef243ad46b886ad16c46df33087d12052abff563e10",
  "asset_visual_design:en": "b24cbba2ca983fba34c1a64d9251d05f269578a9b1b0c19cdd2b0495408eb4da",
  "storyboard_media_prompt_design:zh": "31c5adaca571cf8c1972ef5e806b5fcc5ff0be67b1761ffb6f3cf09a3f1623da",
  "storyboard_media_prompt_design:en": "91e641fea977394943792760f5da85ed907b4701a3106286f2637dc287b4fded",
  "character_reference_description:zh": "2efa65b79f552d35990d93fc149d95ef08ac3a3b3df2adc7c5f83624dc4400a3",
  "character_reference_description:en": "e61b5baa74900ff2db4e36ad88b0881a22af43dbc11d33a6bf87d1e6b46addcc",
  "episode_split:zh": "e2bf3baa71ee40d2355bb973aec8b919be3c8ec01ab682f96c8dad4265e13124",
  "episode_split:en": "f04153d11057bbd8800178d4a310074e9c1a4e7ed937c9fcc9c6b9faeefbdcfb",
  "episode_adaptation:zh": "355e5509b3c20f178b15a154a71f78b3214a3b65f818bbc12fac4d3a5e65748b",
  "episode_adaptation:en": "ff1ab91f630c5665984c7acdfacf58c691adc811e36bce173acf0576df859531",
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
