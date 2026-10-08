import "server-only";
import { ownerBusy } from "./agendas";
import { deleteCalendarEvent, externalBusy } from "./calendars";
import { computeSlots, type Busy } from "./slots";
import { admin } from "./supabase/admin";
import type { AvailabilityRule, Booking, EventType, Profile } from "./types";

export type PublicHost = Pick<Profile, "id" | "name" | "username" | "timezone">;

export async function loadHost(username: string): Promise<PublicHost | null> {
  const { data } = await admin()
    .from("profiles").select("id, name, username, timezone").eq("username", username.toLowerCase()).maybeSingle();
  return (data as PublicHost | null) ?? null;
}

export async function loadEventType(username: string, slug: string) {
  const host = await loadHost(username);
  if (!host) return null;
  const { data } = await admin()
    .from("event_types").select("*").eq("user_id", host.id).eq("slug", slug).eq("active", true).maybeSingle();
  if (!data) return null;
  return { host, eventType: data as EventType };
}

/** Horários livres de um tipo de evento em [from, to), já descontando agendas e reservas. */
export async function availableSlots(host: PublicHost, et: EventType, from: Date, to: Date): Promise<string[]> {
  const db = admin();
  const pad = (et.buffer_min + 1) * 60_000;
  const busyFrom = new Date(from.getTime() - pad - 86_400_000);
  const busyTo = new Date(to.getTime() + pad + 86_400_000);

  const [rules, booked, external, internal] = await Promise.all([
    db.from("availability").select("weekday, start_time, end_time").eq("user_id", host.id),
    db.from("bookings").select("start_at, end_at").eq("user_id", host.id).eq("status", "confirmed")
      .lt("start_at", busyTo.toISOString()).gt("end_at", busyFrom.toISOString()),
    externalBusy(host.id, busyFrom, busyTo, host.timezone),
    // Agendas internas em que a pessoa é dona também ocupam o horário dela.
    ownerBusy(host.id, busyFrom, busyTo),
  ]);
  if (rules.error) throw new Error(rules.error.message);
  if (booked.error) throw new Error(booked.error.message);

  const busy: Busy[] = [
    ...external,
    ...internal,
    ...(booked.data ?? []).map((b) => ({ start: Date.parse(b.start_at), end: Date.parse(b.end_at) })),
  ];
  return computeSlots({
    rules: (rules.data ?? []) as AvailabilityRule[],
    timezone: host.timezone,
    from, to, busy,
    durationMin: et.duration_min,
    bufferMin: et.buffer_min,
    minNoticeMin: et.min_notice_min,
    windowDays: et.window_days,
  });
}

/** Cancela a reserva e remove o evento da agenda. Devolve um aviso se a agenda não respondeu. */
export async function cancelBooking(booking: Booking): Promise<string | null> {
  if (booking.status === "cancelled") return null;
  let warning: string | null = null;
  try {
    await deleteCalendarEvent(booking);
  } catch (err) {
    warning = err instanceof Error ? err.message : String(err);
  }
  const { error } = await admin()
    .from("bookings")
    .update({ status: "cancelled", calendar_error: warning ? `Evento não removido da agenda: ${warning}` : null })
    .eq("id", booking.id);
  if (error) throw new Error(error.message);
  return warning;
}
