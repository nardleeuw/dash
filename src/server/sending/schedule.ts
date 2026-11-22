/**
 * Sending windows and pacing. Pure functions (unit tested); timezone-aware via
 * Intl without external dependencies.
 */
export type Window = { timezone: string; sendDays: number[]; start: string; end: string };

type Parts = { y: number; m: number; d: number; h: number; mi: number; wd: number };

export function zonedParts(date: Date, tz: string): Parts {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) + 1;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), wd };
}

/** UTC instant for a wall-clock time in a timezone. */
export function fromZoned(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  let guess = new Date(Date.UTC(y, m - 1, d, h, mi));
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, tz);
    const diff = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Date.UTC(y, m - 1, d, h, mi);
    if (diff === 0) break;
    guess = new Date(guess.getTime() - diff);
  }
  return guess;
}

const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return { h, m: m || 0 };
};

export function isWithinWindow(date: Date, w: Window): boolean {
  const p = zonedParts(date, w.timezone);
  if (!w.sendDays.includes(p.wd)) return false;
  const minutes = p.h * 60 + p.mi;
  const s = hm(w.start);
  const e = hm(w.end);
  return minutes >= s.h * 60 + s.m && minutes < e.h * 60 + e.m;
}

/** The first moment at or after `from` that lies inside the sending window. */
export function nextWindowStart(from: Date, w: Window): Date {
  if (isWithinWindow(from, w)) return from;
  const s = hm(w.start);
  for (let i = 0; i < 15; i++) {
    const p = zonedParts(new Date(from.getTime() + i * 86_400_000), w.timezone);
    if (!w.sendDays.includes(p.wd)) continue;
    const start = fromZoned(p.y, p.m, p.d, s.h, s.m, w.timezone);
    if (start >= from) return start;
  }
  return new Date(from.getTime() + 86_400_000);
}

/**
 * Spread the initial sends over the window, honouring the daily limit and a
 * minimum gap, with a little jitter so messages don't look machine-timed.
 */
export function spreadSchedule(count: number, startAt: Date, w: Window, dailyLimit: number, minGapSeconds: number, rand: () => number = Math.random): Date[] {
  const out: Date[] = [];
  let cursor = nextWindowStart(startAt, w);
  let sentToday = 0;
  let day = zonedParts(cursor, w.timezone);
  for (let i = 0; i < count; i++) {
    const p = zonedParts(cursor, w.timezone);
    if (p.y !== day.y || p.m !== day.m || p.d !== day.d) {
      day = p;
      sentToday = 0;
    }
    if (sentToday >= dailyLimit || !isWithinWindow(cursor, w)) {
      // jump to the next day's window start
      const nextDay = new Date(fromZoned(p.y, p.m, p.d, 0, 0, w.timezone).getTime() + 86_400_000 + 3_600_000);
      cursor = nextWindowStart(nextDay, w);
      day = zonedParts(cursor, w.timezone);
      sentToday = 0;
    }
    out.push(cursor);
    sentToday++;
    const gap = Math.max(minGapSeconds, 60) * (1 + rand() * 1.5);
    cursor = new Date(cursor.getTime() + gap * 1000);
  }
  return out;
}

export function followUpTime(lastSent: Date, delayDays: number, w: Window, rand: () => number = Math.random): Date {
  const base = new Date(lastSent.getTime() + delayDays * 86_400_000 + Math.floor(rand() * 90) * 60_000);
  return nextWindowStart(base, w);
}
