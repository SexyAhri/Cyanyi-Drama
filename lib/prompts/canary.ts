import { PROMPT_CATALOG } from "./catalog";
import { PROMPT_IDS, type PromptId } from "./ids";
import { renderPrompt } from "./registry";
import type { PromptLocale } from "./types";

type CanaryKey = `${PromptId}:${PromptLocale}`;

export const PROMPT_CANARY_MANIFEST = {
  "story_character_analysis:zh": "c388b9db862dded938fe0a9dcb0711d1a72bce7fdb702a89596fa68ce121c23b",
  "story_character_analysis:en": "ca858c26a3ab5331f8772c475ec0d2d0c512ef18d7c27d994f7e64b43c981def",
  "story_location_prop_analysis:zh": "4d5ca7af93466a372fda214a3bfd2b418974426f9e151f2135f371a68bea7b32",
  "story_location_prop_analysis:en": "c530d728148fc5ad13f757ab1a3fb39c22e319e659f8fd1c3cc76d2a718c71c1",
  "story_clip_segmentation:zh": "cb8ce74cb72d81388d63114ff9a8438aadb96bc07ee84b889c78669092323481",
  "story_clip_segmentation:en": "e30f7cc615591fe70277e77b73569889f5fd641e877dfc8bb0320a754528b6b0",
  "story_screenplay_conversion:zh": "74f232b6fb803c61b5d0f7584359b60cfa334aa732fb2f4bf25007593ab2b34c",
  "story_screenplay_conversion:en": "d50000d175fedc794a755dd6b634198125a1014f4454dbc2c9cea30af246e57e",
  "story_screenplay_revision:zh": "b96b0a758dc9feef4cf6f420978ab0bad032edae18aeb1f6f9616f138923c32e",
  "story_screenplay_revision:en": "ca6d0dd6d1e42e558d0d46b1359d0ba6bc1c3c825b08dc73423dd5715b80c40d",
  "story_storyboard_planning:zh": "8821ee5e02fec85e3648f0194c48ae0c2f4eac75e2b8b55bdf25b293a750f946",
  "story_storyboard_planning:en": "92a2ce29e3a19889dc65b2a2e00a2c934515b1209fa89c78eb33733eb155a9e1",
  "story_cinematography:zh": "c1c227061d17b170a2df882cc4bfc647deb0084f0a3ba2757d580f58077d80aa",
  "story_cinematography:en": "2684a60687f1f9f921ea822dc95abf81c7514c7744ad6522274ee65a3bb87a31",
  "story_acting_direction:zh": "5f25290ea0b5c591c030c417a116802fd4408eca699b964831df6e0aba7d6829",
  "story_acting_direction:en": "522281c9b20c82ff839a8d3ec9602a21944e7f7ebf43c424771d3952847d8543",
  "story_storyboard_refinement:zh": "c3beede0ee1f4aa2e93762789470ea0ebc80279619e4d0e66d70118ab9360e74",
  "story_storyboard_refinement:en": "fdc7fd29736b4c840d9a544ab0a1da6c5e7adafa0081f2d3cd1766159faadf8a",
  "story_voice_analysis:zh": "880150056d30aa2c26334080b1a03850316d3cee87ddc13f5aa1d7d51774bb87",
  "story_voice_analysis:en": "9d1d51998b888bd12eadd3aadf19b1df3a79d912b2058a42fea7dd48372beb05",
  "story_continuity_review:zh": "ec5af7a9552922474ed167a9a4d9fb7ccfba626cd4a255e345d4cc38b62db579",
  "story_continuity_review:en": "c2bf1f697c22afcb61c1f00802525b91df6c47aeccb751c8dfdab35d4139b461",
  "asset_visual_extraction:zh": "bd6620b7e31479e486bd6cbda46269b620b3b55b758ff4ccf4b0aea4121c3399",
  "asset_visual_extraction:en": "5c1acc32f9496f0f6f0c9932546a1c21eb5b11b3ed3432a60f31d524b61dd8c7",
  "asset_visual_design:zh": "99c8370f1911a8029f2d7ad3d2b3a265a6602ca54ace4a3a90c2e8085b0b1808",
  "asset_visual_design:en": "bf744673142e028a9e0ad4567497edac75e68e47f9de9492062cd607e548e1e3",
  "character_reference_description:zh": "2efa65b79f552d35990d93fc149d95ef08ac3a3b3df2adc7c5f83624dc4400a3",
  "character_reference_description:en": "e61b5baa74900ff2db4e36ad88b0881a22af43dbc11d33a6bf87d1e6b46addcc",
  "episode_split:zh": "e2bf3baa71ee40d2355bb973aec8b919be3c8ec01ab682f96c8dad4265e13124",
  "episode_split:en": "f04153d11057bbd8800178d4a310074e9c1a4e7ed937c9fcc9c6b9faeefbdcfb",
  "episode_adaptation:zh": "139336f6dc239c4d8d2ba24774cf56c29886e5aece47579be92f613b8b59c0d2",
  "episode_adaptation:en": "3c6a9d7ac5158ad2cd366435ecb5ef4092e619f500e0e31734755967031c0353",
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
