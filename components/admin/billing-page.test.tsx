import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createModelPriceEditDraft, PriceRowActions } from "./billing-page";

const price = {
  id: "price-1",
  provider: "custom",
  model: "deepseek-v4-flash",
  capability: "text",
  unit: "request",
  unitPrice: "0.004",
  active: true,
};

describe("admin model price editing", () => {
  it("loads the existing billing dimensions and price into the editor", () => {
    expect(createModelPriceEditDraft(price, [
      { key: "channel-model", provider: "custom", model: "deepseek-v4-flash" },
    ])).toEqual({ modelKey: "channel-model", capability: "text", unit: "request", unitPrice: "0.004" });
  });

  it("keeps legacy prices editable even when the model is no longer in channel options", () => {
    expect(createModelPriceEditDraft(price, [])).toEqual({
      modelKey: '["price","price-1"]', capability: "text", unit: "request", unitPrice: "0.004",
    });
  });

  it("exposes an accessible edit action beside delete", () => {
    const html = renderToStaticMarkup(createElement(PriceRowActions, {
      disabled: false,
      model: price.model,
      onDelete: vi.fn(),
      onEdit: vi.fn(),
    }));
    expect(html).toContain('aria-label="编辑 deepseek-v4-flash 价格"');
    expect(html).toContain('aria-label="删除价格"');
  });
});
