import { DateTime } from "luxon";

export type Rule = { weekday: number; start_time: string; end_time: string };
export type Busy = { start: number; end: number };

export type SlotOptions = {
  rules: Rule[];
  /** Fuso de quem atende: as regras de disponibilidade são interpretadas nele. */
  timezone: string;
  from: Date;
  to: Date;
  durationMin: number;
  bufferMin?: number;
  minNoticeMin?: number;
  windowDays?: number;
  busy?: Busy[];
  now?: Date;
  stepMin?: number;
};

const MIN = 60_000;

function hm(t: string): { hour: number; minute: number } {
  const [h, m] = t.split(":");
  return { hour: Number(h), minute: Number(m) };
}

/** Devolve os inícios de horário livres (ISO em UTC) dentro de [from, to). */
export function computeSlots(o: SlotOptions): string[] {
  const now = (o.now ?? new Date()).getTime();
  const buffer = (o.bufferMin ?? 0) * MIN;
  const duration = o.durationMin * MIN;
  const step = o.stepMin ?? Math.min(o.durationMin, 30);
  const busy = o.busy ?? [];

  const earliest = Math.max(o.from.getTime(), now + (o.minNoticeMin ?? 0) * MIN);
  const latest = Math.min(o.to.getTime(), now + (o.windowDays ?? 60) * 24 * 60 * MIN);
  if (earliest >= latest || step <= 0 || duration <= 0) return [];

  const out = new Set<number>();
  let day = DateTime.fromMillis(earliest, { zone: o.timezone }).startOf("day");
  const lastDay = DateTime.fromMillis(latest, { zone: o.timezone }).startOf("day");

  while (day <= lastDay) {
    const weekday = day.weekday % 7; // luxon: 1 = segunda ... 7 = domingo
    for (const rule of o.rules) {
      if (rule.weekday !== weekday) continue;
      const end = day.set({ ...hm(rule.end_time), second: 0, millisecond: 0 }).toMillis();
      let cursor = day.set({ ...hm(rule.start_time), second: 0, millisecond: 0 });
      while (cursor.toMillis() + duration <= end) {
        const s = cursor.toMillis();
        const e = s + duration;
        const free = !busy.some((b) => b.start < e + buffer && b.end > s - buffer);
        if (s >= earliest && s < latest && free) out.add(s);
        cursor = cursor.plus({ minutes: step });
      }
    }
    day = day.plus({ days: 1 });
  }

  return [...out].sort((a, b) => a - b).map((ms) => new Date(ms).toISOString());
}
