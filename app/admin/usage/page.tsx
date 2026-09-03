import type { Metadata } from "next";

import { UsagePage } from "@/components/admin/usage-page";

export const metadata: Metadata = { title: "使用日志 · Cyanyi Admin" };

export default function Page() {
  return <UsagePage />;
}
