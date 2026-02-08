export function parsePositiveInt(
  value: FormDataEntryValue | string | null,
  fallback: number,
): number {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

export function parseNonNegativeInt(value: string | null, fallback: number): number {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return fallback;
}
