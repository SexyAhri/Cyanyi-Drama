export const CAPABILITY_BILLING_UNITS: Record<string, readonly string[]> = {
  text: ["1m_input_tokens", "1m_output_tokens", "1m_cached_input_tokens", "1m_cache_write_tokens", "request"],
  image: ["request", "image"],
  video: ["request", "second", "minute"],
  audio: ["second", "minute", "1m_character", "request"],
  lipsync: ["request", "second", "minute"],
  voicedesign: ["request", "second", "minute", "1m_character"],
};

export const TOKEN_PRICE_UNITS = ["1m_input_tokens", "1m_output_tokens", "1m_cached_input_tokens", "1m_cache_write_tokens"] as const;
export const isTokenPriceUnit = (unit: string) => (TOKEN_PRICE_UNITS as readonly string[]).includes(unit);

export type ModelPriceEntry = { id: string; provider: string; model: string; capability: string; unit: string; unitPrice: string; active: boolean };
export type PriceRate = { unit: string; unitPrice: string | number };

/** A saved plan is exclusive: token components together, or one fixed media/request rate. */
export function validatePricePlan(capability: string, rates: PriceRate[]) {
  if (!rates.length || rates.some(rate => !CAPABILITY_BILLING_UNITS[capability]?.includes(rate.unit)))
    throw new Error("请选择该能力支持的计费方式");
  if (new Set(rates.map(rate => rate.unit)).size !== rates.length) throw new Error("计费项不能重复");
  if (capability === "text" && rates.some(rate => isTokenPriceUnit(rate.unit))) {
    if (rates.some(rate => !isTokenPriceUnit(rate.unit)) || !["1m_input_tokens", "1m_output_tokens", "1m_cached_input_tokens"].every(unit => rates.some(rate => rate.unit === unit)))
      throw new Error("Token 计价必须同时填写输入、输出、缓存读取价格，不能叠加按次收费");
  } else if (rates.length !== 1) throw new Error("每个模型能力只能选择一种计费方式");
}

