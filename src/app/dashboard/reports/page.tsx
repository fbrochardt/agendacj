import Link from "next/link";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/ui";
import { ACTION_LABELS } from "@/lib/activity";
import { requireAdmin } from "@/lib/auth";
import { loadReport, OUTCOME_LABELS, outcomeOf, parseFilters, rate, type Tally } from "@/lib/reports";
import { JOB_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

type SP = Promise<{ de?: string; ate?: string; agenda?: string; pessoa?: string }>;

const OUTCOME_STYLE = {
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-100 text-red-800",
  upcoming: "bg-blue-50 text-blue-800",
  no_outcome: "bg-amber-100 text-amber-800",
} as const;

/** Concluídos sobre os que já tiveram desfecho ou já passaram (pendentes futuros não contam). */
const closed = (t: Tally) => t.total - t.upcoming;

function Kpi({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={"mt-1 text-2xl font-semibold tabular-nums " + (tone ?? "")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

function TallyTable({ title, rows }: { title: string; rows: { key: string; name: string; sub?: string; t: Tally; created: number }[] }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 text-right font-medium" title="Cadastrados no período">Criados</th>
              <th className="px-3 py-2 text-right font-medium" title="Com data marcada no período">Agendados</th>
              <th className="px-3 py-2 text-right font-medium">Concluídos</th>
              <th className="px-3 py-2 text-right font-medium">Cancelados</th>
              <th className="px-3 py-2 text-right font-medium">Sem desfecho</th>
              <th className="px-3 py-2 text-right font-medium">Pendentes</th>
              <th className="px-4 py-2 text-right font-medium">Conclusão</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-neutral-500">Nada no período.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-4 py-2">
                  <span className="font-medium">{r.name}</span>
                  {r.sub && <span className="ml-1.5 text-xs text-neutral-500">{r.sub}</span>}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{r.created}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.t.total}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{r.t.completed}</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-700">{r.t.cancelled}</td>
                <td className="px-3 py-2 text-right tabular-nums text-amber-700">{r.t.no_outcome}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{r.t.upcoming}</td>
                <td className="px-4 py-2 text-right font-medium tabular-nums">{rate(r.t.completed, closed(r.t))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function Reports({ searchParams }: { searchParams: SP }) {
  const { profile } = await requireAdmin();
  const sp = await searchParams;
  const zone = profile.timezone;
  const f = parseFilters(sp, zone);
  const r = await loadReport(f);
  const nowMs = Date.now();

  const personName = (id: string | null) => (id ? (r.personById.get(id)?.name ?? "Usuário removido") : "—");
  const agendaName = (id: string) => r.agendaById.get(id)?.name ?? "Agenda removida";
  const sortRows = <T extends { t: Tally; created: number }>(rows: T[]) =>
    rows.sort((a, b) => b.created - a.created || b.t.total - a.t.total);

  const zero: Tally = { total: 0, completed: 0, cancelled: 0, upcoming: 0, no_outcome: 0 };
  const keysOf = (a: Map<string, unknown>, b: Map<string, unknown>) => [...new Set([...a.keys(), ...b.keys()])];
  const agendaRows = sortRows(
    keysOf(r.byAgenda, r.createdByAgenda).map((id) => [id, r.byAgenda.get(id) ?? zero] as const).map(([id, t]) => ({
      key: id,
      name: agendaName(id),
      sub: r.agendaById.get(id) ? `dono: ${personName(r.agendaById.get(id)!.owner_id)}` : undefined,
      t,
      created: r.createdByAgenda.get(id) ?? 0,
    })),
  );
  const personRows = sortRows(
    keysOf(r.byPerson, r.createdByPerson).map((id) => [id, r.byPerson.get(id) ?? zero] as const).map(([id, t]) => {
      const p = id === "-" ? null : r.personById.get(id);
      return {
        key: id, name: id === "-" ? "Sem registro" : (p?.name ?? "Usuário removido"),
        sub: p?.job ? JOB_LABELS[p.job] : undefined, t, created: r.createdByPerson.get(id) ?? 0,
      };
    }),
  );
  const days = [...r.byDay].sort(([a], [b]) => a.localeCompare(b));
  const maxDay = Math.max(1, ...days.map(([, t]) => t.total));

  const qs = new URLSearchParams({ de: f.fromStr, ate: f.toStr });
  if (f.agendaId) qs.set("agenda", f.agendaId);
  if (f.personId) qs.set("pessoa", f.personId);
  const today = DateTime.now().setZone(zone);
  const preset = (label: string, from: DateTime, to: DateTime) => (
    <Link
      href={`/dashboard/reports?${new URLSearchParams({
        de: from.toISODate()!, ate: to.toISODate()!,
        ...(f.agendaId ? { agenda: f.agendaId } : {}), ...(f.personId ? { pessoa: f.personId } : {}),
      })}`}
      className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
    >
      {label}
    </Link>
  );
  const fmtPeriod = `${f.from.setLocale("pt-BR").toFormat("dd/LL/yyyy")} a ${f.to.minus({ days: 1 }).setLocale("pt-BR").toFormat("dd/LL/yyyy")}`;

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle={`Atividades das agendas da equipe · ${fmtPeriod} · horários em ${zone.replace(/_/g, " ")}`}
        action={<a href={`/api/reports/csv?${qs}`} className="btn-outline">Exportar planilha (CSV)</a>}
      />

      <form className="card mb-3 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <label className="text-xs text-neutral-500">
          De
          <input type="date" name="de" defaultValue={f.fromStr} className="input mt-1" />
        </label>
        <label className="text-xs text-neutral-500">
          Até
          <input type="date" name="ate" defaultValue={f.toStr} className="input mt-1" />
        </label>
        <label className="text-xs text-neutral-500">
          Agenda
          <select name="agenda" defaultValue={f.agendaId ?? ""} className="input mt-1">
            <option value="">Todas</option>
            {r.agendaList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-neutral-500">
          Pessoa (quem agendou)
          <select name="pessoa" defaultValue={f.personId ?? ""} className="input mt-1">
            <option value="">Todas</option>
            {r.personList.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.job ? ` · ${JOB_LABELS[p.job]}` : ""}</option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="btn flex-1">Filtrar</button>
          <Link href="/dashboard/reports" className="btn-outline">Limpar</Link>
        </div>
      </form>
      <div className="mb-6 flex flex-wrap gap-2">
        {preset("Hoje", today, today)}
        {preset("Últimos 7 dias", today.minus({ days: 6 }), today)}
        {preset("Este mês", today.startOf("month"), today.endOf("month"))}
        {preset("Mês passado", today.minus({ months: 1 }).startOf("month"), today.minus({ months: 1 }).endOf("month"))}
        {preset("Últimos 90 dias", today.minus({ days: 89 }), today)}
      </div>

      <p className="mb-2 text-xs text-neutral-500">
        &quot;Criados&quot; conta pela data em que o agendamento foi cadastrado; os demais números, pela data marcada da
        reunião. O filtro &quot;Pessoa&quot; considera quem criou o agendamento.
      </p>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-7">
        <Kpi label="Criados no período" value={r.createdTotal} tone="text-blue-700" hint="Cadastrados nessas datas" />
        <Kpi label="Agendados" value={r.totals.total} hint="Reuniões marcadas nessas datas" />
        <Kpi label="Concluídos" value={r.totals.completed} tone="text-emerald-700" />
        <Kpi label="Cancelados" value={r.totals.cancelled} tone="text-red-700" hint={`${rate(r.totals.cancelled, r.totals.total)} do total`} />
        <Kpi label="Sem desfecho" value={r.totals.no_outcome} tone="text-amber-700" hint="Horário passou e não foi marcado" />
        <Kpi label="Pendentes" value={r.totals.upcoming} hint="Ainda vão acontecer" />
        <Kpi label="Taxa de conclusão" value={rate(r.totals.completed, closed(r.totals))} hint="Sobre os que já passaram" />
      </div>

      <TallyTable title="Por agenda (vendedor)" rows={agendaRows} />
      <TallyTable title="Por quem agendou (SDR)" rows={personRows} />

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold">Agendamentos por dia</h2>
        <div className="card divide-y divide-neutral-100">
          {days.length === 0 && <p className="p-6 text-center text-sm text-neutral-500">Nada no período.</p>}
          {days.map(([day, t]) => (
            <div key={day} className="grid grid-cols-[96px_1fr_auto] items-center gap-3 px-4 py-2 text-sm">
              <span className="capitalize text-neutral-600">{DateTime.fromISO(day, { zone }).setLocale("pt-BR").toFormat("ccc dd/LL")}</span>
              <div className="flex h-3 overflow-hidden rounded bg-neutral-100" title={`${t.completed} concluídos, ${t.cancelled} cancelados, ${t.no_outcome} sem desfecho, ${t.upcoming} pendentes`}>
                <div className="bg-emerald-500" style={{ width: `${(t.completed / maxDay) * 100}%` }} />
                <div className="bg-amber-400" style={{ width: `${(t.no_outcome / maxDay) * 100}%` }} />
                <div className="bg-blue-300" style={{ width: `${(t.upcoming / maxDay) * 100}%` }} />
                <div className="bg-red-400" style={{ width: `${(t.cancelled / maxDay) * 100}%` }} />
              </div>
              <span className="w-8 text-right tabular-nums">{t.total}</span>
            </div>
          ))}
          {days.length > 0 && (
            <div className="flex flex-wrap gap-4 px-4 py-2 text-xs text-neutral-500">
              <span><span className="mr-1 inline-block size-2 rounded-sm bg-emerald-500" />Concluídos</span>
              <span><span className="mr-1 inline-block size-2 rounded-sm bg-amber-400" />Sem desfecho</span>
              <span><span className="mr-1 inline-block size-2 rounded-sm bg-blue-300" />Pendentes</span>
              <span><span className="mr-1 inline-block size-2 rounded-sm bg-red-400" />Cancelados</span>
            </div>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold">Histórico de atividades</h2>
        <p className="mb-2 text-xs text-neutral-500">
          Ações feitas no período (as mais recentes primeiro, até 300). Aqui o filtro &quot;Pessoa&quot; considera quem fez a ação.
        </p>
        <div className="card divide-y divide-neutral-100">
          {r.activity.length === 0 && <p className="p-6 text-center text-sm text-neutral-500">Nenhuma atividade no período.</p>}
          {r.activity.map((e) => {
            const at = DateTime.fromISO(e.created_at, { zone }).setLocale("pt-BR");
            const what = e.appointment
              ? `“${e.appointment.title}${e.appointment.client_name ? ` · ${e.appointment.client_name}` : ""}”`
              : "um agendamento";
            const moved =
              e.action === "rescheduled" && e.details?.de && e.details?.para
                ? ` de ${DateTime.fromISO(e.details.de, { zone }).toFormat("dd/LL HH:mm")} para ${DateTime.fromISO(e.details.para, { zone }).toFormat("dd/LL HH:mm")}`
                : "";
            return (
              <div key={e.id} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[120px_1fr]">
                <span className="tabular-nums text-neutral-500">{at.toFormat("dd/LL HH:mm")}</span>
                <span>
                  <span className="font-medium">{personName(e.actor_id)}</span> {ACTION_LABELS[e.action]} {what}
                  {moved} <span className="text-neutral-500">· {agendaName(e.agenda_id)}</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold">Todos os agendamentos do período ({r.items.length})</h2>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="px-4 py-2 font-medium">Data</th>
                <th className="px-3 py-2 font-medium">Agenda</th>
                <th className="px-3 py-2 font-medium">Título</th>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Agendado por</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-4 py-2 font-medium">Desfecho por</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {r.items.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-neutral-500">Nada no período.</td></tr>
              )}
              {r.items.slice(0, 500).map((a) => {
                const o = outcomeOf(a, nowMs);
                const s = DateTime.fromISO(a.start_at, { zone }).setLocale("pt-BR");
                return (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums">{s.toFormat("dd/LL HH:mm")}</td>
                    <td className="px-3 py-2">
                      <Link href={`/dashboard/agendas/${a.agenda_id}?dia=${s.toISODate()}`} className="hover:underline">{agendaName(a.agenda_id)}</Link>
                    </td>
                    <td className="px-3 py-2">{a.title}</td>
                    <td className="px-3 py-2">
                      {a.client_name ?? "—"}
                      {a.client_phone && <span className="block text-xs text-neutral-500">{a.client_phone}</span>}
                    </td>
                    <td className="px-3 py-2">{personName(a.created_by)}</td>
                    <td className="px-3 py-2">
                      <span className={"rounded-full px-2 py-0.5 text-xs " + OUTCOME_STYLE[o]}>{OUTCOME_LABELS[o]}</span>
                    </td>
                    <td className="px-4 py-2">{a.status_changed_by ? personName(a.status_changed_by) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {r.items.length > 500 && (
          <p className="mt-2 text-xs text-neutral-500">Mostrando 500 de {r.items.length}. A planilha (CSV) traz todos.</p>
        )}
      </section>
    </>
  );
}
