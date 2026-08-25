import { describe, expect, it } from "vitest";

import { sha256Hex } from "./hash";

describe("media hash", () => {
  it("returns stable SHA-256 hashes for binary content", () => {
    expect(sha256Hex(new TextEncoder().encode("cyanyi"))).toBe(
      "855e2879d252c38b2c089a7d73c4a6717119c9075e98159e864ad3c4c98daa47",
    );
    expect(sha256Hex("cyanyi")).toBe(sha256Hex(new TextEncoder().encode("cyanyi")));
  });
});
