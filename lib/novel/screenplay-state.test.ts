import { describe, expect, it } from "vitest";
import { inspectStructuredScreenplay } from "./screenplay-state";

function screenplay(content: unknown[]) {
  return JSON.stringify({ clipId: "clip", originalText: "甲走进房间。", scenes: [{
    sceneNumber: 0, heading: { intExt: "INT", location: "屋内", time: "日" },
    description: "甲进门", characters: ["甲"], content,
  }] });
}
describe("screenplay production state", () => {
  it.each([null, "", "{", "{}", '{"scenes":[]}'])("treats incomplete %s as unstructured with speech unknown", value => {
    expect(inspectStructuredScreenplay(value)).toEqual({ structured: false, speechExpected: true });
  });
  it("recognizes a valid action-only silent script", () => {
    expect(inspectStructuredScreenplay(screenplay([{ type: "action", text: "甲进门" }]))).toEqual({ structured: true, speechExpected: false });
  });
  it.each([
    { type: "dialogue", character: "甲", parenthetical: null, lines: "你好" },
    { type: "voiceover", character: null, text: "天亮了" },
  ])("requires audio for performed speech", line => {
    expect(inspectStructuredScreenplay(screenplay([line]))).toEqual({ structured: true, speechExpected: true });
  });
});
