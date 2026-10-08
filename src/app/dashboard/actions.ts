"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { IANAZone } from "luxon";
import { requireAdmin, requireUser } from "@/lib/auth";
import { cancelBooking } from "@/lib/booking";
import { appleListCalendars } from "@/lib/calendars/apple";
import { encrypt } from "@/lib/crypto";
import { admin } from "@/lib/supabase/admin";
import type { Booking, CalendarConnection, LocationType } from "@/lib/types";
import { createUser, validateUsername } from "@/lib/users";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string, min: number, max: number, fallback: number) => {
  const v = Number(fd.get(k));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
};
const go = (path: string, key: "ok" | "error", msg: string): never =>
  redirect(`${path}?${key}=${encodeURIComponent(msg)}`);

export async function signOut() {
  const { supabase } = await requireUser();
  await supabase.auth.signOut();
  redirect("/login");
}

// ---------- Perfil ----------

export async function saveProfile(fd: FormData) {
  const { profile } = await requireUser();
  const path = "/dashboard/settings";
  const name = s(fd, "name");
  const username = s(fd, "username").toLowerCase();
  const timezone = s(fd, "timezone");
  if (!name) go(path, "error", "Informe seu nome.");
  const bad = validateUsername(username);
  if (bad) go(path, "error", bad);
  if (!IANAZone.isValidZone(timezone)) go(path, "error", "Fuso horário inválido.");
  const { error } = await admin().from("profiles").update({ name, username, timezone }).eq("id", profile.id);
  if (error) go(path, "error", error.code === "23505" ? "Esse endereço já está em uso." : error.message);
  revalidatePath("/dashboard", "layout");
  go(path, "ok", "Perfil salvo.");
}

export async function changePassword(fd: FormData) {
  const { supabase } = await requireUser();
  const path = "/dashboard/settings";
  const password = String(fd.get("password") ?? "");
  if (password.length < 8) go(path, "error", "A senha precisa ter pelo menos 8 caracteres.");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) go(path, "error", error.message);
  go(path, "ok", "Senha alterada.");
}

// ---------- Tipos de evento ----------

function slugify(text: string): string {
  return text
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function eventTypeFields(fd: FormData) {
  const title = s(fd, "title");
  const location_type = (["google_meet", "in_person", "phone", "custom"].includes(s(fd, "location_type"))
    ? s(fd, "location_type")
    : "google_meet") as LocationType;
  return {
    title,
    slug: slugify(s(fd, "slug") || title),
    description: s(fd, "description") || null,
    duration_min: n(fd, "duration_min", 5, 480, 30),
    buffer_min: n(fd, "buffer_min", 0, 240, 0),
    min_notice_min: n(fd, "min_notice_hours", 0, 720, 2) * 60,
    window_days: n(fd, "window_days", 1, 365, 60),
    location_type,
    location_value: location_type === "google_meet" ? null : s(fd, "location_value") || null,
    active: fd.get("active") === "on",
  };
}

export async function saveEventType(fd: FormData) {
  const { supabase, profile } = await requireUser();
  const id = s(fd, "id");
  const path = id ? `/dashboard/event-types/${id}` : "/dashboard/event-types/new";
  const fields = eventTypeFields(fd);
  if (!fields.title || !fields.slug) go(path, "error", "Informe um título e um endereço válidos.");
  const res = id
    ? await supabase.from("event_types").update(fields).eq("id", id)
    : await supabase.from("event_types").insert({ ...fields, user_id: profile.id });
  if (res.error) {
    go(path, "error", res.error.code === "23505" ? "Você já tem um evento com esse endereço." : res.error.message);
  }
  revalidatePath("/dashboard/event-types");
  go("/dashboard/event-types", "ok", "Tipo de evento salvo.");
}

export async function deleteEventType(fd: FormData) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("event_types").delete().eq("id", s(fd, "id"));
  if (error) go("/dashboard/event-types", "error", error.message);
  revalidatePath("/dashboard/event-types");
  go("/dashboard/event-types", "ok", "Tipo de evento excluído.");
}

// ---------- Disponibilidade ----------

export async function saveAvailability(fd: FormData) {
  const { supabase, profile } = await requireUser();
  const path = "/dashboard/availability";
  const rows: { user_id: string; weekday: number; start_time: string; end_time: string }[] = [];
  for (let d = 0; d < 7; d++) {
    if (fd.get(`on_${d}`) !== "on") continue;
    for (const part of ["a", "b"]) {
      const start = s(fd, `start_${d}_${part}`);
      const end = s(fd, `end_${d}_${part}`);
      if (!start && !end) continue;
      if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || end <= start) {
        go(path, "error", "Confira os horários: o fim precisa ser depois do início.");
      }
      rows.push({ user_id: profile.id, weekday: d, start_time: start, end_time: end });
    }
  }
  const del = await supabase.from("availability").delete().eq("user_id", profile.id);
  if (del.error) go(path, "error", del.error.message);
  if (rows.length) {
    const ins = await supabase.from("availability").insert(rows);
    if (ins.error) go(path, "error", ins.error.message);
  }
  go(path, "ok", "Disponibilidade salva.");
}

// ---------- Agendas ----------

const CAL = "/dashboard/calendars";

export async function connectApple(fd: FormData) {
  const { profile } = await requireUser();
  const username = s(fd, "apple_id").toLowerCase();
  const password = s(fd, "app_password").replace(/\s/g, "");
  if (!username || !password) go(CAL, "error", "Informe o Apple ID e a senha de app.");

  let calendars;
  try {
    calendars = await appleListCalendars({ username, password });
  } catch {
    go(CAL, "error", "O iCloud recusou o acesso. Confira o Apple ID e gere uma nova senha de app.");
  }
  if (!calendars || calendars.length === 0) go(CAL, "error", "Nenhuma agenda encontrada nessa conta do iCloud.");

  const db = admin();
  const existing = await db.from("calendar_connections").select("is_destination").eq("user_id", profile.id);
  const hasDestination = (existing.data ?? []).some((c) => c.is_destination);
  const { error } = await db.from("calendar_connections").upsert(
    {
      user_id: profile.id,
      provider: "apple",
      account: username,
      secret: encrypt(JSON.stringify({ username, password })),
      calendars,
      destination_calendar: calendars![0].url,
      last_error: null,
      ...(hasDestination ? {} : { is_destination: true }),
    },
    { onConflict: "user_id,provider,account" },
  );
  if (error) go(CAL, "error", error.message);
  go(CAL, "ok", `Agenda da Apple conectada (${calendars!.length} agenda(s)).`);
}

async function ownConnection(userId: string, id: string): Promise<CalendarConnection> {
  const { data } = await admin()
    .from("calendar_connections").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!data) go(CAL, "error", "Conexão não encontrada.");
  return data as CalendarConnection;
}

export async function disconnectCalendar(fd: FormData) {
  const { profile } = await requireUser();
  const conn = await ownConnection(profile.id, s(fd, "id"));
  const db = admin();
  await db.from("calendar_connections").delete().eq("id", conn.id);
  if (conn.is_destination) {
    const next = await db.from("calendar_connections").select("id").eq("user_id", profile.id).limit(1);
    if (next.data?.[0]) await db.from("calendar_connections").update({ is_destination: true }).eq("id", next.data[0].id);
  }
  go(CAL, "ok", "Agenda desconectada.");
}

export async function setDestination(fd: FormData) {
  const { profile } = await requireUser();
  const conn = await ownConnection(profile.id, s(fd, "id"));
  const db = admin();
  await db.from("calendar_connections").update({ is_destination: false }).eq("user_id", profile.id);
  const patch: Record<string, unknown> = { is_destination: true };
  const calendar = s(fd, "calendar");
  if (conn.provider === "apple" && conn.calendars.some((c) => c.url === calendar)) patch.destination_calendar = calendar;
  await db.from("calendar_connections").update(patch).eq("id", conn.id);
  go(CAL, "ok", "Agenda de destino atualizada.");
}

// ---------- Agendamentos ----------

export async function cancelAsHost(fd: FormData) {
  const { profile } = await requireUser();
  const { data } = await admin()
    .from("bookings").select("*").eq("id", s(fd, "id")).eq("user_id", profile.id).maybeSingle();
  if (!data) go("/dashboard", "error", "Agendamento não encontrado.");
  const warning = await cancelBooking(data as Booking);
  revalidatePath("/dashboard");
  if (warning) go("/dashboard", "error", `Cancelado, mas o evento não foi removido da agenda: ${warning}`);
  go("/dashboard", "ok", "Agendamento cancelado.");
}

// ---------- Equipe (somente admin) ----------

const TEAM = "/dashboard/team";

export async function addMember(fd: FormData) {
  await requireAdmin();
  const { error } = await createUser({
    name: s(fd, "name"),
    email: s(fd, "email"),
    username: s(fd, "username"),
    password: String(fd.get("password") ?? ""),
    role: s(fd, "role") === "admin" ? "admin" : "member",
    timezone: s(fd, "timezone"),
  });
  if (error) go(TEAM, "error", error);
  revalidatePath(TEAM);
  go(TEAM, "ok", "Usuário criado. Envie a ele o e-mail e a senha provisória.");
}

export async function setRole(fd: FormData) {
  const { profile } = await requireAdmin();
  const id = s(fd, "id");
  const role = s(fd, "role") === "admin" ? "admin" : "member";
  if (id === profile.id) go(TEAM, "error", "Você não pode alterar o seu próprio papel.");
  const { error } = await admin().from("profiles").update({ role }).eq("id", id);
  if (error) go(TEAM, "error", error.message);
  revalidatePath(TEAM);
  go(TEAM, "ok", "Papel atualizado.");
}

export async function removeMember(fd: FormData) {
  const { profile } = await requireAdmin();
  const id = s(fd, "id");
  if (id === profile.id) go(TEAM, "error", "Você não pode remover a si mesmo.");
  const { error } = await admin().auth.admin.deleteUser(id);
  if (error) go(TEAM, "error", error.message);
  revalidatePath(TEAM);
  go(TEAM, "ok", "Usuário removido.");
}
