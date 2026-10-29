import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { DateTime, IANAZone } from "luxon";
import { ACTION_LABELS } from "@/lib/activity";
import { buildReportCsv, loadReport, OUTCOME_LABELS, outcomeOf, parseFilters, type Tally } from "@/lib/reports";

export const dynamic = "force-dynamic";

/**
 * Relatório das agendas da equipe via HTTP.
 *
 *   GET /api/v1/relatorio?de=2026-10-01&ate=2026-10-31&agenda=<id>&pessoa=<id>&formato=json|csv&fuso=America/Fortaleza
 *   Authorization: Bearer <REPORTS_API_TOKEN>
 */
function authorized(req: Request): boolean {
  const expected = process.env.REPORTS_API_TOKEN;
  if (!expected || expected.length < 24) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  // Compara resumos de tamanho fixo para não vazar informação pelo tempo de resposta.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return given.length > 0 && timingSafeEqual(a, b);
}

const tally = (t: Tally, criados?: number) => ({
  ...(criados !== undefined ? { criados } : {}),
  agendados: t.total,
  concluidos: t.completed,
  cancelados: t.cancelled,
  sem_desfecho: t.no_outcome,
  pendentes: t.upcoming,
  taxa_conclusao: t.total - t.upcoming ? Math.round((t.completed / (t.total - t.upcoming)) * 1000) / 1000 : null,
});

export async function GET(req: Request) {
  if (!process.env.REPORTS_API_TOKEN) {
    return NextResponse.json({ erro: "API de relatórios desativada: defina REPORTS_API_TOKEN no servidor." }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ erro: "Não autorizado. Envie o cabeçalho Authorization: Bearer <chave>." }, { status: 401 });
  }

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const zone = sp.fuso && IANAZone.isValidZone(sp.fuso) ? sp.fuso : "America/Fortaleza";
  const f = parseFilters(sp, zone);
  let r: Awaited<ReturnType<typeof loadReport>>;
  try {
    r = await loadReport(f);
  } catch (err) {
    console.error("api relatorio", err);
    return NextResponse.json({ erro: "Falha ao montar o relatório." }, { status: 500 });
  }

  if (sp.formato === "csv") {
    return new Response(buildReportCsv(r, zone), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="relatorio-agendas-${f.fromStr}-a-${f.toStr}.csv"`,
      },
    });
  }

  const now = Date.now();
  const person = (id: string | null) => (id ? (r.personById.get(id)?.name ?? "Usuário removido") : null);
  const iso = (v: string | null) => (v ? DateTime.fromISO(v, { zone }).toISO() : null);
  const zero: Tally = { total: 0, completed: 0, cancelled: 0, upcoming: 0, no_outcome: 0 };

  const body = {
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
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
