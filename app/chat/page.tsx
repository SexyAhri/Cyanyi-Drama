import { ChatClient } from "./chat-client";
import packageJson from "../../package.json";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";

export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user || user.anonymous) redirect("/login?next=/chat");
  return <ChatClient appVersion={packageJson.version} user={user} />;
}
