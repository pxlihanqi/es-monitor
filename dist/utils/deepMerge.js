function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function deepMerge(base, patch) {
    if (!patch) {
        return base;
    }
    const result = { ...base };
    for (const [key, patchValue] of Object.entries(patch)) {
        const baseValue = result[key];
        if (isObject(baseValue) && isObject(patchValue)) {
            result[key] = deepMerge(baseValue, patchValue);
            continue;
        }
        result[key] = patchValue;
    }
    return result;
}
