import "server-only";
import { DAVClient } from "tsdav";
import type { Busy } from "../slots";
import type { CalendarRef } from "../types";
import { buildIcs, parseBusy, type IcsEvent } from "./ics";

const SERVER = "https://caldav.icloud.com";

/** Apple ID + senha de app (gerada em account.apple.com). */
export type AppleSecret = { username: string; password: string };

async function connect(s: AppleSecret): Promise<DAVClient> {
  const client = new DAVClient({
    serverUrl: SERVER,
    credentials: { username: s.username, password: s.password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
  await client.login();
  return client;
}

export async function appleListCalendars(s: AppleSecret): Promise<CalendarRef[]> {
  const client = await connect(s);
  const calendars = await client.fetchCalendars();
  return calendars
    .filter((c) => !c.components || c.components.includes("VEVENT"))
    .map((c) => ({ url: c.url, name: typeof c.displayName === "string" && c.displayName ? c.displayName : "Agenda" }));
}

export async function appleBusy(
  s: AppleSecret,
  calendars: CalendarRef[],
  from: Date,
  to: Date,
  fallbackZone: string,
): Promise<Busy[]> {
  const client = await connect(s);
  const out: Busy[] = [];
  for (const cal of calendars) {
    const objects = await client.fetchCalendarObjects({
      calendar: { url: cal.url },
      timeRange: { start: from.toISOString(), end: to.toISOString() },
    });
    for (const o of objects) {
      if (typeof o.data === "string") out.push(...parseBusy(o.data, from, to, fallbackZone));
    }
  }
  return out;
}

export async function appleCreateEvent(s: AppleSecret, calendarUrl: string, e: IcsEvent): Promise<string> {
  const client = await connect(s);
  const filename = `${e.uid}.ics`;
  const res = await client.createCalendarObject({
    calendar: { url: calendarUrl },
    filename,
    iCalString: buildIcs(e),
  });
  if (!res.ok) throw new Error(`iCloud recusou o evento (${res.status}).`);
  return new URL(filename, calendarUrl.endsWith("/") ? calendarUrl : calendarUrl + "/").href;
}

export async function appleDeleteEvent(s: AppleSecret, objectUrl: string): Promise<void> {
  const client = await connect(s);
  const res = await client.deleteCalendarObject({ calendarObject: { url: objectUrl, etag: "" } });
  if (!res.ok && res.status !== 404) throw new Error(`iCloud não removeu o evento (${res.status}).`);
}
