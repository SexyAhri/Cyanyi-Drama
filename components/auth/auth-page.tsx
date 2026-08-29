"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type AuthMode = "login" | "register";

type AuthResponse = {
  message?: string;
  user?: {
    id: string;
  };
};

export function AuthPage({
  appVersion,
  hasAnonymousSession,
  nextPath,
}: {
  appVersion: string;
  hasAnonymousSession: boolean;
  nextPath: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (mode === "register" && password !== confirmPassword) {
      setError("两次输入的密码不一致");
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
          ...(mode === "register" ? { displayName } : {}),
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

  function changeMode(value: string) {
    if (value !== "login" && value !== "register") return;
    setMode(value);
    setError(null);
  }

  return (
    <main className="h-dvh overflow-y-auto bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center py-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              alt="Cyanyi Drama"
              className="size-10 rounded-lg"
              height={40}
              priority
              src="/brand/agent-ui-logo.png"
              width={40}
            />
            <div>
              <p className="font-semibold">Cyanyi Drama</p>
              <p className="text-xs text-muted-foreground">AI 漫剧创作工作台</p>
            </div>
          </div>
          <ThemeToggle label="切换主题" />
        </div>

        <section className="rounded-lg border bg-background p-5 shadow-sm sm:p-6">
          <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
            {(
              [
                { label: "登录", value: "login" },
                { label: "注册", value: "register" },
              ] as const
            ).map((item) => (
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
                  {mode === "login" ? "登录账号" : "创建账号"}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {mode === "login"
                    ? "登录后继续管理你的项目和生成任务。"
                    : "项目、资产和运行设置会归到这个账号。"}
                </p>
              </div>

              {hasAnonymousSession && mode === "register" ? (
                <Alert className="mb-5">
                  <AlertDescription>
                    注册成功后，当前浏览器中的已有项目和设置会自动保留。
                  </AlertDescription>
                </Alert>
              ) : null}

              {error ? (
                <Alert className="mb-5" variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

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

                <PasswordField
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
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

                <Button className="mt-1 w-full" disabled={submitting} type="submit">
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
          </div>
        </section>

        <p className="mt-4 text-center font-mono text-xs text-muted-foreground">
          v{appVersion}
        </p>
      </div>
    </main>
  );
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
