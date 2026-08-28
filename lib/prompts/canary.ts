import { PROMPT_CATALOG } from "./catalog";
import { PROMPT_IDS, type PromptId } from "./ids";
import { renderPrompt } from "./registry";
import type { PromptLocale } from "./types";

type CanaryKey = `${PromptId}:${PromptLocale}`;

export const PROMPT_CANARY_MANIFEST = {
  "story_character_analysis:zh": "712e82dc2f9cbf95a5f3df36e81686dc1cb1a92882abe1583187dadbf7c688a5",
  "story_character_analysis:en": "0aba476b7ce07536eef3574e1712032d53e0573a2d8b8c5f5201e8f5c61eded2",
  "story_location_prop_analysis:zh": "4d5ca7af93466a372fda214a3bfd2b418974426f9e151f2135f371a68bea7b32",
  "story_location_prop_analysis:en": "c530d728148fc5ad13f757ab1a3fb39c22e319e659f8fd1c3cc76d2a718c71c1",
  "story_clip_segmentation:zh": "60121bdc0d896eaeb6adf89e76c30cece367ed83d609da34b8daee91a8e4148f",
  "story_clip_segmentation:en": "a507fdce7828a1dc9fa5cca06cbbe4c5d7a94072ab4db868afb48a2d4ae6c088",
  "story_screenplay_conversion:zh": "fad46161a1b1619c7ef64f10ea201f18df296d29d89e9476331525207378218a",
  "story_screenplay_conversion:en": "3b5f64fbc40ba0a47b43fc433e1075c0cbd7c294a7097ec97fb81e9549b80196",
  "story_storyboard_planning:zh": "cfbff765bdb4e85481d63213647d55863353c6aca327c3a8cd09c7ef2cd59daa",
  "story_storyboard_planning:en": "80d896c377309677d6c12662027a01b35153dcc23e038caf85adbcf4861c8d6e",
  "story_cinematography:zh": "c1c227061d17b170a2df882cc4bfc647deb0084f0a3ba2757d580f58077d80aa",
  "story_cinematography:en": "2684a60687f1f9f921ea822dc95abf81c7514c7744ad6522274ee65a3bb87a31",
  "story_acting_direction:zh": "71ae3686f852f08465e21d7b1147852c0eac43dc9a10d514ba30c08802b2f476",
  "story_acting_direction:en": "cb7fedd168f410072e1c192211f3326d888b40ce142114cb72389c510cf3e5c8",
  "story_storyboard_refinement:zh": "c3beede0ee1f4aa2e93762789470ea0ebc80279619e4d0e66d70118ab9360e74",
  "story_storyboard_refinement:en": "fdc7fd29736b4c840d9a544ab0a1da6c5e7adafa0081f2d3cd1766159faadf8a",
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
