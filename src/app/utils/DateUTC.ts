// Small helpers to create/normalize Date values in UTC consistently
export function utcNow(): Date {
  return new Date(Date.now());
}

export function utcNowPlus(ms: number): Date {
  return new Date(Date.now() + ms);
}

export function utcNowIso(): string {
  return new Date(Date.now()).toISOString();
}

export function parseToUtc(value: string | number | Date | undefined | null): Date | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return new Date(value.toISOString());
  const parsed = Date.parse(String(value));
  if (isNaN(parsed)) return undefined;
  return new Date(parsed);
}

export function ensureDate(value?: string | number | Date | null): Date {
  const d = parseToUtc(value);
  return d ?? utcNow();
}

export function ensureIso(value?: string | number | Date | null): string {
  const d = parseToUtc(value);
  return (d ?? new Date()).toISOString();
}

export default {
  utcNow,
  utcNowPlus,
  utcNowIso,
  parseToUtc,
  ensureDate,
  ensureIso,
};
