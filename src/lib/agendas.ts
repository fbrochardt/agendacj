import "server-only";
import { admin } from "./supabase/admin";
import type { Profile } from "./types";

export type Agenda = {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  created_at: string;
};

export type Appointment = {
  id: string;
  agenda_id: string;
  title: string;
  start_at: string;
  end_at: string;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  notes: string | null;
  status: "confirmed" | "cancelled";
};

export type Owner = Pick<Profile, "id" | "name" | "username" | "timezone">;

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Admin vê todas as agendas; os demais, só as que são deles. */
export async function listAgendas(viewer: Profile): Promise<(Agenda & { owner: Owner | null })[]> {
  let q = admin().from("agendas").select("*").order("name");
  if (viewer.role !== "admin") q = q.eq("owner_id", viewer.id);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const agendas = (data ?? []) as Agenda[];
  if (agendas.length === 0) return [];
  const ids = [...new Set(agendas.map((a) => a.owner_id))];
  const owners = await admin().from("profiles").select("id, name, username, timezone").in("id", ids);
  const byId = new Map(((owners.data ?? []) as Owner[]).map((o) => [o.id, o]));
  return agendas.map((a) => ({ ...a, owner: byId.get(a.owner_id) ?? null }));
}

/** Devolve a agenda se quem pede for admin ou o dono; senão, null. */
export async function loadAgenda(viewer: Profile, id: string): Promise<{ agenda: Agenda; owner: Owner } | null> {
  if (!isUuid(id)) return null;
  const { data } = await admin().from("agendas").select("*").eq("id", id).maybeSingle();
  const agenda = data as Agenda | null;
  if (!agenda) return null;
  if (viewer.role !== "admin" && agenda.owner_id !== viewer.id) return null;
  const owner = await admin()
    .from("profiles").select("id, name, username, timezone").eq("id", agenda.owner_id).maybeSingle();
  if (!owner.data) return null;
  return { agenda, owner: owner.data as Owner };
}

export async function listAppointments(agendaId: string, from: Date, to: Date): Promise<Appointment[]> {
  const { data, error } = await admin()
    .from("appointments").select("*").eq("agenda_id", agendaId).eq("status", "confirmed")
    .lt("start_at", to.toISOString()).gt("end_at", from.toISOString()).order("start_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Appointment[];
}

/** Compromissos das agendas internas de uma pessoa, para bloquear a página pública dela. */
export async function ownerBusy(ownerId: string, from: Date, to: Date) {
  const db = admin();
  const agendas = await db.from("agendas").select("id").eq("owner_id", ownerId);
  if (agendas.error) throw new Error(agendas.error.message);
  const ids = (agendas.data ?? []).map((a) => a.id as string);
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("appointments").select("start_at, end_at").in("agenda_id", ids).eq("status", "confirmed")
    .lt("start_at", to.toISOString()).gt("end_at", from.toISOString());
  if (error) throw new Error(error.message);
  return (data ?? []).map((a) => ({ start: Date.parse(a.start_at), end: Date.parse(a.end_at) }));
}
