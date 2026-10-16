"use client";

import { type FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LoaderCircle, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialAdminSchema } from "@/lib/auth/initial-setup";

export function InitialAdminDialog() {
  const router = useRouter();
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedElsewhere, setCompletedElsewhere] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const parsed = initialAdminSchema.safeParse(values);
    setError(null);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue.message);
      const field = form.elements.namedItem(String(issue.path[0]));
      if (field instanceof HTMLElement) field.focus();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const result = await response.json().catch(() => null) as {
        user?: { id: string };
        code?: string;
        message?: string;
      } | null;
      if (result?.code === "INITIAL_SETUP_COMPLETED") setCompletedElsewhere(true);
      if (!response.ok || !result?.user) throw new Error(result?.message || "初始化暂未完成，请稍后重试");

      // Clear credentials and leave the form only after the server commits and
      // attaches the session cookie; full navigation avoids stale auth caches.
      form.reset();
      window.location.replace("/admin");
    } catch (requestError) {
      setError(requestError instanceof TypeError ? "网络连接失败，请检查连接后重试" : requestError instanceof Error ? requestError.message : "初始化暂未完成，请稍后重试");
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(_, details) => details.cancel()}>
      <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4" aria-hidden="true" />
            首次部署
          </div>
          <DialogTitle className="text-xl leading-7">设置管理员账号</DialogTitle>
          <DialogDescription className="leading-6">
            欢迎使用 Cyanyi Drama。请先创建首位管理员，之后即可配置模型、渠道和站点设置。
          </DialogDescription>
        </DialogHeader>

        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        {completedElsewhere ? (
          <Button onClick={() => { router.replace("/login"); router.refresh(); }}>前往登录</Button>
        ) : (
          <form onSubmit={submit} className="space-y-4" aria-busy={submitting}>
            <fieldset disabled={submitting} className="min-w-0 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="setup-display-name">管理员名称</Label>
                <Input id="setup-display-name" name="displayName" autoComplete="nickname" placeholder="如何称呼你" required maxLength={80} className="h-10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-email">邮箱</Label>
                <Input id="setup-email" name="email" type="email" autoComplete="username" placeholder="admin@example.com" required maxLength={254} className="h-10" aria-describedby="setup-email-hint" />
                <p id="setup-email-hint" className="text-xs leading-5 text-muted-foreground">用于登录。首次初始化无需邮箱验证码。</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-password">密码</Label>
                <div className="relative">
                  <Input id="setup-password" name="password" type={passwordVisible ? "text" : "password"} autoComplete="new-password" placeholder="至少 8 位" required minLength={8} maxLength={128} className="h-10 pr-12" />
                  <Button type="button" variant="ghost" size="icon" className="absolute top-0 right-0 h-10 w-10" aria-label={passwordVisible ? "隐藏密码" : "显示密码"} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((value) => !value)}>
                    {passwordVisible ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-confirm-password">确认密码</Label>
                <Input id="setup-confirm-password" name="confirmPassword" type={passwordVisible ? "text" : "password"} autoComplete="new-password" placeholder="再次输入密码" required minLength={8} maxLength={128} className="h-10" />
              </div>
              <p className="text-xs leading-5 text-muted-foreground">此账号拥有全站管理权限，创建后将关闭初始化入口。</p>
              <Button type="submit" disabled={submitting} className="h-10 w-full" aria-live="polite">
                {submitting && <LoaderCircle className="animate-spin" />}
                {submitting ? "正在创建管理员…" : "创建管理员并进入后台"}
              </Button>
            </fieldset>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
