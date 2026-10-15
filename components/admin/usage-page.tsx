"use client";

import { AdminPage } from "@/components/admin/admin-page";
import { UsageRecordsPanel } from "@/components/usage/usage-records-panel";

export function UsagePage() {
  return (
    <AdminPage
      description="查看全站模型调用的用户、项目、输入/输出及缓存 Token、实际用量和费用。"
      title="用量记录"
    >
      <UsageRecordsPanel admin />
    </AdminPage>
  );
}
