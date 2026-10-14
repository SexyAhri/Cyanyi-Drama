import { Prisma } from "@prisma/client";
import type { ModelChargeReceipt } from "@/lib/billing/model-charge";

export type AgentTestCostResult =
  | { charged: true; estimated: false; id: string; amount: string; quantity: number; unit: string; receipts: ModelChargeReceipt[] }
  | { charged: false; estimated: false; reason: "usage_unavailable" };

/** Receipts were already written atomically by the request wallet. Never write a second estimated bill. */
export function summarizeAgentTestRunCost(receipts: ModelChargeReceipt[] = []): AgentTestCostResult {
  const unique = [...new Map(receipts.map(receipt => [receipt.requestId, receipt])).values()];
  if (!unique.length) return { charged: false, estimated: false, reason: "usage_unavailable" };
  const sameUnit = unique.every(receipt => receipt.unit === unique[0].unit);
  return { charged: true, estimated: false, id: unique.map(receipt => receipt.id).join(", "),
    amount: unique.reduce((sum, receipt) => sum.add(receipt.amount), new Prisma.Decimal(0)).toString(),
    quantity: sameUnit ? unique.reduce((sum, receipt) => sum + receipt.quantity, 0) : unique.length,
    unit: sameUnit ? unique[0].unit : "mixed", receipts: unique };
}
