export type ProviderFailureCategory =
  | "authentication"
  | "content_rejected"
  | "invalid_parameters"
  | "network"
  | "output_validation"
  | "quota"
  | "rate_limit"
  | "timeout"
  | "provider_unavailable";

export function classifyProviderFailure(message: string): ProviderFailureCategory | null {
  const normalized = message.trim().toLowerCase();
  const status = normalized.match(/(?:structured_provider_failed:|http\s|http_|provider request failed\s*\()\s*(\d{3})/)?.[1];
  if (/insufficient[_ ]quota|quota[_ ]exceeded|out of credits|balance insufficient|余额不足|额度不足/.test(normalized) || status === "402") return "quota";
  if (/content[_ -]policy|content[_ -]filter|safety[_ -]refusal|refused by policy|内容违规|安全策略拒绝/.test(normalized)) return "content_rejected";
  if (status === "401" || status === "403" || /unauthorized|invalid api key|api[_ -]?key (?:missing|required|invalid)|鉴权失败|密钥无效|api_key_missing/.test(normalized)) return "authentication";
  if (status === "429" || /rate[_ -]?limit|too many requests|请求过于频繁|触发限流/.test(normalized)) return "rate_limit";
  if (status === "400" || status === "422" || /invalid[_ -]?(?:parameter|argument|request)|parameter[_ -]?(?:error|invalid)|fallback[_ -]incompatible|参数无效|参数错误/.test(normalized)) return "invalid_parameters";
  if (/structured_schema_invalid|structured_provider_text_missing|output[_ -]validation|schema validation|schema_invalid|输出校验失败|结构校验失败/.test(normalized)) return "output_validation";
  if (/provider_timeout|timed out|timeout|超时/.test(normalized)) return "timeout";
  if (/provider_transport|fetch failed|econnreset|etimedout|enotfound|socket hang up|网络连接|连接被重置/.test(normalized)) return "network";
  if (status && Number(status) >= 500) return "provider_unavailable";
  if (/provider failed \(5\d\d\)/.test(normalized)) return "provider_unavailable";
  return null;
}

export function mediaPhaseTimeoutGuidance(message: string, locale: "en" | "zh-CN") {
  const phase = message.match(/MEDIA_PHASE_TIMEOUT:([a-z_]+)/i)?.[1]?.toLowerCase();
  if (!phase) return null;
  const labels: Record<string, { zh: string; en: string }> = {
    queued: { zh: "排队", en: "queue wait" },
    waiting_quota: { zh: "模型请求名额等待", en: "model capacity wait" },
    connecting: { zh: "连接", en: "connection" },
    request_sent: { zh: "请求响应", en: "request response" },
    submitted: { zh: "服务端任务提交", en: "provider submission" },
    generating: { zh: "模型生成", en: "model generation" },
    downloading: { zh: "结果下载", en: "result download" },
    saving: { zh: "结果保存", en: "result save" },
  };
  const label = labels[phase];
  if (!label) return null;
  return locale === "zh-CN"
    ? `${label.zh}阶段超时。可查看渠道状态或队列/存储健康情况，再手动重试。`
    : `The ${label.en} phase timed out. Check the channel, queue, or storage health before retrying.`;
}

export function providerFailureGuidance(category: ProviderFailureCategory, locale: "en" | "zh-CN") {
  const messages = {
    "zh-CN": {
      authentication: "渠道鉴权失败：检查 API 密钥、权限和渠道状态后再重试。",
      content_rejected: "模型因内容策略拒绝请求：调整相关文本或素材后再提交。",
      invalid_parameters: "模型参数或输入不被渠道接受：检查模型能力、必填项和请求参数后再试。",
      network: "网络连接失败：确认渠道服务可访问后，再手动重试。",
      output_validation: "模型输出未通过结构校验：检查输入和 Agent 输出要求后再运行。",
      quota: "渠道额度或余额不足：补足额度后再提交。",
      rate_limit: "渠道正在限流：等待限流窗口结束后再重试。",
      timeout: "模型请求超时：检查渠道响应状态；确认没有未完成请求后再重试。",
      provider_unavailable: "模型服务暂时不可用：稍后检查服务状态再重试。",
    },
    en: {
      authentication: "Channel authentication failed: check the API key, permissions and channel status before retrying.",
      content_rejected: "The model rejected this request under its content policy: adjust the text or media, then submit again.",
      invalid_parameters: "The channel rejected the model parameters or input: check model capabilities, required fields and request parameters.",
      network: "The network connection failed: verify that the channel is reachable before manually retrying.",
      output_validation: "The model output failed schema validation: review the input and Agent output requirements before running again.",
      quota: "The channel has insufficient balance or quota: add capacity before submitting again.",
      rate_limit: "The channel is rate limiting requests: wait for the limit window to pass before retrying.",
      timeout: "The model request timed out: check channel status and verify no request is still running before retrying.",
      provider_unavailable: "The model service is unavailable: check its status and retry later.",
    },
  } as const;
  return messages[locale][category];
}

export function shouldRetryProviderFailure(category: ProviderFailureCategory) {
  return ["network", "provider_unavailable", "rate_limit", "timeout"].includes(category);
}
