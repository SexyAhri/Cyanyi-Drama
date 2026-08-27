import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

type ApprovalButtonsProps = {
  disabled?: boolean;
  locale?: "en" | "zh-CN";
  onApprove?: () => Promise<void> | void;
  onDeny?: () => Promise<void> | void;
};

const copy = {
  "zh-CN": {
    approve: "批准",
    approving: "批准中...",
    deny: "拒绝",
    denying: "拒绝中...",
    submitting: "正在提交审批决定。",
  },
  en: {
    approve: "Approve",
    approving: "Approving...",
    deny: "Deny",
    denying: "Denying...",
    submitting: "Submitting approval decision.",
  },
} as const;

export function ApprovalButtons({
  disabled,
  locale = "en",
  onApprove,
  onDeny,
}: ApprovalButtonsProps) {
  const text = copy[locale];
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null);
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
        {submitting === "approve" ? text.approving : text.approve}
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
        {submitting === "deny" ? text.denying : text.deny}
      </Button>
      {submitting ? (
        <span className="text-xs text-muted-foreground" role="status">
          {text.submitting}
        </span>
      ) : null}
    </div>
  );
}
