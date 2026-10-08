import "server-only";
import { decrypt, encrypt } from "../crypto";
import type { Busy } from "../slots";
import { admin } from "../supabase/admin";
import type { Booking, CalendarConnection } from "../types";
import { appleBusy, appleCreateEvent, appleDeleteEvent, type AppleSecret } from "./apple";
import { googleBusy, googleCreateEvent, googleDeleteEvent, googleRefresh, type GoogleSecret } from "./google";

async function connections(userId: string): Promise<CalendarConnection[]> {
  const { data, error } = await admin().from("calendar_connections").select("*").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []) as CalendarConnection[];
}

async function setError(id: string, message: string | null) {
  await admin().from("calendar_connections").update({ last_error: message }).eq("id", id);
}

/** Devolve um access token válido do Google, renovando e salvando se preciso. */
async function googleToken(conn: CalendarConnection): Promise<string> {
  let secret = JSON.parse(decrypt(conn.secret)) as GoogleSecret;
  if (secret.expires_at < Date.now() + 60_000) {
    secret = await googleRefresh(secret);
    await admin().from("calendar_connections").update({ secret: encrypt(JSON.stringify(secret)) }).eq("id", conn.id);
  }
  return secret.access_token;
}

function appleSecret(conn: CalendarConnection): AppleSecret {
  return JSON.parse(decrypt(conn.secret)) as AppleSecret;
}

/**
 * Períodos ocupados em todas as agendas conectadas.
 * Se uma agenda falhar, o erro fica registrado na conexão (aparece no painel)
 * e as demais continuam valendo.
 */
export async function externalBusy(userId: string, from: Date, to: Date, timezone: string): Promise<Busy[]> {
  const results = await Promise.all(
    (await connections(userId)).map(async (conn) => {
      try {
        const busy =
          conn.provider === "google"
            ? await googleBusy(await googleToken(conn), from, to)
            : await appleBusy(appleSecret(conn), conn.calendars, from, to, timezone);
        if (conn.last_error) await setError(conn.id, null);
        return busy;
      } catch (err) {
        await setError(conn.id, err instanceof Error ? err.message : String(err));
        return [];
      }
    }),
  );
  return results.flat();
}

export type EventInput = {
  bookingId: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  location?: string;
  guestName: string;
  guestEmail: string;
  wantMeet: boolean;
};

export type EventResult = {
  provider: string | null;
  connectionId: string | null;
  eventId: string | null;
  meetUrl: string | null;
  error: string | null;
};

/** Cria o evento na agenda de destino. Com Google Meet, o evento vai sempre para o Google. */
export async function createCalendarEvent(userId: string, e: EventInput): Promise<EventResult> {
  const empty: EventResult = { provider: null, connectionId: null, eventId: null, meetUrl: null, error: null };
  let conns: CalendarConnection[];
  try {
    conns = await connections(userId);
  } catch (err) {
    return { ...empty, error: String(err) };
  }
  if (conns.length === 0) {
    return { ...empty, error: e.wantMeet ? "Nenhuma agenda conectada: o link do Meet não foi gerado." : null };
  }
  const destination = conns.find((c) => c.is_destination) ?? conns[0];
  const google = destination.provider === "google" ? destination : conns.find((c) => c.provider === "google");
  const target = e.wantMeet && google ? google : destination;
  const base = { provider: target.provider, connectionId: target.id };

  try {
    if (target.provider === "google") {
      const created = await googleCreateEvent(await googleToken(target), { ...e, withMeet: e.wantMeet });
      return {
        ...empty, ...base, eventId: created.id, meetUrl: created.meetUrl,
        error: e.wantMeet && !created.meetUrl ? "O Google não gerou o link do Meet." : null,
      };
    }
    const calendarUrl = target.destination_calendar ?? target.calendars[0]?.url;
    if (!calendarUrl) throw new Error("Nenhuma agenda do iCloud disponível para gravar.");
    const url = await appleCreateEvent(appleSecret(target), calendarUrl, {
      uid: e.bookingId, start: e.start, end: e.end,
      summary: e.summary, description: e.description, location: e.location,
    });
    return {
      ...empty, ...base, eventId: url,
      error: e.wantMeet ? "Conecte uma conta Google para gerar links do Meet." : null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setError(target.id, message);
    return { ...empty, ...base, error: message };
  }
}

export async function deleteCalendarEvent(booking: Booking): Promise<void> {
  if (!booking.external_event_id || !booking.external_connection_id) return;
  const { data } = await admin()
    .from("calendar_connections").select("*").eq("id", booking.external_connection_id).maybeSingle();
  if (!data) return;
  const conn = data as CalendarConnection;
  if (conn.provider === "google") await googleDeleteEvent(await googleToken(conn), booking.external_event_id);
  else await appleDeleteEvent(appleSecret(conn), booking.external_event_id);
}
