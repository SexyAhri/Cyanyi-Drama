export function isStudioAgentOperationEnabled(
  operation: string,
  disabledOperations: readonly string[] = [],
) {
  return !disabledOperations.includes(operation);
}

export function filterStudioAgentOperationCandidates<
  T extends Record<string, unknown>,
>(candidates: T, disabledOperations: readonly string[] = []): T {
  const result = { ...candidates };
  for (const operation of disabledOperations) {
    if (operation in result) result[operation as keyof T] = [] as T[keyof T];
  }
  return result;
}
