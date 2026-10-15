import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@/lib/agent/types";
import type { StudioAgentContext, WorkspaceSnapshot } from "../types";
import { AgentPanel } from "./agent-panel";
import { directorAssistantCopy, getDirectorComposerCopy } from "./director-assistant-copy";

const agent = vi.hoisted(() => ({
  messages: [] as AgentMessage[],
  error: null as Error | null,
  isLoading: false,
  isStreaming: false,
  pendingApprovalIds: [],
  reset: vi.fn(),
  loadMessages: vi.fn(),
  sendMessage: vi.fn(),
  approveToolCall: vi.fn(),
  denyToolCall: vi.fn(),
}));

vi.mock("@/hooks/use-agent", () => ({ useAgent: () => agent }));
vi.mock("../writing/split-novel-dialog", () => ({ SplitNovelDialog: () => null }));
vi.mock("./script-setup-dialog", () => ({ SCRIPT_TRENDING_TOPICS: [], ScriptSetupDialog: () => null }));

const context: StudioAgentContext = { stageId: "writing", view: "canvas", episodeId: "episode-1" };
const snapshot = {
  project: { id: "project-1", name: "Test project", config: {}, episodes: [{ id: "episode-1", name: "Test episode" }] },
} as unknown as WorkspaceSnapshot;

function render(locale: "zh-CN" | "en", selectedContext = context) {
  return renderToStaticMarkup(<AgentPanel analysisModelId="" context={selectedContext} locale={locale} models={[]}
    onAnalysisModelChange={() => {}} onRefresh={() => {}} snapshot={snapshot} />);
}

beforeEach(() => {
  agent.messages = [
    { id: "user-1", role: "user", content: "Check this asset", createdAt: "2026-10-15T12:00:00Z" },
    { id: "reply-1", role: "assistant", content: "Partial reply", createdAt: "2026-10-15T12:00:01Z" },
  ];
  agent.error = null;
});

describe("director assistant reply errors", () => {
  it.each(["zh-CN", "en"] as const)("keeps the failed reply and its error above the composer (%s)", (locale) => {
    agent.error = new Error("Upstream <unavailable>");
    const html = render(locale);
    const conversation = html.slice(html.indexOf('role="log"'), html.indexOf("<form"));
    const composer = html.slice(html.indexOf("<form"));
    expect(conversation).toContain('role="alert"');
    expect(conversation.indexOf("Partial reply")).toBeLessThan(conversation.indexOf('role="alert"'));
    expect(conversation).toContain(directorAssistantCopy[locale].errorRecovery);
    expect(conversation).toContain(`<summary class="cursor-pointer text-muted-foreground">${directorAssistantCopy[locale].errorDetails}</summary>`);
    expect(conversation).toContain("Upstream &lt;unavailable&gt;");
    expect(composer).not.toContain('role="alert"');
    expect(composer).not.toContain("Upstream");
  });

  it("removes the error presentation after the Agent clears its error for a retry", () => {
    agent.error = new Error("Failed to fetch");
    expect(render("zh-CN")).toContain('role="alert"');
    agent.error = null;
    expect(render("zh-CN")).not.toContain('role="alert"');
    expect(render("zh-CN")).toContain("Partial reply");
  });
});

describe("director assistant capability copy", () => {
  it.each(["character", "location", "prop"] as const)("directs %s edits to the asset editor in both languages", (kind) => {
    const selectedContext: StudioAgentContext = { ...context, canvasNodeId: "asset-node", selection: { id: "asset-1", kind, label: "Asset" } };
    for (const locale of ["zh-CN", "en"] as const) {
      const copy = getDirectorComposerCopy(selectedContext, locale);
      expect(copy.placeholder).toBe(directorAssistantCopy[locale].askAsset);
      expect(copy.hint).toBe(directorAssistantCopy[locale].assetHint);
      const html = render(locale, selectedContext);
      expect(html).toContain(`placeholder="${copy.placeholder}"`);
      expect(html).toContain(copy.hint);
      expect(html).toContain('aria-describedby="');
    }
  });

  it("does not apply the asset restriction to a generated image branch", () => {
    const selectedContext: StudioAgentContext = { ...context, canvasNodeId: "image-node", selection: { id: "image-node", kind: "canvas_node", label: "Asset · Image" } };
    expect(getDirectorComposerCopy(selectedContext, "zh-CN")).toEqual({ placeholder: directorAssistantCopy["zh-CN"].ask, hint: null });
    expect(render("zh-CN", selectedContext)).not.toContain(directorAssistantCopy["zh-CN"].assetHint);
  });
});
