import { NextResponse } from "next/server";
import { ownerAppointments } from "@/lib/agendas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Próximos agendamentos (até 15 min à frente) das agendas de que o usuário logado é dono. */
export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const now = new Date();
  const until = new Date(now.getTime() + 15 * 60_000);
  try {
    const items = await ownerAppointments(data.user.id, now, until);
    const upcoming = items
      .filter((a) => a.status === "confirmed" && Date.parse(a.start_at) > now.getTime())
      .map((a) => ({
        id: a.id,
        title: a.title,
        start_at: a.start_at,
        client_name: a.client_name,
        agenda_name: a.agenda_name,
        agenda_id: a.agenda_id,
      }));
    return NextResponse.json({ now: now.toISOString(), upcoming });
  } catch (err) {
    console.error("alerts", err);
    return NextResponse.json({ error: "Falha ao buscar alertas." }, { status: 500 });
  }
}
