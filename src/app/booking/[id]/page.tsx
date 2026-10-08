import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DateTime, IANAZone } from "luxon";
import { cancelBooking } from "@/lib/booking";
import { admin } from "@/lib/supabase/admin";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Seu agendamento", robots: { index: false } };

async function load(id: string, token: string): Promise<Booking | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !token) return null;
  const { data } = await admin().from("bookings").select("*").eq("id", id).maybeSingle();
  const b = data as Booking | null;
  return b && b.cancel_token === token ? b : null;
}

async function cancel(fd: FormData) {
  "use server";
  const id = String(fd.get("id") ?? "");
  const token = String(fd.get("token") ?? "");
  const booking = await load(id, token);
  if (!booking) notFound();
  await cancelBooking(booking);
  redirect(`/booking/${id}?token=${token}`);
}

export default async function BookingDetails({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; novo?: string }>;
}) {
  const { id } = await params;
  const { token = "", novo } = await searchParams;
  const b = await load(id, token);
  if (!b) notFound();

  const { data: host } = await admin().from("profiles").select("name, username, timezone").eq("id", b.user_id).maybeSingle();
  const zone = b.guest_timezone && IANAZone.isValidZone(b.guest_timezone) ? b.guest_timezone : (host?.timezone ?? "UTC");
  const start = DateTime.fromISO(b.start_at, { zone }).setLocale("pt-BR");
  const end = DateTime.fromISO(b.end_at, { zone });
  const cancelled = b.status === "cancelled";
  const past = Date.parse(b.end_at) < Date.now();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="card p-6">
        <div
          className={
            "mb-4 flex size-10 items-center justify-center rounded-full text-lg " +
            (cancelled ? "bg-neutral-100 text-neutral-500" : "bg-emerald-100 text-emerald-700")
          }
          aria-hidden="true"
        >
          {cancelled ? "✕" : "✓"}
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          {cancelled ? "Agendamento cancelado" : novo ? "Agendamento confirmado" : "Seu agendamento"}
        </h1>
        <dl className="mt-5 space-y-3 text-sm">
          <div>
            <dt className="text-neutral-500">O quê</dt>
            <dd className="font-medium">{b.title}{host ? ` com ${host.name}` : ""}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Quando</dt>
            <dd className={"font-medium " + (cancelled ? "line-through" : "")}>
              {start.toFormat("cccc, dd 'de' LLLL 'de' yyyy")}
              <br />
              {start.toFormat("HH:mm")}–{end.toFormat("HH:mm")} <span className="font-normal text-neutral-500">({zone.replace(/_/g, " ")})</span>
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">Onde</dt>
            <dd className="font-medium">
              {b.meeting_url && !cancelled ? (
                <a href={b.meeting_url} target="_blank" rel="noreferrer" className="break-all text-blue-700 underline">{b.meeting_url}</a>
              ) : (
                b.location ?? "A combinar"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">Quem</dt>
            <dd className="font-medium">{b.guest_name} <span className="font-normal text-neutral-500">({b.guest_email})</span></dd>
          </div>
        </dl>

        {!cancelled && (
          <div className="mt-6 flex flex-wrap gap-2 border-t border-neutral-200 pt-5">
            <a href={`/api/ics/${b.id}?token=${token}`} className="btn-outline">Adicionar à minha agenda (.ics)</a>
            {!past && (
              <form action={cancel}>
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="token" value={token} />
                <button className="btn-danger py-2">Cancelar agendamento</button>
              </form>
            )}
          </div>
        )}
        {!cancelled && (
          <p className="mt-4 text-xs text-neutral-500">
            Guarde o endereço desta página: é por ela que você consulta ou cancela o agendamento.
          </p>
        )}
        {cancelled && host && (
          <Link href={`/${host.username}`} className="btn mt-6">Agendar outro horário</Link>
        )}
      </div>
    </main>
  );
}
