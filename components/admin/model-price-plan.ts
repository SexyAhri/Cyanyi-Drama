import { CAPABILITY_BILLING_UNITS, validatePricePlan, type ModelPriceEntry, type PriceRate } from "@/lib/billing/pricing-contract";

export type PriceChannel = { id: string; name: string; providerKey: string; models?: Array<{ id: string; modelId?: string; name: string; type?: string; selected?: boolean }> };
export type ModelPricePlan = { key: string; provider: string; model: string; capability: string; label: string; channel: string; prices: ModelPriceEntry[]; legacy: boolean };
export type PriceDraft = { mode: string; values: Record<string, string> };

export const priceUnitLabels: Record<string, string> = {
  request: "次请求", image: "张", second: "秒", minute: "分钟", character: "字符", "1k_character": "千字符", "1m_character": "百万字符",
  "1m_input_tokens": "百万输入 Token", "1m_output_tokens": "百万输出 Token", "1m_cached_input_tokens": "百万缓存读取 Token", "1m_cache_write_tokens": "百万缓存写入 Token",
};
export const capabilityLabels: Record<string, string> = { text: "文本", image: "图片", video: "视频", audio: "音频", lipsync: "口型同步", voicedesign: "声音设计" };

export function modelPricePlans(channels: PriceChannel[], prices: ModelPriceEntry[]): ModelPricePlan[] {
  const plans = new Map<string, ModelPricePlan>();
  const keyFor = (provider: string, model: string, capability: string) => JSON.stringify([provider, model, capability]);
  for (const channel of channels) for (const model of channel.models ?? []) {
    if (model.selected === false) continue;
    const capability = model.type === "llm" ? "text" : model.type ?? "image";
    if (!CAPABILITY_BILLING_UNITS[capability]) continue;
    const id = model.modelId || model.id, key = keyFor(channel.providerKey, id, capability);
    const existing = plans.get(key);
    if (existing) { existing.channel += ` / ${channel.name}`; continue; }
    const suffix = ` · ${channel.name}`;
    plans.set(key, { key, provider: channel.providerKey, model: id, capability, label: model.name.endsWith(suffix) ? model.name.slice(0, -suffix.length) : model.name, channel: channel.name, prices: [], legacy: false });
  }
  for (const price of prices.filter(price => price.active)) {
    const key = keyFor(price.provider, price.model, price.capability);
    const plan = plans.get(key) ?? { key, provider: price.provider, model: price.model, capability: price.capability, label: price.model, channel: price.provider, prices: [], legacy: false };
    plan.prices.push(price); plans.set(key, plan);
  }
  for (const plan of plans.values()) {
    if (!plan.prices.length) continue;
    try { validatePricePlan(plan.capability, plan.prices); } catch { plan.legacy = true; }
  }
  return [...plans.values()];
}

export function draftForPlan(plan: ModelPricePlan): PriceDraft {
  const token = plan.capability === "text" && (plan.legacy || !plan.prices.length || plan.prices.some(p => p.unit.startsWith("1m_")));
  const mode = token ? "tokens" : plan.prices[0]?.unit ?? (plan.capability === "image" ? "image" : ["video", "lipsync"].includes(plan.capability) ? "second" : plan.capability === "audio" ? "minute" : "request");
  return { mode, values: Object.fromEntries((plan.legacy ? [] : plan.prices).map(p => [p.unit, p.unitPrice])) };
}

export function draftRates(draft: PriceDraft): PriceRate[] {
  const units = draft.mode === "tokens" ? ["1m_input_tokens", "1m_output_tokens", "1m_cached_input_tokens", ...(draft.values["1m_cache_write_tokens"]?.trim() ? ["1m_cache_write_tokens"] : [])] : [draft.mode];
  return units.map(unit => ({ unit, unitPrice: draft.values[unit]?.trim() ?? "" }));
}

export function pricePlanSummary(plan: ModelPricePlan) {
  if (!plan.prices.length) return "未配置";
  return [...plan.prices].sort((a, b) => (CAPABILITY_BILLING_UNITS[plan.capability]?.indexOf(a.unit) ?? 0) - (CAPABILITY_BILLING_UNITS[plan.capability]?.indexOf(b.unit) ?? 0))
    .map(price => `${price.unit === "1m_input_tokens" ? "输入 " : price.unit === "1m_output_tokens" ? "输出 " : price.unit === "1m_cached_input_tokens" ? "缓存读取 " : price.unit === "1m_cache_write_tokens" ? "缓存写入 " : ""}¥${price.unitPrice}${price.unit.includes("tokens") ? "/M" : `/${priceUnitLabels[price.unit] ?? price.unit}`}`).join(" · ");
}
