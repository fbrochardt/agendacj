import ICAL from "ical.js";
import { DateTime, IANAZone } from "luxon";
import type { Busy } from "../slots";

function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, "utf8") > 74) {
    let cut = 74;
    while (Buffer.byteLength(rest.slice(0, cut), "utf8") > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out.join("\r\n");
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export type IcsEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
};

/** Gera um arquivo .ics com um único evento. */
export function buildIcs(e: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Agenda//PT-BR",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.end)}`,
    `SUMMARY:${esc(e.summary)}`,
    e.description ? `DESCRIPTION:${esc(e.description)}` : null,
    e.location ? `LOCATION:${esc(e.location)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => l !== null);
  return lines.map(fold).join("\r\n") + "\r\n";
}

function toMs(t: ICAL.Time, tzid: string | null, fallbackZone: string): number {
  const zoneId = t.zone?.tzid;
  if (!t.isDate && zoneId && zoneId !== "floating") return t.toJSDate().getTime();
  // Dia inteiro, horário "flutuante" ou fuso sem definição no arquivo.
  const zone = tzid && IANAZone.isValidZone(tzid) ? tzid : fallbackZone;
  return DateTime.fromObject(
    { year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second },
    { zone },
  ).toMillis();
}

function ignored(c: ICAL.Component): boolean {
  const transp = String(c.getFirstPropertyValue("transp") ?? "").toUpperCase();
  const status = String(c.getFirstPropertyValue("status") ?? "").toUpperCase();
  return transp === "TRANSPARENT" || status === "CANCELLED";
}

function tzidOf(c: ICAL.Component): string | null {
  const p = c.getFirstProperty("dtstart")?.getParameter("tzid");
  return typeof p === "string" ? p : null;
}

/**
 * Extrai os períodos ocupados de um .ics dentro de [from, to), expandindo
 * eventos recorrentes e respeitando exceções.
 */
export function parseBusy(ics: string, from: Date, to: Date, fallbackZone: string): Busy[] {
  const out: Busy[] = [];
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(ics));
  } catch {
    return out;
  }
  for (const tz of root.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      /* fuso inválido: cai no fallback */
    }
  }

  const fromMs = from.getTime();
  const toMsLimit = to.getTime();
  const add = (s: number, e: number) => {
    if (e > fromMs && s < toMsLimit && e > s) out.push({ start: s, end: e });
  };

  const vevents = root.getAllSubcomponents("vevent");
  const masters = vevents.filter((v) => !v.hasProperty("recurrence-id"));
  const exceptions = vevents.filter((v) => v.hasProperty("recurrence-id"));
  const masterUids = new Set(masters.map((m) => String(m.getFirstPropertyValue("uid"))));

  for (const v of masters) {
    const uid = String(v.getFirstPropertyValue("uid"));
    const ev = new ICAL.Event(v, {
      exceptions: exceptions.filter((x) => String(x.getFirstPropertyValue("uid")) === uid),
    });
    const tzid = tzidOf(v);
    if (!ev.isRecurring()) {
      if (!ignored(v)) add(toMs(ev.startDate, tzid, fallbackZone), toMs(ev.endDate, tzid, fallbackZone));
      continue;
    }
    const it = ev.iterator();
    for (let i = 0; i < 20000; i++) {
      const next = it.next();
      if (!next) break;
      const d = ev.getOccurrenceDetails(next);
      const comp = d.item.component;
      const occTz = tzidOf(comp) ?? tzid;
      const s = toMs(d.startDate, occTz, fallbackZone);
      if (toMs(next, tzid, fallbackZone) >= toMsLimit && s >= toMsLimit) break;
      if (!ignored(comp)) add(s, toMs(d.endDate, occTz, fallbackZone));
    }
  }

  // Exceções cujo evento principal não veio no mesmo arquivo.
  for (const x of exceptions) {
    if (masterUids.has(String(x.getFirstPropertyValue("uid"))) || ignored(x)) continue;
    const ev = new ICAL.Event(x);
    const tzid = tzidOf(x);
    add(toMs(ev.startDate, tzid, fallbackZone), toMs(ev.endDate, tzid, fallbackZone));
  }
  return out;
}
