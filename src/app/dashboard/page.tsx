import { DateTime } from "luxon";
import { Flash, PageHeader, type Search } from "@/components/ui";
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

  return (
    <>
      <PageHeader title="Agendamentos" subtitle={`Horários exibidos em ${profile.timezone.replace(/_/g, " ")}.`} />
      <Flash {...sp} />
      {Boolean(warnings.count) && (
        <Flash error="Alguns agendamentos têm avisos de agenda (veja abaixo). Confira a página Agendas." />
      )}

      <section className="card divide-y divide-neutral-200">
        {next.length === 0 && (
          <p className="p-6 text-sm text-neutral-500">
            Nenhum agendamento por vir. Compartilhe o link da sua página para começar a receber reservas.
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
