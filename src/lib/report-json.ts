import "server-only";
import { DateTime } from "luxon";
import { ACTION_LABELS } from "./activity";
import { loadReport, OUTCOME_LABELS, outcomeOf, type ReportFilters, type Tally } from "./reports";

const tally = (t: Tally, criados?: number) => ({
  ...(criados !== undefined ? { criados } : {}),
  agendados: t.total,
  concluidos: t.completed,
  cancelados: t.cancelled,
  sem_desfecho: t.no_outcome,
  pendentes: t.upcoming,
  taxa_conclusao: t.total - t.upcoming ? Math.round((t.completed / (t.total - t.upcoming)) * 1000) / 1000 : null,
});

/** Relatório em formato JSON (usado pela API e pelo PDF). */
export function buildReportJson(r: Awaited<ReturnType<typeof loadReport>>, f: ReportFilters, zone: string) {
  const now = Date.now();
  const person = (id: string | null) => (id ? (r.personById.get(id)?.name ?? "Usuário removido") : null);
  const iso = (v: string | null) => (v ? DateTime.fromISO(v, { zone }).toISO() : null);
  const zero: Tally = { total: 0, completed: 0, cancelled: 0, upcoming: 0, no_outcome: 0 };

  return {
    periodo: { de: f.fromStr, ate: f.toStr, fuso: zone },
    filtros: { agenda: f.agendaId, pessoa: f.personId },
    gerado_em: DateTime.now().setZone(zone).toISO(),
    totais: tally(r.totals, r.createdTotal),
    por_agenda: [...new Set([...r.byAgenda.keys(), ...r.createdByAgenda.keys()])].map((id) => {
      const ag = r.agendaById.get(id);
      return {
        agenda_id: id,
        agenda: ag?.name ?? "Agenda removida",
        dono: ag ? person(ag.owner_id) : null,
        ...tally(r.byAgenda.get(id) ?? zero, r.createdByAgenda.get(id) ?? 0),
      };
    }),
    por_pessoa: [...new Set([...r.byPerson.keys(), ...r.createdByPerson.keys()])].map((id) => {
      const p = id === "-" ? null : r.personById.get(id);
      return {
        pessoa_id: id === "-" ? null : id,
        pessoa: id === "-" ? null : (p?.name ?? "Usuário removido"),
        funcao: p?.job ?? null,
        ...tally(r.byPerson.get(id) ?? zero, r.createdByPerson.get(id) ?? 0),
      };
    }),
    por_dia: [...r.byDay].sort(([a], [b]) => a.localeCompare(b)).map(([dia, t]) => ({ dia, ...tally(t) })),
    agendamentos: r.items.map((a) => {
      const ag = r.agendaById.get(a.agenda_id);
      const o = outcomeOf(a, now);
      return {
        id: a.id,
        inicio: iso(a.start_at),
        fim: iso(a.end_at),
        agenda_id: a.agenda_id,
        agenda: ag?.name ?? "Agenda removida",
        dono: ag ? person(ag.owner_id) : null,
        titulo: a.title,
        cliente: a.client_name,
        telefone: a.client_phone,
        email: a.client_email,
        observacoes: a.notes,
        situacao: o,
        situacao_texto: OUTCOME_LABELS[o],
        agendado_por: person(a.created_by),
        agendado_por_id: a.created_by,
        agendado_em: iso(a.created_at),
        desfecho_por: person(a.status_changed_by),
        desfecho_em: iso(a.status_changed_at),
      };
    }),
    atividades: r.activity.map((e) => ({
      em: iso(e.created_at),
      acao: e.action,
      acao_texto: ACTION_LABELS[e.action],
      pessoa: person(e.actor_id),
      agenda: r.agendaById.get(e.agenda_id)?.name ?? "Agenda removida",
      agendamento_id: e.appointment_id,
      titulo: e.appointment?.title ?? null,
      cliente: e.appointment?.client_name ?? null,
      de: e.details?.de ? iso(e.details.de) : null,
      para: e.details?.para ? iso(e.details.para) : null,
    })),
  };
}

export type ReportJson = ReturnType<typeof buildReportJson>;
