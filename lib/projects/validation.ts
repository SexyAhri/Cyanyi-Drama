export const PROJECT_NAME_MAX_LENGTH = 100;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 500;
export const EPISODE_NAME_MAX_LENGTH = 160;

export type ProjectDraft = {
  name: string;
  description?: string | null;
};

export type ProjectValidationIssue = {
  code:
    | "PROJECT_NAME_REQUIRED"
    | "PROJECT_NAME_TOO_LONG"
    | "PROJECT_DESCRIPTION_TOO_LONG";
  field: "name" | "description";
  limit?: number;
};

export function normalizeProjectDraft(input: ProjectDraft) {
  return {
    name: input.name.trim(),
    description: normalizeNullableText(input.description),
  };
}

export function validateProjectDraft(
  input: ProjectDraft,
): ProjectValidationIssue | null {
  const normalized = normalizeProjectDraft(input);
  if (!normalized.name) return { code: "PROJECT_NAME_REQUIRED", field: "name" };
  if (normalized.name.length > PROJECT_NAME_MAX_LENGTH) {
    return {
      code: "PROJECT_NAME_TOO_LONG",
      field: "name",
      limit: PROJECT_NAME_MAX_LENGTH,
    };
  }
  if (
    normalized.description &&
    normalized.description.length > PROJECT_DESCRIPTION_MAX_LENGTH
  ) {
    return {
      code: "PROJECT_DESCRIPTION_TOO_LONG",
      field: "description",
      limit: PROJECT_DESCRIPTION_MAX_LENGTH,
    };
  }
  return null;
}

export function normalizeEpisodeDraft(input: {
  name: string;
  description?: string | null;
  novelText?: string | null;
}) {
  return {
    name: input.name.trim(),
    description: normalizeNullableText(input.description),
    novelText: normalizeNullableText(input.novelText),
  };
}

export function validateEpisodeDraft(input: { name: string }) {
  const name = input.name.trim();
  if (!name) return "EPISODE_NAME_REQUIRED" as const;
  if (name.length > EPISODE_NAME_MAX_LENGTH)
    return "EPISODE_NAME_TOO_LONG" as const;
  return null;
}

function normalizeNullableText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}
