import { MarkdownRenderer } from "@/components/ui/markdown-renderer";

type MarkdownProps = {
  content: string;
};

export function Markdown({ content }: MarkdownProps) {
  return <MarkdownRenderer>{content}</MarkdownRenderer>;
}
