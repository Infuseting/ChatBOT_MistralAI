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

  if (typeof value === 'number') {
    const d = new Date(value);
    if (isNaN(d.getTime())) return undefined;
    return new Date(d.toISOString());
  }

  let s = String(value).trim();
  if (!s) return undefined;

  // Fast path: native parser handles many ISO variants
  const native = Date.parse(s);
  if (!isNaN(native)) return new Date(native);

  // Normalize separator (allow space instead of 'T') and try manual ISO parsing
  s = s.replace(' ', 'T');

  // Match YYYY-MM-DD[ T HH:MM[:SS[.sss]][Z|(+|-)HH:MM]]
  const isoRegex = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:\d{2})?$/;
  const m = s.match(isoRegex);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4] ?? 0);
    const minute = Number(m[5] ?? 0);
    const second = Number(m[6] ?? 0);
    const ms = m[7] ? Number((m[7] + '00').slice(0, 3)) : 0;
    const tz = m[8];

    if (!tz || tz === 'Z') {
      // Treat as UTC
      const utc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
      return new Date(utc);
    }

    // Handle timezone offsets like +02:00 or -05:30
    const sign = tz[0] === '-' ? -1 : 1;
    const [tzh, tzm] = tz.slice(1).split(':').map(Number);
    const offsetMinutes = sign * ( (tzh || 0) * 60 + (tzm || 0) );
    // Convert local time to UTC by subtracting the offset
    const utc = Date.UTC(year, month - 1, day, hour, minute, second, ms) - offsetMinutes * 60000;
    return new Date(utc);
  }

  // Could not parse
  return undefined;
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
