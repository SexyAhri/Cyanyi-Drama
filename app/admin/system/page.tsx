import type { Metadata } from "next";

import { SystemPage } from "@/components/admin/system-page";

export const metadata: Metadata = { title: "系统设置 · Cyanyi Admin" };

export default function Page() {
  return <SystemPage />;
}
