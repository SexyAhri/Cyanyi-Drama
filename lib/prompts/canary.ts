import { PROMPT_CATALOG } from "./catalog";
import { PROMPT_IDS, type PromptId } from "./ids";
import { renderPrompt } from "./registry";
import type { PromptLocale } from "./types";

type CanaryKey = `${PromptId}:${PromptLocale}`;

export const PROMPT_CANARY_MANIFEST = {
  "story_character_analysis:zh": "19e84cbdf917325ce8b6e2d3cba9d1efc1001e9030f046815f83148cdb4f257a",
  "story_character_analysis:en": "483f556336fe52e19455aeb18eaf0f55091faa207b7de823dc45a92a5db38952",
  "story_location_prop_analysis:zh": "51bf5bed7687da7d3372c8a8808967f3040f03bfe09cd9deb685e2e52dcc7e8b",
  "story_location_prop_analysis:en": "d61b632781303e3d94e9b4f0ecaf0b762ede1396eb31f235b5051254327350e8",
  "story_clip_segmentation:zh": "60121bdc0d896eaeb6adf89e76c30cece367ed83d609da34b8daee91a8e4148f",
  "story_clip_segmentation:en": "a507fdce7828a1dc9fa5cca06cbbe4c5d7a94072ab4db868afb48a2d4ae6c088",
  "story_screenplay_conversion:zh": "72c393b2f879714e476b425b075af462eb9971404e9cd8694f5ea7bef39abcdc",
  "story_screenplay_conversion:en": "f32678069b791c757883fb5547c661b11baea703c4d0ea2b0712012f08abc1c7",
  "story_storyboard_planning:zh": "5f6811604197c231e2f2ea9841a9152ec68ddbae01ef27fbd46332e82d233aa2",
  "story_storyboard_planning:en": "aafcdfa4321db819cd9a623ba5e561f2a5acfca43cf449893b0141753a3ca7b3",
  "story_cinematography:zh": "e51b8068fd160362f02afd7f38496bbd72b30a9e7ae0e186b4b3c9ff6a4f1946",
  "story_cinematography:en": "53665e725eeb2a7444557da6309564f9385b111f18d417f2a2d87a4e34475de4",
  "story_acting_direction:zh": "2b848dc26f66417738e8d07c95690f19bc55fadf00ab3679ce0198bb466fa588",
  "story_acting_direction:en": "c81727124f27f8fa1aa96e8c32886380bc472ab2631ee5b590ca3f771fbec83f",
  "story_storyboard_refinement:zh": "1dfe2d1a53c9bdc1876c423d15f7daf34912c1955228a36c9d7493f7a541152c",
  "story_storyboard_refinement:en": "a225346ccbae63c6378a91b6199839d9cc77f0ec9f08158e171dcd25f18705a5",
  "story_voice_analysis:zh": "2197c98f9c35e93bb0eba89022ea88bc6a5026caaa1a74e687ecfe4b9cb73046",
  "story_voice_analysis:en": "ec94fc65d2df3cdf6e5148d240c601cd31d3b9e5e4d0f187a63dde2384cd022e",
  "story_continuity_review:zh": "ec5af7a9552922474ed167a9a4d9fb7ccfba626cd4a255e345d4cc38b62db579",
  "story_continuity_review:en": "c2bf1f697c22afcb61c1f00802525b91df6c47aeccb751c8dfdab35d4139b461",
  "asset_visual_extraction:zh": "bd6620b7e31479e486bd6cbda46269b620b3b55b758ff4ccf4b0aea4121c3399",
  "asset_visual_extraction:en": "5c1acc32f9496f0f6f0c9932546a1c21eb5b11b3ed3432a60f31d524b61dd8c7",
  "character_reference_description:zh": "2efa65b79f552d35990d93fc149d95ef08ac3a3b3df2adc7c5f83624dc4400a3",
  "character_reference_description:en": "e61b5baa74900ff2db4e36ad88b0881a22af43dbc11d33a6bf87d1e6b46addcc",
  "episode_split:zh": "e2bf3baa71ee40d2355bb973aec8b919be3c8ec01ab682f96c8dad4265e13124",
  "episode_split:en": "f04153d11057bbd8800178d4a310074e9c1a4e7ed937c9fcc9c6b9faeefbdcfb",
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
