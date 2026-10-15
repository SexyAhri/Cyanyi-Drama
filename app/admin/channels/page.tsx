import type { Metadata } from "next";

import { ChannelsPage } from "@/components/admin/channels-page";

export const metadata: Metadata = { title: "模型渠道 · Cyanyi Admin" };

export default function Page() {
  return <ChannelsPage />;
}
