"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  GitBranch,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
  Waypoints,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { PublicAuthConfig } from "@/lib/server/auth-config";

type AuthMode = "login" | "register";

type AuthResponse = {
  message?: string;
  user?: { id: string };
};

export function AuthPage({
  appVersion,
  authConfig,
  hasAnonymousSession,
  initialMode,
  nextPath,
  oauthError,
}: {
  appVersion: string;
  authConfig: PublicAuthConfig;
  hasAnonymousSession: boolean;
  initialMode: AuthMode;
  nextPath: string;
  oauthError?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(
    initialMode === "register" && !authConfig.registrationEnabled
      ? "login"
      : initialMode,
  );
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    oauthError ? oauthErrorMessage(oauthError) : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setInterval(
      () => setSecondsLeft((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [secondsLeft]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (mode === "register" && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    if (
      mode === "register" &&
      authConfig.emailVerificationEnabled &&
      !/^\d{6}$/.test(verificationCode)
    ) {
      setError("请输入 6 位邮箱验证码");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(mode === "register"
            ? { displayName, verificationCode }
            : {}),
        }),
      });
      const result = (await response.json().catch(() => ({}))) as AuthResponse;

      if (!response.ok || !result.user) {
        throw new Error(result.message || "认证失败，请稍后重试");
      }

      router.replace(nextPath);
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "认证失败，请稍后重试",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function sendCode() {
    setError(null);
    setNotice(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("请先填写正确的邮箱地址");
      return;
    }

    setSendingCode(true);
    try {
      const response = await fetch("/api/auth/email-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = (await response.json().catch(() => ({}))) as AuthResponse;
      if (!response.ok) throw new Error(result.message || "验证码发送失败");
      setSecondsLeft(60);
      setNotice("验证码已发送，请在 10 分钟内完成注册");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "验证码发送失败",
      );
    } finally {
      setSendingCode(false);
    }
  }

  function changeMode(value: AuthMode) {
    setMode(value);
    setError(null);
    setNotice(null);
  }

  return (
    <main className="h-dvh overflow-y-auto bg-muted/30 px-4 py-5 sm:px-6">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col">
        <header className="flex items-center justify-between">
          <Button
            nativeButton={false}
            render={<Link href="/" />}
            size="sm"
            variant="ghost"
          >
            <ArrowLeft />
            返回首页
          </Button>
          <div className="flex items-center gap-2">
            <Badge className="font-mono" variant="outline">
              v{appVersion}
            </Badge>
            <ThemeToggle label="切换主题" />
          </div>
        </header>

        <div className="flex flex-1 flex-col justify-center py-8 sm:py-12">
          <div className="mb-6 flex items-center gap-3">
            <Image
              alt="Cyanyi Drama"
              className="size-11 rounded-lg"
              height={44}
              priority
              src="/brand/agent-ui-logo.png"
              width={44}
            />
            <div>
              <p className="text-base font-semibold">Cyanyi Drama</p>
              <p className="text-sm text-muted-foreground">AI 漫剧创作工作台</p>
            </div>
          </div>

          <section className="rounded-lg border bg-background p-5 shadow-sm sm:p-6">
            <div
              className={cn(
                "grid rounded-lg bg-muted p-1",
                authConfig.registrationEnabled ? "grid-cols-2" : "grid-cols-1",
              )}
            >
              {([
                { label: "登录", value: "login" },
                ...(authConfig.registrationEnabled
                  ? ([{ label: "注册", value: "register" }] as const)
                  : []),
              ] as const).map((item) => (
                <Button
                  aria-pressed={mode === item.value}
                  className={cn(
                    "h-8 rounded-md",
                    mode === item.value && "bg-background shadow-sm",
                  )}
                  key={item.value}
                  onClick={() => changeMode(item.value)}
                  type="button"
                  variant="ghost"
                >
                  {item.label}
                </Button>
              ))}
            </div>

            <div className="mt-6">
              <div className="mb-5">
                <h1 className="text-xl font-semibold">
                  {mode === "login" ? "登录创作空间" : "创建项目账号"}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {mode === "login"
                    ? "继续管理项目、资产和生成任务。"
                    : "注册后，项目数据与运行设置会归入你的账号。"}
                </p>
              </div>

              {hasAnonymousSession && mode === "register" ? (
                <Alert className="mb-5">
                  <ShieldCheck />
                  <AlertDescription>
                    当前浏览器里的项目和设置会在注册成功后自动保留。
                  </AlertDescription>
                </Alert>
              ) : null}

              {notice ? (
                <Alert className="mb-5">
                  <CheckCircle2 />
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              ) : null}

              {error ? (
                <Alert className="mb-5" variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              {authConfig.github.enabled || authConfig.linuxdo.enabled ? (
                <div className="mb-5 grid gap-2">
                  {authConfig.github.enabled ? (
                    <Button
                      nativeButton={false}
                      render={
                        <a
                          href={`/api/auth/oauth/github/start?next=${encodeURIComponent(nextPath)}`}
                        />
                      }
                      variant="outline"
                    >
                      <GitBranch />
                      使用 GitHub 继续
                    </Button>
                  ) : null}
                  {authConfig.linuxdo.enabled ? (
                    <Button
                      nativeButton={false}
                      render={
                        <a
                          href={`/api/auth/oauth/linuxdo/start?next=${encodeURIComponent(nextPath)}`}
                        />
                      }
                      variant="outline"
                    >
                      <Waypoints />
                      使用 LinuxDO 继续
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {authConfig.emailAuthEnabled &&
              (authConfig.github.enabled || authConfig.linuxdo.enabled) ? (
                <div className="mb-5 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  邮箱登录
                  <span className="h-px flex-1 bg-border" />
                </div>
              ) : null}

              {authConfig.emailAuthEnabled ? (
                <form className="grid gap-4" onSubmit={submit}>
                {mode === "register" ? (
                  <AuthField
                    autoComplete="name"
                    icon={<UserRound />}
                    id="display-name"
                    label="显示名称（可选）"
                    onChange={setDisplayName}
                    placeholder="你的称呼"
                    required={false}
                    value={displayName}
                  />
                ) : null}

                <AuthField
                  autoComplete="email"
                  icon={<Mail />}
                  id="email"
                  label="邮箱"
                  onChange={setEmail}
                  placeholder="name@example.com"
                  type="email"
                  value={email}
                />

                {mode === "register" && authConfig.emailVerificationEnabled ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="verification-code">邮箱验证码</Label>
                    <div className="flex gap-2">
                      <Input
                        autoComplete="one-time-code"
                        className="font-mono"
                        id="verification-code"
                        inputMode="numeric"
                        maxLength={6}
                        onChange={(event) =>
                          setVerificationCode(
                            event.target.value.replace(/\D/g, ""),
                          )
                        }
                        placeholder="6 位验证码"
                        required
                        value={verificationCode}
                      />
                      <Button
                        className="w-28"
                        disabled={sendingCode || secondsLeft > 0}
                        onClick={() => void sendCode()}
                        type="button"
                        variant="outline"
                      >
                        {sendingCode ? (
                          <LoaderCircle className="animate-spin" />
                        ) : secondsLeft > 0 ? (
                          `${secondsLeft}s 后重发`
                        ) : (
                          "发送验证码"
                        )}
                      </Button>
                    </div>
                  </div>
                ) : null}

                <PasswordField
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  id="password"
                  label="密码"
                  onChange={setPassword}
                  onVisibilityChange={() =>
                    setPasswordVisible((current) => !current)
                  }
                  value={password}
                  visible={passwordVisible}
                />

                {mode === "register" ? (
                  <PasswordField
                    autoComplete="new-password"
                    id="confirm-password"
                    label="确认密码"
                    onChange={setConfirmPassword}
                    onVisibilityChange={() =>
                      setPasswordVisible((current) => !current)
                    }
                    value={confirmPassword}
                    visible={passwordVisible}
                  />
                ) : null}

                <Button
                  className="mt-1 h-9 w-full"
                  disabled={submitting}
                  type="submit"
                >
                  {submitting ? <LoaderCircle className="animate-spin" /> : null}
                  {submitting
                    ? mode === "login"
                      ? "登录中..."
                      : "注册中..."
                    : mode === "login"
                      ? "登录并进入项目"
                      : "创建账号并进入项目"}
                </Button>
                </form>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function oauthErrorMessage(code: string) {
  return (
    {
      service_unavailable: "该登录服务尚未配置或暂时不可用",
      state_invalid: "登录请求已过期，请重新发起",
      trust_level_low: "LinuxDO 信任等级未达到系统要求",
      registration_disabled: "系统当前不允许创建新账号",
      already_bound: "该账号已绑定其他身份",
      unknown_provider: "不支持的登录服务",
      oauth_failed: "第三方登录失败，请重试",
    } as Record<string, string>
  )[code] ?? "第三方登录失败，请重试";
}

function AuthField({
  autoComplete,
  icon,
  id,
  label,
  onChange,
  placeholder,
  required = true,
  type = "text",
  value,
}: {
  autoComplete: string;
  icon: React.ReactNode;
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  type?: string;
  value: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
        <Input
          autoComplete={autoComplete}
          className="pl-9"
          id={id}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          type={type}
          value={value}
        />
      </div>
    </div>
  );
}

function PasswordField({
  autoComplete,
  id,
  label,
  onChange,
  onVisibilityChange,
  value,
  visible,
}: {
  autoComplete: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  onVisibilityChange: () => void;
  value: string;
  visible: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoComplete={autoComplete}
          className="px-9"
          id={id}
          minLength={8}
          onChange={(event) => onChange(event.target.value)}
          required
          type={visible ? "text" : "password"}
          value={value}
        />
        <Button
          aria-label={visible ? "隐藏密码" : "显示密码"}
          className="absolute top-1/2 right-1 -translate-y-1/2"
          onClick={onVisibilityChange}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {visible ? <EyeOff /> : <Eye />}
        </Button>
      </div>
    </div>
  );
}
