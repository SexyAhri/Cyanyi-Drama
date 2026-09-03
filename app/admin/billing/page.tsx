import type { Metadata } from "next";

import { BillingPage } from "@/components/admin/billing-page";

export const metadata: Metadata = { title: "扣费系统 · Cyanyi Admin" };

export default function Page() {
  return <BillingPage />;
}
