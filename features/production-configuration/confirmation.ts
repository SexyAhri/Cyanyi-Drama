import type { StudioConfirmation } from "@/features/studio/components/use-studio-confirmation";
import type { ProductionCopy } from "./copy";

export async function confirmConfigurationDiscard(
  status: { dirty: boolean; busy: boolean },
  confirm: (request: StudioConfirmation) => Promise<boolean>,
  copy: ProductionCopy,
  options: { description?: string; confirmLabel?: string } = {},
) {
  if (status.busy) return false;
  if (!status.dirty) return true;
  return confirm({
    title: copy.discardTitle,
    description: options.description ?? copy.discard,
    confirmLabel: options.confirmLabel ?? copy.discardChanges,
    cancelLabel: copy.keepEditing,
    destructive: true,
  });
}
