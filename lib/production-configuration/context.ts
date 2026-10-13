import { AsyncLocalStorage } from "node:async_hooks";
import type { ProductionConfigurationSnapshot } from "./contract";

const context = new AsyncLocalStorage<{
  userId: string;
  snapshot: ProductionConfigurationSnapshot;
}>();
export const currentProductionConfiguration = () => context.getStore();
export function withProductionConfiguration<T>(
  userId: string,
  snapshot: ProductionConfigurationSnapshot,
  run: () => T,
): T {
  return context.run({ userId, snapshot }, run);
}
