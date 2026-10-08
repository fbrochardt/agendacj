import { NextResponse } from "next/server";
import { IANAZone } from "luxon";
import { appUrl } from "@/lib/auth";
import { availableSlots, loadEventType } from "@/lib/booking";
import { createCalendarEvent } from "@/lib/calendars";
import { randomToken } from "@/lib/crypto";
import { admin } from "@/lib/supabase/admin";
import { locationText } from "@/lib/types";

export const dynamic = "force-dynamic";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  if (str(body.website, 10)) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 }); // anti-robô

  const name = str(body.name, 120);
  const email = str(body.email, 200).toLowerCase();
  const notes = str(body.notes, 2000);
  const tz = str(body.timezone, 64);
  const start = new Date(str(body.start, 40));
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || isNaN(start.getTime())) {
    return NextResponse.json({ error: "Preencha nome, e-mail e horário." }, { status: 400 });
  }

  const found = await loadEventType(str(body.username, 40), str(body.slug, 80));
  if (!found) return NextResponse.json({ error: "Evento não encontrado." }, { status: 404 });
  const { host, eventType: et } = found;
  const end = new Date(start.getTime() + et.duration_min * 60_000);

  // Confere de novo no servidor se o horário continua livre.
  const taken = { error: "Esse horário acabou de ser ocupado. Escolha outro." };
  const still = await availableSlots(host, et, start, new Date(start.getTime() + 60_000));
  if (!still.includes(start.toISOString())) return NextResponse.json(taken, { status: 409 });

  const db = admin();
  const location = locationText(et);
  const inserted = await db
    .from("bookings")
    .insert({
      event_type_id: et.id,
      user_id: host.id,
      title: et.title,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      guest_name: name,
      guest_email: email,
      guest_timezone: IANAZone.isValidZone(tz) ? tz : null,
      notes: notes || null,
      location,
      cancel_token: randomToken(),
    })
    .select("id, cancel_token")
    .single();
  if (inserted.error) {
    // 23P01: a restrição do banco barrou uma reserva simultânea no mesmo horário.
    if (inserted.error.code === "23P01") return NextResponse.json(taken, { status: 409 });
    console.error("book", inserted.error);
    return NextResponse.json({ error: "Não foi possível concluir o agendamento." }, { status: 500 });
  }
  const { id, cancel_token } = inserted.data;

  const manage = `${appUrl()}/booking/${id}?token=${cancel_token}`;
  const description = [
    `${et.title} com ${name} (${email})`,
    notes ? `\nObservações:\n${notes}` : "",
    `\nCancelar ou ver detalhes: ${manage}`,
  ].join("\n");

  const result = await createCalendarEvent(host.id, {
    bookingId: id.replace(/-/g, ""),
    start, end,
    summary: `${et.title}: ${name} e ${host.name}`,
    description,
    location: et.location_type === "google_meet" ? undefined : location,
    guestName: name,
    guestEmail: email,
    wantMeet: et.location_type === "google_meet",
  });
  await db
    .from("bookings")
    .update({
      meeting_url: result.meetUrl,
      external_provider: result.provider,
      external_event_id: result.eventId,
      external_connection_id: result.connectionId,
      calendar_error: result.error,
    })
    .eq("id", id);

  return NextResponse.json({ id, token: cancel_token });
}
