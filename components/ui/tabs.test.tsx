import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function openingTag(html: string, testId: string) {
  const tag = html.match(
    new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`),
  )?.[0];
  expect(tag).toBeDefined();
  return tag!;
}

describe("nested tabs", () => {
  it.each(["default", "line"] as const)(
    "isolates horizontal Agent tabs inside a vertical %s settings menu",
    (outerVariant) => {
      const innerVariant = outerVariant === "default" ? "line" : "default";
      const html = renderToStaticMarkup(
        <Tabs orientation="vertical" defaultValue="agents">
          <TabsList variant={outerVariant} data-testid="settings-list">
            <TabsTrigger value="agents" data-testid="settings-tab">
              Agent 管理
            </TabsTrigger>
            <TabsTrigger value="sound">声音制作方式</TabsTrigger>
          </TabsList>
          <TabsContent value="agents">
            <Tabs defaultValue="identity">
              <TabsList variant={innerVariant} data-testid="agent-list">
                <TabsTrigger value="identity" data-testid="agent-tab">
                  职责与规则
                </TabsTrigger>
                <TabsTrigger value="prompts">提示词模板</TabsTrigger>
                <TabsTrigger value="runtime">模型与权限</TabsTrigger>
              </TabsList>
              <TabsContent value="identity">编辑内容</TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>,
      );
      const outerList = openingTag(html, "settings-list");
      const innerList = openingTag(html, "agent-list");
      const outerTab = openingTag(html, "settings-tab");
      const innerTab = openingTag(html, "agent-tab");
      expect(outerList).toContain('aria-orientation="vertical"');
      expect(outerList).toContain('data-orientation="vertical"');
      expect(innerList).toContain('data-orientation="horizontal"');
      expect(innerList).not.toContain('aria-orientation="vertical"');
      expect(outerTab).toContain('data-orientation="vertical"');
      expect(innerTab).toContain('data-orientation="horizontal"');
      expect(outerTab).toContain(`data-variant="${outerVariant}"`);
      expect(innerTab).toContain(`data-variant="${innerVariant}"`);
      expect(innerTab).toContain('aria-selected="true"');
      expect(innerTab).toContain("focus-visible:ring");
      expect(innerTab).toContain("data-[orientation=horizontal]:data-[variant=line]:after:bottom-0");
      expect(innerList).toContain("data-[orientation=vertical]:flex-col");
      expect(html).not.toContain("group-data-");
      expect(html).toContain("编辑内容");
    },
  );

  it("keeps disabled tabs and caller layout overrides", () => {
    const html = renderToStaticMarkup(
      <Tabs defaultValue="enabled">
        <TabsList className="w-full" variant="line">
          <TabsTrigger
            value="enabled"
            className="h-auto min-h-11 flex-none"
            data-testid="enabled"
          >
            Enabled
          </TabsTrigger>
          <TabsTrigger value="disabled" disabled data-testid="disabled">
            Disabled
          </TabsTrigger>
        </TabsList>
        <TabsContent value="enabled">Content</TabsContent>
      </Tabs>,
    );
    expect(openingTag(html, "disabled")).toContain('aria-disabled="true"');
    expect(openingTag(html, "enabled")).toContain("h-auto min-h-11 flex-none");
    expect(openingTag(html, "enabled")).not.toContain(
      "h-[calc(100%-1px)] flex-1",
    );
  });
});
