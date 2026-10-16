import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { Flash, PageHeader } from "@/components/ui";
import { listAgendaMembers, listAppointments, loadAgenda, type AgendaMember, type Appointment } from "@/lib/agendas";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { JOB_LABELS, ROLE_LABELS, type Profile } from "@/lib/types";
import {
  addAgendaMember, cancelAppointment, completeAppointment, createAppointment, deleteAgenda, removeAgendaMember, renameAgenda,
  updateAppointment,
} from "../actions";

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

  // Quem tem acesso (só o admin vê e gerencia).
  let members: AgendaMember[] = [];
  let candidates: Pick<Profile, "id" | "name" | "role" | "job">[] = [];
  if (isAdmin) {
    members = await listAgendaMembers(agenda.id);
    const taken = new Set([agenda.owner_id, ...members.map((m) => m.id)]);
    const all = await admin().from("profiles").select("id, name, role, job").eq("role", "member").order("name");
    candidates = ((all.data ?? []) as typeof candidates).filter((p) => !taken.has(p.id));
  }
  const describe = (p: { role: Profile["role"]; job: Profile["job"] }) =>
    [p.job ? JOB_LABELS[p.job] : null, ROLE_LABELS[p.role]].filter(Boolean).join(" · ");

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
        action={
          isAdmin
            ? <Link href="/dashboard/agendas" className="btn-outline">Todas as agendas</Link>
            : <Link href="/dashboard" className="btn-outline">Voltar para Agendamentos</Link>
        }
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
                  const done = a.status === "completed";
                  return (
                    <div
                      key={a.id}
                      className={
                        "rounded-lg border px-3 py-2 " +
                        (done ? "border-emerald-300 bg-emerald-50" : "border-neutral-200 bg-neutral-50")
                      }
                    >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          <span className="tabular-nums">{s.toFormat("HH:mm")}–{e.toFormat("HH:mm")}</span> · {a.title}
                          {done && (
                            <span className="ml-2 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-normal text-white">✓ Concluído</span>
                          )}
                        </p>
                        {contact && <p className="mt-0.5 break-words text-sm text-neutral-600">{contact}</p>}
                        {a.notes && <p className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-500">{a.notes}</p>}
                      </div>
                      {!done && (
                        <div className="flex shrink-0 gap-2">
                          <form action={completeAppointment}>
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="agenda_id" value={agenda.id} />
                            <input type="hidden" name="dia" value={key} />
                            <button className="inline-flex cursor-pointer items-center rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50">
                              Concluído
                            </button>
                          </form>
                          <form action={cancelAppointment}>
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="agenda_id" value={agenda.id} />
                            <input type="hidden" name="dia" value={key} />
                            <button className="btn-danger">Cancelar</button>
                          </form>
                        </div>
                      )}
                    </div>
                    {!done && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-medium text-neutral-700 hover:text-neutral-900">
                        Editar agendamento
                      </summary>
                      <form action={updateAppointment} className="mt-3 space-y-3">
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="agenda_id" value={agenda.id} />
                        <input type="hidden" name="dia" value={key} />
                        <label className="block text-xs text-neutral-500">
                          Título
                          <input name="title" required maxLength={120} defaultValue={a.title} className="input mt-1" />
                        </label>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <label className="text-xs text-neutral-500">
                            Data
                            <input name="date" type="date" required defaultValue={key} className="input mt-1" />
                          </label>
                          <label className="text-xs text-neutral-500">
                            Início
                            <input name="time" type="time" required defaultValue={s.toFormat("HH:mm")} className="input mt-1" />
                          </label>
                          <label className="text-xs text-neutral-500">
                            Duração (min)
                            <input name="duration_min" type="number" required min={5} max={720} step={5}
                              defaultValue={Math.round(e.diff(s, "minutes").minutes)} className="input mt-1" />
                          </label>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <label className="text-xs text-neutral-500">
                            Cliente
                            <input name="client_name" maxLength={120} defaultValue={a.client_name ?? ""} className="input mt-1" />
                          </label>
                          <label className="text-xs text-neutral-500">
                            Telefone
                            <input name="client_phone" type="tel" maxLength={40} defaultValue={a.client_phone ?? ""} className="input mt-1" />
                          </label>
                          <label className="text-xs text-neutral-500">
                            E-mail
                            <input name="client_email" type="email" maxLength={200} defaultValue={a.client_email ?? ""} className="input mt-1" />
                          </label>
                        </div>
                        <label className="block text-xs text-neutral-500">
                          Observações
                          <textarea name="notes" rows={2} maxLength={2000} defaultValue={a.notes ?? ""} className="input mt-1" />
                        </label>
                        <button className="btn-outline">Salvar alterações</button>
                      </form>
                    </details>
                    )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

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

          {isAdmin && (
          <>
          <h2 className="mb-2 text-sm font-semibold">Quem tem acesso</h2>
          <section className="card mb-8 max-w-2xl divide-y divide-neutral-200">
            <div className="flex items-center justify-between gap-3 p-4 text-sm">
              <span><span className="font-medium">{owner.name}</span> <span className="text-neutral-500">· dono da agenda</span></span>
            </div>
            <div className="p-4 text-sm text-neutral-500">Administradores acessam todas as agendas.</div>
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 p-4">
                <span className="min-w-0 text-sm">
                  <span className="font-medium">{m.name}</span> <span className="text-neutral-500">· {describe(m)}</span>
                </span>
                <form action={removeAgendaMember}>
                  <input type="hidden" name="agenda_id" value={agenda.id} />
                  <input type="hidden" name="user_id" value={m.id} />
                  <button className="btn-danger">Remover acesso</button>
                </form>
              </div>
            ))}
            <form action={addAgendaMember} className="flex flex-wrap items-center gap-2 p-4">
              <input type="hidden" name="agenda_id" value={agenda.id} />
              <select name="user_id" required defaultValue="" className="input w-auto min-w-0 flex-1" aria-label="Pessoa">
                <option value="" disabled>{candidates.length ? "Escolha um usuário" : "Todos os usuários já têm acesso"}</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.job ? ` (${JOB_LABELS[c.job]})` : ""}</option>
                ))}
              </select>
              <button className="btn-outline" disabled={!candidates.length}>Dar acesso</button>
            </form>
          </section>

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
          )}
      </>
    </>
  );
}
