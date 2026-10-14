export function inspectTemplateVariables(
  template: string,
  requiredVariables: readonly string[],
) {
  const found = new Set(
    Array.from(template.matchAll(/\{\{([^{}]+)\}\}/g), (match) => match[1].trim()),
  );
  const allowed = new Set(requiredVariables);
  return {
    missing: requiredVariables.filter((name) => !found.has(name)),
    unknown: [...found].filter((name) => !allowed.has(name)),
  };
}

export function validateAgentTemplateVariables(
  agents: Readonly<Record<string, { templateZh?: string; templateEn?: string }>>,
  catalog: readonly { id: string; variables: readonly string[] }[],
) {
  for (const [id, agent] of Object.entries(agents)) {
    const entry = catalog.find((item) => item.id === id);
    if (!entry) return `未知 Agent：${id}`;
    for (const template of [agent.templateZh, agent.templateEn]) {
      if (!template?.trim()) continue;
      const { unknown, missing } = inspectTemplateVariables(template, entry.variables);
      if (unknown.length || missing.length)
        return `${id}：${unknown.length ? `未知变量 ${unknown.join("、")}` : ""}${missing.length ? ` 缺少变量 ${missing.join("、")}` : ""}`;
    }
  }
  return null;
}

export function previewTemplateVariables(
  template: string,
  values: Readonly<Record<string, string>> = {},
) {
  return template.replace(/\{\{([^{}]+)\}\}/g, (_match, rawName: string) => {
    const name = rawName.trim();
    return Object.hasOwn(values, name) ? values[name] : `⟦${name}⟧`;
  });
}

export function insertTemplateVariable(
  template: string,
  name: string,
  start: number,
  end = start,
) {
  const token = `{{${name}}}`;
  const insertionPoint = Math.max(0, Math.min(template.length, start));
  const selectionEnd = Math.max(insertionPoint, Math.min(template.length, end));
  return {
    template: `${template.slice(0, insertionPoint)}${token}${template.slice(selectionEnd)}`,
    cursor: insertionPoint + token.length,
  };
}
