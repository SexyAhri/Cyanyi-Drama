export function normalizeAuthRedirect(
  value: string | null | undefined,
  fallback = "/projects",
) {
  if (!value?.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  try {
    const target = new URL(value, "http://cyanyi.local");
    if (target.origin !== "http://cyanyi.local" || target.pathname === "/login") {
      return fallback;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
