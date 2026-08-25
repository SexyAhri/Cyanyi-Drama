import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

type ApprovalButtonsProps = {
  disabled?: boolean;
  onApprove?: () => Promise<void> | void;
  onDeny?: () => Promise<void> | void;
};

export function ApprovalButtons({
  disabled,
  onApprove,
  onDeny,
}: ApprovalButtonsProps) {
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(
    null,
  );
  const isDisabled = disabled || submitting !== null;

  async function handleDecision(decision: "approve" | "deny") {
    if (isDisabled) {
      return;
    }

    setSubmitting(decision);

    try {
      if (decision === "approve") {
        await onApprove?.();
      } else {
        await onDeny?.();
      }
    } catch {
      setSubmitting(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        disabled={isDisabled}
        onClick={() => void handleDecision("approve")}
        size="sm"
        type="button"
      >
        {submitting === "approve" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : null}
        {submitting === "approve" ? "Approving..." : "Approve"}
      </Button>
      <Button
        disabled={isDisabled}
        onClick={() => void handleDecision("deny")}
        size="sm"
        type="button"
        variant="outline"
      >
        {submitting === "deny" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : null}
        {submitting === "deny" ? "Denying..." : "Deny"}
      </Button>
      {submitting ? (
        <span className="text-xs text-muted-foreground" role="status">
          Submitting approval decision.
        </span>
      ) : null}
    </div>
  );
}
