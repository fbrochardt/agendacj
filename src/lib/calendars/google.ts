import "server-only";
import type { Busy } from "../slots";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

export type GoogleSecret = { access_token: string; refresh_token: string; expires_at: number };

function creds() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.");
  return { id, secret };
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleAuthUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: creds().id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(params: Record<string, string>) {
  const { id, secret } = creds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google: ${json.error_description ?? json.error ?? res.status}`);
  return json as { access_token: string; refresh_token?: string; expires_in: number };
}

export async function googleExchange(code: string, redirectUri: string) {
  const t = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!t.refresh_token) throw new Error("O Google não devolveu um token de renovação. Tente conectar de novo.");
  const me = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${t.access_token}` },
    cache: "no-store",
  }).then((r) => r.json());
  const secret: GoogleSecret = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + t.expires_in * 1000,
  };
  return { secret, email: String(me.email ?? "Conta Google") };
}

export async function googleRefresh(s: GoogleSecret): Promise<GoogleSecret> {
  const t = await tokenRequest({ refresh_token: s.refresh_token, grant_type: "refresh_token" });
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? s.refresh_token,
    expires_at: Date.now() + t.expires_in * 1000,
  };
}

async function call(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Agenda: ${json?.error?.message ?? res.status}`);
  return json;
}

export async function googleBusy(token: string, from: Date, to: Date): Promise<Busy[]> {
  const json = await call(token, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] }),
  });
  const cal = json?.calendars?.primary;
  if (cal?.errors?.length) throw new Error(`Google Agenda: ${cal.errors[0].reason}`);
  return (cal?.busy ?? []).map((b: { start: string; end: string }) => ({
    start: Date.parse(b.start),
    end: Date.parse(b.end),
  }));
}

export type NewEvent = {
  bookingId: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  location?: string;
  guestName: string;
  guestEmail: string;
  withMeet: boolean;
};

export async function googleCreateEvent(token: string, e: NewEvent) {
  const body: Record<string, unknown> = {
    summary: e.summary,
    description: e.description,
    start: { dateTime: e.start.toISOString() },
    end: { dateTime: e.end.toISOString() },
    attendees: [{ email: e.guestEmail, displayName: e.guestName }],
    reminders: { useDefault: true },
  };
  if (e.location) body.location = e.location;
  if (e.withMeet) {
    body.conferenceData = {
      createRequest: { requestId: e.bookingId, conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  }
  const json = await call(token, "/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const video = json?.conferenceData?.entryPoints?.find((p: { entryPointType: string }) => p.entryPointType === "video");
  return { id: String(json.id), meetUrl: (json.hangoutLink ?? video?.uri ?? null) as string | null };
}

export async function googleDeleteEvent(token: string, eventId: string) {
  try {
    await call(token, `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: "DELETE" });
  } catch (err) {
    // Já removido na agenda: tudo certo.
    if (!/410|404|deleted|Not Found/i.test(String(err))) throw err;
  }
}
