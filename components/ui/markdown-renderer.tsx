import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";

type MarkdownRendererProps = {
  children: string;
};

export function MarkdownRenderer({ children }: MarkdownRendererProps) {
  return (
    <div className="space-y-3">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </div>
  );
}

function Code({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"code"> & { node?: unknown }) {
  const match = /language-(\w+)/.exec(className ?? "");

  if (!match) {
    return (
      <code
        className={cn(
          "font-mono [:not(pre)>&]:rounded-md [:not(pre)>&]:bg-background/50 [:not(pre)>&]:px-1 [:not(pre)>&]:py-0.5",
          className,
        )}
        {...props}
      >
        {children}
      </code>
    );
  }

  const code = takeStringContents(children);

  return (
    <div className="group/code relative mb-4">
      <pre className="overflow-x-auto rounded-md border bg-background/50 p-4 font-mono text-sm [scrollbar-width:none]">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
      <div className="invisible absolute right-2 top-2 flex rounded-lg p-1 opacity-0 transition-all duration-200 group-hover/code:visible group-hover/code:opacity-100">
        <CopyButton content={code} copyMessage="Copied code to clipboard." />
      </div>
    </div>
  );
}

function takeStringContents(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map((child) => takeStringContents(child)).join("");
  }

  return "";
}

function withClass<Tag extends keyof React.JSX.IntrinsicElements>(
  Tag: Tag,
  classes: string,
) {
  function Component(props: ComponentPropsWithoutRef<Tag> & { node?: unknown }) {
    const { className, node, ...restProps } = props;

    void node;

    const Element = Tag as React.ElementType;

    return <Element className={cn(classes, className)} {...restProps} />;
  }

  Component.displayName = String(Tag);
  return Component;
}

const components = {
  a: withClass("a", "text-primary underline underline-offset-2"),
  blockquote: withClass("blockquote", "border-l-2 border-primary pl-4"),
  code: Code,
  h1: withClass("h1", "text-2xl font-semibold"),
  h2: withClass("h2", "text-xl font-semibold"),
  h3: withClass("h3", "text-lg font-semibold"),
  h4: withClass("h4", "text-base font-semibold"),
  h5: withClass("h5", "font-medium"),
  hr: withClass("hr", "border-foreground/20"),
  li: withClass("li", "my-1.5"),
  ol: withClass("ol", "list-decimal space-y-2 pl-6"),
  p: withClass("p", "whitespace-pre-wrap"),
  pre: ({ children }: { children?: ReactNode }) => children,
  strong: withClass("strong", "font-semibold"),
  table: withClass(
    "table",
    "w-full border-collapse overflow-y-auto rounded-md border border-foreground/20",
  ),
  td: withClass(
    "td",
    "border border-foreground/20 px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right",
  ),
  th: withClass(
    "th",
    "border border-foreground/20 px-4 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right",
  ),
  tr: withClass("tr", "m-0 border-t p-0 even:bg-muted"),
  ul: withClass("ul", "list-disc space-y-2 pl-6"),
};

export default MarkdownRenderer;
