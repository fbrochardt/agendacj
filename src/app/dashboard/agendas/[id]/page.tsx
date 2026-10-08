import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { Flash, PageHeader } from "@/components/ui";
import { listAppointments, loadAgenda, type Appointment } from "@/lib/agendas";
import { requireUser } from "@/lib/auth";
import { cancelAppointment, createAppointment, deleteAgenda, renameAgenda } from "../actions";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; dia?: string }>;
};

export default async function AgendaPage({ params, searchParams }: Props) {
  const { profile } = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const found = await loadAgenda(profile, id);
  if (!found) notFound();
  const { agenda, owner } = found;
  const isAdmin = profile.role === "admin";
  const zone = owner.timezone;

  // Semana exibida (segunda a domingo), no fuso do dono da agenda.
  const today = DateTime.now().setZone(zone).startOf("day");
  const picked = sp.dia ? DateTime.fromISO(sp.dia, { zone }) : today;
  const focus = picked.isValid ? picked.startOf("day") : today;
  const weekStart = focus.startOf("week");
  const days = Array.from({ length: 7 }, (_, i) => weekStart.plus({ days: i }));
  const items = await listAppointments(agenda.id, weekStart.toJSDate(), weekStart.plus({ weeks: 1 }).toJSDate());

  const byDay = new Map<string, Appointment[]>();
  for (const a of items) {
    const key = DateTime.fromISO(a.start_at, { zone }).toISODate()!;
    byDay.set(key, [...(byDay.get(key) ?? []), a]);
  }
  const base = `/dashboard/agendas/${agenda.id}`;
  const weekLabel = `${weekStart.setLocale("pt-BR").toFormat("dd 'de' LLL")} a ${weekStart.plus({ days: 6 }).setLocale("pt-BR").toFormat("dd 'de' LLL 'de' yyyy")}`;

  return (
    <>
      <PageHeader
        title={agenda.name}
        subtitle={`Dono: ${owner.name} · horários em ${zone.replace(/_/g, " ")}`}
        action={<Link href="/dashboard/agendas" className="btn-outline">Todas as agendas</Link>}
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{weekLabel}</h2>
        <div className="flex gap-1">
          <Link href={`${base}?dia=${weekStart.minus({ weeks: 1 }).toISODate()}`} className="btn-outline px-2.5" aria-label="Semana anterior">‹</Link>
          <Link href={base} className="btn-outline">Hoje</Link>
          <Link href={`${base}?dia=${weekStart.plus({ weeks: 1 }).toISODate()}`} className="btn-outline px-2.5" aria-label="Próxima semana">›</Link>
        </div>
      </div>

      <section className="card mb-8 divide-y divide-neutral-200">
        {days.map((d) => {
          const key = d.toISODate()!;
          const list = byDay.get(key) ?? [];
          const isToday = d.hasSame(today, "day");
          return (
            <div key={key} className="grid gap-2 p-4 sm:grid-cols-[130px_1fr]">
              <p className={"text-sm capitalize " + (isToday ? "font-semibold text-neutral-900" : "text-neutral-500")}>
                {d.setLocale("pt-BR").toFormat("ccc, dd/LL")}
                {isToday && <span className="ml-2 rounded-full bg-neutral-900 px-2 py-0.5 text-xs font-normal normal-case text-white">Hoje</span>}
              </p>
              <div className="space-y-2">
                {list.length === 0 && <p className="text-sm text-neutral-300">Livre</p>}
                {list.map((a) => {
                  const s = DateTime.fromISO(a.start_at, { zone });
                  const e = DateTime.fromISO(a.end_at, { zone });
                  const contact = [a.client_name, a.client_phone, a.client_email].filter(Boolean).join(" · ");
                  return (
                    <div key={a.id} className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          <span className="tabular-nums">{s.toFormat("HH:mm")}–{e.toFormat("HH:mm")}</span> · {a.title}
                        </p>
                        {contact && <p className="mt-0.5 break-words text-sm text-neutral-600">{contact}</p>}
                        {a.notes && <p className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-500">{a.notes}</p>}
                      </div>
                      {isAdmin && (
                        <form action={cancelAppointment} className="shrink-0">
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="agenda_id" value={agenda.id} />
                          <input type="hidden" name="dia" value={key} />
                          <button className="btn-danger">Cancelar</button>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      {isAdmin ? (
        <>
          <h2 className="mb-2 text-sm font-semibold">Novo agendamento</h2>
          <form action={createAppointment} className="card mb-8 max-w-2xl space-y-4 p-5">
            <input type="hidden" name="agenda_id" value={agenda.id} />
            <div>
              <label className="label" htmlFor="title">Título</label>
              <input id="title" name="title" required maxLength={120} placeholder="Reunião de apresentação" className="input" />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="date">Data</label>
                <input id="date" name="date" type="date" required defaultValue={focus.toISODate()!} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="time">Início</label>
                <input id="time" name="time" type="time" required defaultValue="09:00" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="duration_min">Duração (min)</label>
                <input id="duration_min" name="duration_min" type="number" required min={5} max={720} step={5} defaultValue={30} className="input" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="client_name">Cliente</label>
                <input id="client_name" name="client_name" maxLength={120} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="client_phone">Telefone</label>
                <input id="client_phone" name="client_phone" type="tel" maxLength={40} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="client_email">E-mail</label>
                <input id="client_email" name="client_email" type="email" maxLength={200} className="input" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="notes">Observações</label>
              <textarea id="notes" name="notes" rows={2} maxLength={2000} className="input" />
            </div>
            <button className="btn">Agendar</button>
            <p className="hint">Cliente, telefone e e-mail são opcionais. Nenhuma mensagem é enviada ao cliente.</p>
          </form>

          <details className="max-w-2xl">
            <summary className="cursor-pointer text-sm font-semibold">Configurações da agenda</summary>
            <form action={renameAgenda} className="card mt-3 space-y-4 p-5">
              <input type="hidden" name="id" value={agenda.id} />
              <div>
                <label className="label" htmlFor="agenda_name">Nome</label>
                <input id="agenda_name" name="name" required maxLength={80} defaultValue={agenda.name} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="agenda_description">Descrição</label>
                <input id="agenda_description" name="description" maxLength={200} defaultValue={agenda.description ?? ""} className="input" />
              </div>
              <button className="btn-outline">Salvar</button>
            </form>
            <form action={deleteAgenda} className="card mt-3 space-y-3 border-red-200 p-5">
              <input type="hidden" name="id" value={agenda.id} />
              <p className="text-sm text-neutral-700">
                Excluir apaga a agenda e todos os agendamentos dela, sem volta. Para confirmar, digite o nome da agenda:
              </p>
              <input name="confirm" required autoComplete="off" placeholder={agenda.name} className="input" aria-label="Nome da agenda para confirmar a exclusão" />
              <button className="btn-danger">Excluir agenda</button>
            </form>
          </details>
        </>
      ) : (
        <p className="text-sm text-neutral-500">Para marcar ou cancelar um horário nesta agenda, fale com um administrador.</p>
      )}
    </>
  );
}
