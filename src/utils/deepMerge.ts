function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  patch?: Record<string, unknown>
): T {
  if (!patch) {
    return base;
  }

  const result: Record<string, unknown> = { ...base };

  for (const [key, patchValue] of Object.entries(patch)) {
    const baseValue = result[key];

    if (isObject(baseValue) && isObject(patchValue)) {
      result[key] = deepMerge(baseValue, patchValue);
      continue;
    }

    result[key] = patchValue;
  }

  return result as T;
}
