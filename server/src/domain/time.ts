export interface LocalParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function partsInTz(date: Date, tz: string): LocalParts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { y: out.year!, m: out.month!, d: out.day!, h: out.hour!, mi: out.minute!, s: out.second! };
}

/** The instant at which the wall clock in `tz` reads the given local date and time. */
export function zonedToInstant(dateStr: string, hhmm: string, tz: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const [h, mi] = parseHHMM(hhmm);
  const target = Date.UTC(y, m - 1, d, h, mi);
  let guess = target;
  // Two passes converge across DST changes.
  for (let i = 0; i < 2; i++) {
    const p = partsInTz(new Date(guess), tz);
    guess += target - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  }
  return new Date(guess);
}

export function parseHHMM(hhmm: string): [number, number] {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`Invalid time "${hhmm}", expected HH:MM`);
  return [Number(m[1]), Number(m[2])];
}

export function minutesOfDay(hhmm: string): number {
  const [h, m] = parseHHMM(hhmm);
  return h * 60 + m;
}

export function formatHHMM(totalMinutes: number): string {
  const t = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function localDateString(date: Date, tz: string): string {
  const p = partsInTz(date, tz);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

export function localMinutesOfDay(date: Date, tz: string): number {
  const p = partsInTz(date, tz);
  return p.h * 60 + p.mi;
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

export function daysBetween(a: string, b: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

export interface Cycle {
  localDate: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * The 24h cycle containing `now`. Cycles end at `endsAt` local time every day;
 * the label is the local date on which the cycle ends.
 */
export function cycleFor(now: Date, tz: string, endsAt: string): Cycle {
  const today = localDateString(now, tz);
  const endToday = zonedToInstant(today, endsAt, tz);
  if (now < endToday) {
    return { localDate: today, startsAt: zonedToInstant(addDays(today, -1), endsAt, tz), endsAt: endToday };
  }
  const tomorrow = addDays(today, 1);
  return { localDate: tomorrow, startsAt: endToday, endsAt: zonedToInstant(tomorrow, endsAt, tz) };
}
