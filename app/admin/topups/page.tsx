import type { Metadata } from "next";

import { TopupsPage } from "@/components/admin/topups-page";

export const metadata: Metadata = { title: "充值订单 · Cyanyi Admin" };

export default function Page() {
  return <TopupsPage />;
}
