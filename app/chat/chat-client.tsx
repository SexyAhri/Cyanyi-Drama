"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Chat } from "@/components/agent/chat";
import { useAgent } from "@/hooks/use-agent";
import { createAiSdkAdapter } from "@/lib/agent/ai-sdk-adapter";
import type { AuthUser } from "@/lib/server/auth";

export function ChatClient({
  appVersion,
  user,
}: {
  appVersion: string;
  user: AuthUser;
}) {
  const router = useRouter();
  const agent = useAgent({
    adapter: createAiSdkAdapter(),
  });

  async function logout() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("退出登录失败");
      router.replace("/login");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "退出登录失败");
    }
  }

  return (
    <Chat
      agent={agent}
      appVersion={appVersion}
      locale="zh-CN"
      onLogout={() => void logout()}
      user={{
        id: user.id,
        name: user.displayName,
        email: user.email,
        role: user.role,
      }}
    />
  );
}
