import type { Metadata } from "next";

import { UsagePage } from "@/components/admin/usage-page";

export const metadata: Metadata = { title: "用量记录 · Cyanyi Admin" };

export default function Page() {
  return <UsagePage />;
}
