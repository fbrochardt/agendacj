import "server-only";
import { DateTime } from "luxon";
import { googleToken } from "./calendars";
import { admin } from "./supabase/admin";
import type { CalendarConnection } from "./types";

const API = "https://www.googleapis.com/calendar/v3";

export type GoogleCalendarOption = { id: string; name: string; primary: boolean };

async function loadConnection(id: string): Promise<CalendarConnection | null> {
  const { data } = await admin().from("calendar_connections").select("*").eq("id", id).maybeSingle();
  return (data as CalendarConnection | null) ?? null;
}

async function call(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  if (res.status === 204) return { ok: true, status: 204, json: null as unknown };
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json: json as Record<string, unknown> };
}

function googleError(json: unknown, status: number): string {
  const msg = (json as { error?: { message?: string } })?.error?.message;
  return `Google Agenda: ${msg ?? `erro ${status}`}`;
}

/**
 * Agendas do Google em que a conta pode criar eventos.
 * Devolve `needsReconnect` quando a conexão foi feita antes da permissão de listar agendas.
 */
export async function listGoogleCalendars(
  connectionId: string,
): Promise<{ calendars: GoogleCalendarOption[]; needsReconnect: boolean; error: string | null }> {
  const conn = await loadConnection(connectionId);
  if (!conn || conn.provider !== "google") return { calendars: [], needsReconnect: false, error: "Conexão não encontrada." };
  try {
    const token = await googleToken(conn);
    const r = await call(token, "/users/me/calendarList?minAccessRole=writer&maxResults=250");
    if (!r.ok) {
      const insufficient = r.status === 403 && /insufficient|scope/i.test(JSON.stringify(r.json));
      return { calendars: [], needsReconnect: insufficient, error: insufficient ? null : googleError(r.json, r.status) };
    }
    const items = ((r.json as { items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean }[] }).items ?? []);
    const calendars = items
      .map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: Boolean(c.primary) }))
      .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name, "pt-BR"));
    return { calendars, needsReconnect: false, error: null };
  } catch (err) {
    return { calendars: [], needsReconnect: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type SyncRow = {
  id: string;
  agenda_id: string;
  title: string;
  start_at: string;
  end_at: string;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  notes: string | null;
  status: "confirmed" | "completed" | "cancelled";
  created_by: string | null;
  google_event_id: string | null;
  google_calendar_id: string | null;
  google_connection_id: string | null;
};

const enc = encodeURIComponent;

async function eventBody(a: SyncRow, agendaName: string) {
  let creator: string | null = null;
  if (a.created_by) {
    const p = await admin().from("profiles").select("name").eq("id", a.created_by).maybeSingle();
    creator = (p.data?.name as string | undefined) ?? null;
  }
  const done = a.status === "completed";
  const lines = [
    a.client_name && `Cliente: ${a.client_name}`,
    a.client_phone && `Telefone: ${a.client_phone}`,
    a.client_email && `E-mail: ${a.client_email}`,
    a.notes && `\nObservações:\n${a.notes}`,
    "",
    `Agenda: ${agendaName}`,
    creator && `Agendado por: ${creator}`,
    done ? "Situação: Concluído" : null,
    `\n${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/dashboard/agendas/${a.agenda_id}?dia=${DateTime.fromISO(a.start_at).toISODate()}`,
  ].filter((l): l is string => typeof l === "string");
  return {
    summary: `${done ? "✓ " : ""}${a.title}${a.client_name ? ` · ${a.client_name}` : ""}`,
    description: lines.join("\n"),
    start: { dateTime: a.start_at },
    end: { dateTime: a.end_at },
    // Verde ("manjericão") quando concluído; sem cor própria nos demais.
    ...(done ? { colorId: "10" } : {}),
    extendedProperties: { private: { agendacjId: a.id } },
  };
}

async function saveSync(id: string, patch: Record<string, unknown>) {
  const { error } = await admin().from("appointments").update(patch).eq("id", id);
  if (error) console.error("google sync save", error.message);
}

/** Remove o evento do Google ligado ao agendamento (se houver). Ignora evento já apagado. */
async function deleteEvent(a: SyncRow): Promise<string | null> {
  if (!a.google_event_id || !a.google_calendar_id || !a.google_connection_id) return null;
  const conn = await loadConnection(a.google_connection_id);
  if (!conn) return null;
  const token = await googleToken(conn);
  const r = await call(token, `/calendars/${enc(a.google_calendar_id)}/events/${enc(a.google_event_id)}?sendUpdates=none`, {
    method: "DELETE",
  });
  if (!r.ok && r.status !== 404 && r.status !== 410) return googleError(r.json, r.status);
  return null;
}

/**
 * Deixa o Google igual ao agendamento: cria, atualiza, move de agenda ou remove o evento.
 * Nunca lança erro: falhas ficam em `google_sync_error` e aparecem na tela da agenda.
 */
export async function syncAppointmentToGoogle(appointmentId: string): Promise<void> {
  try {
    const { data } = await admin().from("appointments").select("*").eq("id", appointmentId).maybeSingle();
    const a = data as SyncRow | null;
    if (!a) return;
    const ag = await admin()
      .from("agendas").select("name, google_connection_id, google_calendar_id").eq("id", a.agenda_id).maybeSingle();
    const target = ag.data as { name: string; google_connection_id: string | null; google_calendar_id: string | null } | null;
    const wantsEvent = a.status !== "cancelled" && Boolean(target?.google_connection_id && target?.google_calendar_id);

    // Cancelado, agenda sem ligação, ou ligação trocada: remove o evento antigo.
    const moved =
      a.google_event_id &&
      (a.google_calendar_id !== target?.google_calendar_id || a.google_connection_id !== target?.google_connection_id);
    if (a.google_event_id && (!wantsEvent || moved)) {
      const err = await deleteEvent(a);
      if (err) {
        await saveSync(a.id, { google_sync_error: err });
        return;
      }
      await saveSync(a.id, { google_event_id: null, google_calendar_id: null, google_connection_id: null, google_sync_error: null });
      a.google_event_id = null;
    }
    if (!wantsEvent) {
      if (a.status !== "cancelled") await saveSync(a.id, { google_sync_error: null });
      return;
    }

    const conn = await loadConnection(target!.google_connection_id!);
    if (!conn) {
      await saveSync(a.id, { google_sync_error: "A conta Google ligada a esta agenda foi desconectada." });
      return;
    }
    const token = await googleToken(conn);
    const body = await eventBody(a, target!.name);
    const cal = enc(target!.google_calendar_id!);

    let r = a.google_event_id
      ? await call(token, `/calendars/${cal}/events/${enc(a.google_event_id)}?sendUpdates=none`, {
          // PUT substitui o evento inteiro (assim a cor some ao retomar um concluído).
          method: "PUT",
          body: JSON.stringify(body),
        })
      : null;
    // Evento apagado direto no Google: cria de novo.
    if (!r || r.status === 404 || r.status === 410) {
      r = await call(token, `/calendars/${cal}/events?sendUpdates=none`, { method: "POST", body: JSON.stringify(body) });
    }
    if (!r.ok) {
      await saveSync(a.id, { google_sync_error: googleError(r.json, r.status) });
      return;
    }
    await saveSync(a.id, {
      google_event_id: (r.json as { id: string }).id,
      google_calendar_id: target!.google_calendar_id,
      google_connection_id: target!.google_connection_id,
      google_sync_error: null,
    });
  } catch (err) {
    await saveSync(appointmentId, { google_sync_error: `Google Agenda: ${err instanceof Error ? err.message : String(err)}` });
  }
}

/** Envia (ou move) para o Google os agendamentos de hoje em diante de uma agenda. */
export async function syncUpcomingForAgenda(agendaId: string): Promise<{ total: number; errors: number }> {
  const since = DateTime.now().startOf("day").toUTC().toISO()!;
  const { data } = await admin()
    .from("appointments").select("id").eq("agenda_id", agendaId)
    .in("status", ["confirmed", "completed"]).gte("start_at", since).order("start_at").limit(500);
  const ids = (data ?? []).map((r) => r.id as string);
  let errors = 0;
  // Poucos por vez, para não estourar o limite de requisições do Google.
  for (let i = 0; i < ids.length; i += 5) {
    await Promise.all(ids.slice(i, i + 5).map((id) => syncAppointmentToGoogle(id)));
  }
  if (ids.length) {
    const failed = await admin().from("appointments").select("id", { count: "exact", head: true })
      .in("id", ids).not("google_sync_error", "is", null);
    errors = failed.count ?? 0;
  }
  return { total: ids.length, errors };
}

/** Cria uma agenda nova na conta Google e devolve o ID dela. */
export async function createGoogleCalendar(
  connectionId: string,
  name: string,
  timeZone: string,
): Promise<{ id: string | null; error: string | null; needsReconnect: boolean }> {
  const conn = await loadConnection(connectionId);
  if (!conn || conn.provider !== "google") return { id: null, error: "Conta Google não encontrada.", needsReconnect: false };
  try {
    const token = await googleToken(conn);
    const r = await call(token, "/calendars", { method: "POST", body: JSON.stringify({ summary: name, timeZone }) });
    if (!r.ok) {
      const insufficient = r.status === 403 && /insufficient|scope/i.test(JSON.stringify(r.json));
      return { id: null, error: insufficient ? null : googleError(r.json, r.status), needsReconnect: insufficient };
    }
    return { id: (r.json as { id: string }).id, error: null, needsReconnect: false };
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : String(err), needsReconnect: false };
  }
}
