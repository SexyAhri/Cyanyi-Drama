import { describe, expect, it } from "vitest";

import { formatImageRatioLabel } from "./media-ratio";

describe("formatImageRatioLabel", () => {
  it("keeps common landscape and portrait ratios readable", () => {
    expect(formatImageRatioLabel(3840, 2160)).toBe("16:9");
    expect(formatImageRatioLabel(2160, 3840)).toBe("9:16");
  });

  it("uses a friendly approximate ratio for unusual image sizes", () => {
    expect(formatImageRatioLabel(864, 1821)).toBe("约 9:19");
  });

  it("does not show decimal width-to-height ratios", () => {
    expect(formatImageRatioLabel(864, 1821)).not.toBe("0.47:1");
  });
});
