import "server-only";
import { DateTime } from "luxon";
import type { ActivityAction } from "./activity";
import { isUuid, type Appointment } from "./agendas";
import { admin } from "./supabase/admin";
import type { Job } from "./types";

export type ReportFilters = {
  from: DateTime; // início do dia, no fuso de quem consulta
  to: DateTime; // fim do período (exclusivo)
  agendaId: string | null;
  personId: string | null; // quem agendou
  fromStr: string;
  toStr: string;
};

export function parseFilters(
  sp: { de?: string; ate?: string; agenda?: string; pessoa?: string },
  zone: string,
): ReportFilters {
  const today = DateTime.now().setZone(zone).startOf("day");
  const parse = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? DateTime.fromISO(v, { zone }) : null);
  let from = parse(sp.de) ?? today.startOf("month");
  let toDay = parse(sp.ate) ?? today.endOf("month").startOf("day");
  if (!from.isValid) from = today.startOf("month");
  if (!toDay.isValid || toDay < from) toDay = from;
  // Limite de 1 ano por consulta.
  if (toDay.diff(from, "days").days > 366) toDay = from.plus({ days: 366 });
  return {
    from,
    to: toDay.plus({ days: 1 }),
    agendaId: sp.agenda && isUuid(sp.agenda) ? sp.agenda : null,
    personId: sp.pessoa && isUuid(sp.pessoa) ? sp.pessoa : null,
    fromStr: from.toISODate()!,
    toStr: toDay.toISODate()!,
  };
}

export type Person = { id: string; name: string; job: Job | null; role: "admin" | "member" };
export type AgendaInfo = { id: string; name: string; owner_id: string };

/** Situação de um agendamento para o relatório. */
export type Outcome = "completed" | "cancelled" | "upcoming" | "no_outcome";

export const OUTCOME_LABELS: Record<Outcome, string> = {
  completed: "Concluído",
  cancelled: "Cancelado",
  upcoming: "Pendente",
  no_outcome: "Sem desfecho",
};

export function outcomeOf(a: Pick<Appointment, "status" | "end_at">, nowMs: number): Outcome {
  if (a.status === "completed") return "completed";
  if (a.status === "cancelled") return "cancelled";
  return Date.parse(a.end_at) < nowMs ? "no_outcome" : "upcoming";
}

export type Tally = { total: number; completed: number; cancelled: number; upcoming: number; no_outcome: number };
const emptyTally = (): Tally => ({ total: 0, completed: 0, cancelled: 0, upcoming: 0, no_outcome: 0 });

export type ActivityRow = {
  id: number;
  created_at: string;
  action: ActivityAction;
  actor_id: string | null;
  agenda_id: string;
  appointment_id: string;
  details: { de?: string; para?: string } | null;
  appointment: Pick<Appointment, "title" | "client_name"> | null;
};

export async function loadReport(f: ReportFilters) {
  const db = admin();
  const nowMs = Date.now();

  let q = db
    .from("appointments")
    .select("*")
    .gte("start_at", f.from.toUTC().toISO()!)
    .lt("start_at", f.to.toUTC().toISO()!)
    .order("start_at")
    .limit(10000);
  if (f.agendaId) q = q.eq("agenda_id", f.agendaId);
  if (f.personId) q = q.eq("created_by", f.personId);

  let ev = db
    .from("appointment_events")
    .select("id, created_at, action, actor_id, agenda_id, appointment_id, details")
    .gte("created_at", f.from.toUTC().toISO()!)
    .lt("created_at", f.to.toUTC().toISO()!)
    .order("created_at", { ascending: false })
    .limit(300);
  if (f.agendaId) ev = ev.eq("agenda_id", f.agendaId);
  if (f.personId) ev = ev.eq("actor_id", f.personId);

  const [appts, events, agendas, people] = await Promise.all([
    q,
    ev,
    db.from("agendas").select("id, name, owner_id").order("name"),
    db.from("profiles").select("id, name, job, role").order("name"),
  ]);
  if (appts.error) throw new Error(appts.error.message);
  if (events.error) throw new Error(events.error.message);

  const items = (appts.data ?? []) as Appointment[];
  const agendaList = (agendas.data ?? []) as AgendaInfo[];
  const personList = (people.data ?? []) as Person[];
  const agendaById = new Map(agendaList.map((a) => [a.id, a]));
  const personById = new Map(personList.map((p) => [p.id, p]));

  const totals = emptyTally();
  const byAgenda = new Map<string, Tally>();
  const byPerson = new Map<string, Tally>();
  const byDay = new Map<string, Tally>();
  const zone = f.from.zoneName!;

  const add = (map: Map<string, Tally>, key: string, o: Outcome) => {
    const t = map.get(key) ?? emptyTally();
    t.total++;
    t[o]++;
    map.set(key, t);
  };

  for (const a of items) {
    const o = outcomeOf(a, nowMs);
    totals.total++;
    totals[o]++;
    add(byAgenda, a.agenda_id, o);
    add(byPerson, a.created_by ?? "-", o);
    add(byDay, DateTime.fromISO(a.start_at, { zone }).toISODate()!, o);
  }

  // Dados do agendamento de cada atividade (título e cliente), inclusive fora do período.
  const evRows = (events.data ?? []) as Omit<ActivityRow, "appointment">[];
  const missing = [...new Set(evRows.map((e) => e.appointment_id))].filter((id) => !items.some((a) => a.id === id));
  const extra = new Map<string, Pick<Appointment, "title" | "client_name">>();
  if (missing.length) {
    const r = await db.from("appointments").select("id, title, client_name").in("id", missing.slice(0, 300));
    for (const a of r.data ?? []) extra.set(a.id as string, { title: a.title as string, client_name: a.client_name as string | null });
  }
  const apptById = new Map(items.map((a) => [a.id, a]));
  const activity: ActivityRow[] = evRows.map((e) => ({
    ...e,
    appointment: apptById.get(e.appointment_id) ?? extra.get(e.appointment_id) ?? null,
  }));

  return { items, totals, byAgenda, byPerson, byDay, activity, agendaList, personList, agendaById, personById };
}

export function rate(part: number, total: number): string {
  if (!total) return "—";
  return `${Math.round((part / total) * 100)}%`;
}
