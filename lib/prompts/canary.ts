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
  "story_screenplay_conversion:zh": "ad3209f38aaa1e2d3ce4929a007a8b5abc6c9c71d2d792994907663027f6e5ae",
  "story_screenplay_conversion:en": "4882be1295c184ab77c0b41688b181fc3d8721753d7cb5487cdb91a3d899543c",
  "story_storyboard_planning:zh": "76895ff41e91a9dab8df5683a68af7b3e7357939f8dd7d2b192c5b13a93160e5",
  "story_storyboard_planning:en": "788ea949e782f848b069723180bdab2df0dff364894110af6c35b26d762f9335",
  "story_cinematography:zh": "c1c227061d17b170a2df882cc4bfc647deb0084f0a3ba2757d580f58077d80aa",
  "story_cinematography:en": "2684a60687f1f9f921ea822dc95abf81c7514c7744ad6522274ee65a3bb87a31",
  "story_acting_direction:zh": "2b848dc26f66417738e8d07c95690f19bc55fadf00ab3679ce0198bb466fa588",
  "story_acting_direction:en": "c81727124f27f8fa1aa96e8c32886380bc472ab2631ee5b590ca3f771fbec83f",
  "story_storyboard_refinement:zh": "b965fd1fa405e44bae2a94c4b735040601062e56bd2c8925f633d63d11a34f36",
  "story_storyboard_refinement:en": "1106d5e1cac8b6d1b2e23520c9bd69012404c8cd2bd4dfc6e782b289e4095919",
  "story_voice_analysis:zh": "440af4d18a625dc2d83e998bfe1ba5c0e7e770807230bf3a3887cafdf9d43d6e",
  "story_voice_analysis:en": "da0e680270735a84636bb1dfcfc7952a6efdf46f0b2a46a233c8805241742477",
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
