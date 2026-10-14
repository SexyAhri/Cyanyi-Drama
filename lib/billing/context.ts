import { AsyncLocalStorage } from "node:async_hooks";

export type ModelBillingIdentity = {
  userId: string;
  projectId?: string;
  episodeId?: string;
  channelId?: string;
  provider?: string;
  sourceType?: string;
  sourceId?: string;
};
const context = new AsyncLocalStorage<ModelBillingIdentity>();
export const currentModelBilling = () => context.getStore();
export function withModelBilling<T>(identity: ModelBillingIdentity, run: () => T): T {
  return context.run({ ...context.getStore(), ...identity }, run);
}
