import type { ReactNode } from "react";
import {
  renderImageGenerationResult,
  renderVideoGenerationResult,
} from "./tool-renderers";

export type ToolRegistryItem = {
  name: string;
  label: string;
  description?: string;
  renderArgs?: (args: unknown) => ReactNode;
  renderResult?: (result: unknown) => ReactNode;
  showArgs?: boolean;
};

export type ToolRegistry = Record<string, ToolRegistryItem>;

export const defaultToolRegistry: ToolRegistry = {
  langgraph_deploy: {
    name: "langgraph_deploy",
    label: "Preview deployment",
    description: "Runs after a LangGraph approval interrupt is resumed.",
    renderArgs: (args) => <JsonPreview value={args} />,
    renderResult: (result) => <JsonPreview value={result} />,
  },
  image_generation: {
    name: "image_generation",
    label: "Image generation",
    description: "Creates image generation tasks from composer settings.",
    renderResult: renderImageGenerationResult,
    showArgs: false,
  },
  video_generation: {
    name: "video_generation",
    label: "Video generation",
    description: "Creates video generation tasks from composer settings.",
    renderResult: renderVideoGenerationResult,
    showArgs: false,
  },
};

export function JsonPreview({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap wrap-break-word rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed">
      {formatUnknown(value)}
    </pre>
  );
}

export function formatUnknown(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
