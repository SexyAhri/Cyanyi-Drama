import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import packageJson from "../package.json";
import {
  ArrowRight,
  AudioLines,
  Boxes,
  Clapperboard,
  Film,
  PanelsTopLeft,
  Sparkles,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: "Cyanyi Drama · AI 漫剧创作工作台",
  description: "从故事、剧本、资产和分镜到声音与交付的 AI 漫剧生产工作台。",
};

const workflow = [
  {
    number: "01",
    title: "故事与剧本",
    description: "导入原文，完成集拆分、剧本转写、角色分析与连续性校验。",
    icon: Film,
  },
  {
    number: "02",
    title: "资产设计",
    description: "统一角色、场景、道具和全项目画风，沉淀可复用视觉资产。",
    icon: Boxes,
  },
  {
    number: "03",
    title: "分镜生产",
    description: "从镜头规划、提示词到图片与视频任务，按片段追踪生成状态。",
    icon: PanelsTopLeft,
  },
  {
    number: "04",
    title: "声音与交付",
    description: "分析台词、生成配音、组织时间线并完成成片交付。",
    icon: AudioLines,
  },
];

export default async function Home() {
  const user = await getCurrentUser();
  const authenticated = Boolean(user && !user.anonymous);

  return (
    <main className="h-dvh overflow-y-auto bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link className="flex items-center gap-2.5" href="/">
            <Image
              alt="Cyanyi Drama"
              className="size-8 rounded-lg"
              height={32}
              priority
              src="/brand/agent-ui-logo.png"
              width={32}
            />
            <span className="font-semibold">Cyanyi Drama</span>
            <Badge className="hidden font-mono sm:inline-flex" variant="outline">
              v{packageJson.version}
            </Badge>
          </Link>

          <nav className="flex items-center gap-1">
            <Button
              className="hidden sm:inline-flex"
              nativeButton={false}
              render={<Link href="#workflow" />}
              size="sm"
              variant="ghost"
            >
              生产流程
            </Button>
            <ThemeToggle label="切换主题" />
            {authenticated ? (
              <Button
                nativeButton={false}
                render={<Link href="/projects" />}
                size="sm"
              >
                进入项目
                <ArrowRight />
              </Button>
            ) : (
              <>
                <Button
                  nativeButton={false}
                  render={<Link href="/login" />}
                  size="sm"
                  variant="ghost"
                >
                  登录
                </Button>
                <Button
                  nativeButton={false}
                  render={<Link href="/login?mode=register" />}
                  size="sm"
                >
                  注册
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="relative isolate flex min-h-[76svh] items-center overflow-hidden border-b">
        <Image
          alt="Cyanyi Drama 项目资产与任务工作台"
          className="-z-20 object-cover object-left opacity-30 dark:opacity-20"
          fill
          loading="eager"
          priority
          sizes="100vw"
          src="/brand/product-workspace.png"
        />
        <div className="absolute inset-0 -z-10 bg-background/55" />

        <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="max-w-3xl">
            <div className="mb-5 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Sparkles className="size-4" />
              AI 漫剧创作工作台
            </div>
            <h1 className="text-4xl leading-tight font-semibold sm:text-6xl">
              Cyanyi Drama
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              把故事、剧本、角色资产、镜头、声音和交付放进同一条可追踪的生产流程。每个生成任务都有明确状态，成功结果可以继续复用。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                className="h-9 px-4"
                nativeButton={false}
                render={
                  <Link
                    href={authenticated ? "/projects" : "/login?mode=register"}
                  />
                }
              >
                {authenticated ? "继续创作" : "创建账号"}
                <ArrowRight />
              </Button>
              <Button
                className="h-9 px-4"
                nativeButton={false}
                render={<Link href="#workflow" />}
                variant="outline"
              >
                查看流程
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b bg-muted/20" id="workflow">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-10 max-w-2xl">
            <p className="text-sm font-medium text-muted-foreground">生产流程</p>
            <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">
              从编剧到成品，围绕实际任务组织
            </h2>
          </div>

          <div className="grid border-y sm:grid-cols-2 lg:grid-cols-4">
            {workflow.map((item) => {
              const Icon = item.icon;
              return (
                <article
                  className="border-b px-1 py-7 last:border-b-0 sm:px-5 sm:odd:border-r lg:border-r lg:border-b-0 lg:last:border-r-0"
                  key={item.number}
                >
                  <div className="mb-7 flex items-center justify-between">
                    <span className="font-mono text-xs text-muted-foreground">
                      {item.number}
                    </span>
                    <Icon className="size-5 text-muted-foreground" />
                  </div>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {item.description}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-b">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <div>
            <Clapperboard className="size-6 text-muted-foreground" />
            <h2 className="mt-5 text-2xl font-semibold">一处查看生产现场</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              左侧管理剧集，中间完成当前阶段工作，右侧持续展示 Agent、任务和费用。失败项可以定位到具体步骤，不必重跑已经成功的片段。
            </p>
          </div>
          <Image
            alt="Cyanyi Drama 资产库与任务状态"
            className="w-full rounded-lg border object-cover shadow-sm"
            height={715}
            sizes="(max-width: 1024px) 100vw, 60vw"
            src="/brand/product-workspace.png"
            width={1440}
          />
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>Cyanyi Drama · AI 漫剧创作工作台</span>
        <span className="font-mono">v{packageJson.version}</span>
      </footer>
    </main>
  );
}
