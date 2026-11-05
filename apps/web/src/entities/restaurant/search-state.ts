const catalogKeys = new Set([
  "q",
  "page",
  "display",
  "sort",
  "max_price",
  "restaurant_id",
  "compare",
]);

export function catalogReturnParams(
  state: string | null,
  query = "",
): Record<string, string> {
  if (!state || state.length > 1500) return query ? { q: query } : {};
  const result: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(state))
    if (catalogKeys.has(key) && value.length <= 100) result[key] = value;
  return result;
}

export function compareIds(value: string | null): number[] {
  if (!value || value.length > 32) return [];
  const ids = value.split(",").map(Number);
  if (
    ids.length > 3 ||
    ids.some((id) => !Number.isSafeInteger(id) || id < 1 || id > 2147483647)
  )
    return [];
  return [...new Set(ids)];
}
