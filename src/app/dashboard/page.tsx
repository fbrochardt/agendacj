import Link from "next/link";
import { DateTime } from "luxon";
import { Flash, PageHeader, type Search } from "@/components/ui";
import { ownerAppointments } from "@/lib/agendas";
import { requireUser } from "@/lib/auth";
import type { Booking } from "@/lib/types";
import { cancelAsHost } from "./actions";

function when(b: Booking, zone: string) {
  const s = DateTime.fromISO(b.start_at, { zone }).setLocale("pt-BR");
  const e = DateTime.fromISO(b.end_at, { zone });
  return `${s.toFormat("ccc, dd 'de' LLL")} · ${s.toFormat("HH:mm")}–${e.toFormat("HH:mm")}`;
}

export default async function Bookings({ searchParams }: { searchParams: Search }) {
  const { supabase, profile } = await requireUser();
  const sp = await searchParams;
  const nowIso = new Date().toISOString();
  const [upcoming, past, warnings] = await Promise.all([
    supabase.from("bookings").select("*").eq("status", "confirmed").gte("end_at", nowIso).order("start_at").limit(100),
    supabase.from("bookings").select("*").or(`status.eq.cancelled,end_at.lt."${nowIso}"`)
      .order("start_at", { ascending: false }).limit(20),
    supabase.from("bookings").select("id", { count: "exact", head: true }).not("calendar_error", "is", null)
      .eq("status", "confirmed").gte("end_at", nowIso),
  ]);
  const next = (upcoming.data ?? []) as Booking[];
  const old = (past.data ?? []) as Booking[];

  // Agenda de hoje: reservas da página pública + agendas da equipe em que a pessoa é dona.
  const zone = profile.timezone;
  const dayStart = DateTime.now().setZone(zone).startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });
  const [todayBookings, todayAppointments] = await Promise.all([
    supabase.from("bookings").select("*").eq("status", "confirmed")
      .lt("start_at", dayEnd.toUTC().toISO()!).gt("end_at", dayStart.toUTC().toISO()!),
    ownerAppointments(profile.id, dayStart.toJSDate(), dayEnd.toJSDate()),
  ]);
  type TodayItem = {
    key: string; start: string; end: string; title: string; detail: string;
    notes: string | null; origin: string; href: string | null; meetingUrl: string | null;
  };
  const today: TodayItem[] = [
    ...((todayBookings.data ?? []) as Booking[]).map((b) => ({
      key: `b-${b.id}`, start: b.start_at, end: b.end_at, title: b.title,
      detail: [b.guest_name, b.guest_email, b.meeting_url ? null : b.location].filter(Boolean).join(" · "),
      notes: b.notes, origin: "Página pública", href: null, meetingUrl: b.meeting_url,
    })),
    ...todayAppointments.map((a) => ({
      key: `a-${a.id}`, start: a.start_at, end: a.end_at, title: a.title,
      detail: [a.client_name, a.client_phone, a.client_email].filter(Boolean).join(" · "),
      notes: a.notes, origin: a.agenda_name, href: `/dashboard/agendas/${a.agenda_id}`, meetingUrl: null,
    })),
  ].sort((x, y) => Date.parse(x.start) - Date.parse(y.start));
  const nowMs = Date.now();

  return (
    <>
      <PageHeader title="Agendamentos" subtitle={`Horários exibidos em ${profile.timezone.replace(/_/g, " ")}.`} />
      <Flash {...sp} />
      {Boolean(warnings.count) && (
        <Flash error="Alguns agendamentos têm avisos de agenda (veja abaixo). Confira a página Google e Apple." />
      )}

      <h2 className="mb-2 text-sm font-semibold">
        Hoje <span className="font-normal capitalize text-neutral-500">· {dayStart.setLocale("pt-BR").toFormat("cccc, dd 'de' LLLL")}</span>
      </h2>
      <section className="card mb-8 divide-y divide-neutral-200">
        {today.length === 0 && <p className="p-6 text-sm text-neutral-500">Você não tem agendamentos hoje.</p>}
        {today.map((t) => {
          const s = DateTime.fromISO(t.start, { zone });
          const e = DateTime.fromISO(t.end, { zone });
          const done = Date.parse(t.end) < nowMs;
          const live = Date.parse(t.start) <= nowMs && !done;
          return (
            <div key={t.key} className={"grid gap-1 p-4 sm:grid-cols-[110px_1fr] " + (done ? "opacity-50" : "")}>
              <p className="text-sm font-medium tabular-nums">
                {s.toFormat("HH:mm")}–{e.toFormat("HH:mm")}
              </p>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {t.title}
                  {live && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-normal text-emerald-800">Agora</span>}
                  {done && <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-normal text-neutral-600">Concluído</span>}
                </p>
                {t.detail && <p className="mt-0.5 break-words text-sm text-neutral-600">{t.detail}</p>}
                {t.notes && <p className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-500">{t.notes}</p>}
                <p className="mt-1 text-xs text-neutral-500">
                  {t.href ? <Link href={t.href} className="underline">{t.origin}</Link> : t.origin}
                  {t.meetingUrl && (
                    <>
                      {" · "}
                      <a href={t.meetingUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline">Entrar na reunião</a>
                    </>
                  )}
                </p>
              </div>
            </div>
          );
        })}
      </section>

      <h2 className="mb-2 text-sm font-semibold">Próximas reservas pela página pública</h2>
      <section className="card divide-y divide-neutral-200">
        {next.length === 0 && (
          <p className="p-6 text-sm text-neutral-500">
            Nenhuma reserva por vir. Compartilhe o link da sua página para começar a receber reservas.
          </p>
        )}
        {next.map((b) => (
          <div key={b.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{when(b, profile.timezone)}</p>
              <p className="mt-0.5 text-sm text-neutral-700">
                {b.title} com {b.guest_name} <span className="text-neutral-400">({b.guest_email})</span>
              </p>
              {b.meeting_url ? (
                <a href={b.meeting_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-blue-700 underline">
                  Entrar na reunião
                </a>
              ) : (
                b.location && <p className="mt-1 text-sm text-neutral-500">{b.location}</p>
              )}
              {b.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-500">“{b.notes}”</p>}
              {b.calendar_error && <p className="mt-1 text-xs text-amber-700">Aviso: {b.calendar_error}</p>}
            </div>
            <form action={cancelAsHost}>
              <input type="hidden" name="id" value={b.id} />
              <button className="btn-danger">Cancelar</button>
            </form>
          </div>
        ))}
      </section>

      {old.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-sm font-semibold text-neutral-500">Anteriores e cancelados</h2>
          <section className="card divide-y divide-neutral-200">
            {old.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 p-4 text-sm text-neutral-500">
                <span className="min-w-0 truncate">
                  {when(b, profile.timezone)} · {b.title} com {b.guest_name}
                </span>
                {b.status === "cancelled" && (
                  <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs">Cancelado</span>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}
