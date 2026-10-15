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

/** IDs das agendas atribuídas a um usuário (além das que ele é dono). */
async function assignedAgendaIds(userId: string): Promise<string[]> {
  const { data, error } = await admin().from("agenda_members").select("agenda_id").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.agenda_id as string);
}

/** Admins e SDRs acessam todas as agendas; os demais, só as de que são donos ou que foram atribuídas a eles. */
export function seesAllAgendas(viewer: Pick<Profile, "role" | "job">): boolean {
  return viewer.role === "admin" || viewer.job === "sdr";
}

/** Admin e SDR veem todas as agendas; os demais, as que são donos ou foram atribuídas a eles. */
export async function listAgendas(viewer: Profile): Promise<(Agenda & { owner: Owner | null })[]> {
  let q = admin().from("agendas").select("*").order("name");
  if (!seesAllAgendas(viewer)) {
    const ids = await assignedAgendaIds(viewer.id);
    q = ids.length ? q.or(`owner_id.eq.${viewer.id},id.in.(${ids.join(",")})`) : q.eq("owner_id", viewer.id);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const agendas = (data ?? []) as Agenda[];
  if (agendas.length === 0) return [];
  const ownerIds = [...new Set(agendas.map((a) => a.owner_id))];
  const owners = await admin().from("profiles").select("id, name, username, timezone").in("id", ownerIds);
  const byId = new Map(((owners.data ?? []) as Owner[]).map((o) => [o.id, o]));
  return agendas.map((a) => ({ ...a, owner: byId.get(a.owner_id) ?? null }));
}

/** Admin, SDR, dono ou pessoa atribuída podem acessar a agenda (ver, agendar, reagendar e cancelar). */
export async function canAccessAgenda(viewer: Profile, agenda: Pick<Agenda, "id" | "owner_id">): Promise<boolean> {
  if (seesAllAgendas(viewer) || agenda.owner_id === viewer.id) return true;
  const { data } = await admin()
    .from("agenda_members").select("agenda_id").eq("agenda_id", agenda.id).eq("user_id", viewer.id).maybeSingle();
  return Boolean(data);
}

/** Devolve a agenda se quem pede tiver acesso a ela; senão, null. */
export async function loadAgenda(viewer: Profile, id: string): Promise<{ agenda: Agenda; owner: Owner } | null> {
  if (!isUuid(id)) return null;
  const { data } = await admin().from("agendas").select("*").eq("id", id).maybeSingle();
  const agenda = data as Agenda | null;
  if (!agenda || !(await canAccessAgenda(viewer, agenda))) return null;
  const owner = await admin()
    .from("profiles").select("id, name, username, timezone").eq("id", agenda.owner_id).maybeSingle();
  if (!owner.data) return null;
  return { agenda, owner: owner.data as Owner };
}

export type AgendaMember = Pick<Profile, "id" | "name" | "email" | "role" | "job">;

/** Pessoas atribuídas a uma agenda. */
export async function listAgendaMembers(agendaId: string): Promise<AgendaMember[]> {
  const { data, error } = await admin().from("agenda_members").select("user_id").eq("agenda_id", agendaId);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((r) => r.user_id as string);
  if (ids.length === 0) return [];
  const people = await admin().from("profiles").select("id, name, email, role, job").in("id", ids).order("name");
  return (people.data ?? []) as AgendaMember[];
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

/** Agendamentos confirmados de todas as agendas internas de uma pessoa, com o nome da agenda. */
export async function ownerAppointments(
  ownerId: string,
  from: Date,
  to: Date,
): Promise<(Appointment & { agenda_name: string })[]> {
  const db = admin();
  const agendas = await db.from("agendas").select("id, name").eq("owner_id", ownerId);
  if (agendas.error) throw new Error(agendas.error.message);
  const names = new Map((agendas.data ?? []).map((a) => [a.id as string, a.name as string]));
  if (names.size === 0) return [];
  const { data, error } = await db
    .from("appointments").select("*").in("agenda_id", [...names.keys()]).eq("status", "confirmed")
    .lt("start_at", to.toISOString()).gt("end_at", from.toISOString()).order("start_at");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Appointment[]).map((a) => ({ ...a, agenda_name: names.get(a.agenda_id) ?? "Agenda" }));
}
