import type { Metadata } from "next";

import { TopupsPage } from "@/components/admin/topups-page";

export const metadata: Metadata = { title: "充值管理 · Cyanyi Admin" };

export default function Page() {
  return <TopupsPage />;
}
