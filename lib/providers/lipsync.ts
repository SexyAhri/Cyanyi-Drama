import { bailianLipSyncProvider } from "./lipsync/bailian";
import { falLipSyncProvider } from "./lipsync/fal";
import type {
  LipSyncProviderAdapter,
  LipSyncProviderInput,
  LipSyncProviderResult,
} from "./lipsync/types";
import { viduLipSyncProvider } from "./lipsync/vidu";

export type { LipSyncProviderResult } from "./lipsync/types";

const providers: Record<string, LipSyncProviderAdapter> = {
  fal: falLipSyncProvider,
  vidu: viduLipSyncProvider,
  bailian: bailianLipSyncProvider,
};

export function supportsSpecializedLipSync(providerKey: string) {
  return Boolean(providers[providerKey.toLowerCase()]);
}

export async function generateSpecializedLipSync(
  input: LipSyncProviderInput & { providerKey: string },
): Promise<LipSyncProviderResult> {
  const provider = providers[input.providerKey.toLowerCase()];
  if (!provider)
    throw new Error(`LIP_SYNC_PROVIDER_UNSUPPORTED:${input.providerKey}`);
  return provider.generate(input);
}
