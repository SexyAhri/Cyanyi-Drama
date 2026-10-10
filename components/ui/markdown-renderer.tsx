import { isValidElement, type ComponentPropsWithoutRef, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";

type MarkdownRendererProps = {
  children: string;
};

export function MarkdownRenderer({ children }: MarkdownRendererProps) {
  return (
    <div className="min-w-0 max-w-full space-y-3 [overflow-wrap:anywhere]">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </div>
  );
}

function Code({
  children,
  className,
  node,
  ...props
}: ComponentPropsWithoutRef<"code"> & { node?: unknown }) {
  void node;
  return (
    <code
      className={cn(
        "font-mono [:not(pre)>&]:break-all [:not(pre)>&]:rounded-md [:not(pre)>&]:bg-muted [:not(pre)>&]:px-1 [:not(pre)>&]:py-0.5",
        className,
      )}
      {...props}
    >
      {children}
    </code>
  );
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const className = isValidElement<{ className?: string }>(children)
    ? children.props.className
    : undefined;
  const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
  const isPlainText = !language || /^(text|txt|plain|plaintext|prompt|markdown|md)$/i.test(language);
  const code = takeStringContents(children);

  return (
    <div className="group/code relative min-w-0 max-w-full overflow-hidden rounded-xl border border-border/60 bg-muted/35">
      <div className="flex min-h-9 items-center justify-between gap-3 border-b border-border/40 px-3 text-xs text-muted-foreground">
        <span>{isPlainText ? "文本" : language}</span>
        <CopyButton content={code} copyMessage="已复制" />
      </div>
      <pre className={cn(
        "max-w-full p-3 text-sm leading-6",
        isPlainText
          ? "whitespace-pre-wrap break-words font-sans [overflow-wrap:anywhere]"
          : "overflow-x-auto font-mono",
      )}>
        <code className={cn(className, isPlainText && "font-sans")}>
          {code}
        </code>
      </pre>
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
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return takeStringContents(node.props.children);
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
  a: withClass(
    "a",
    "break-all text-primary underline underline-offset-2",
  ),
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
  p: withClass("p", "max-w-full whitespace-pre-wrap [overflow-wrap:anywhere]"),
  pre: CodeBlock,
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
