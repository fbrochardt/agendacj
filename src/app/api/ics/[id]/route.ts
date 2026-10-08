import { buildIcs } from "@/lib/calendars/ics";
import { admin } from "@/lib/supabase/admin";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Não encontrado", { status: 404 });
  const { data } = await admin().from("bookings").select("*").eq("id", id).maybeSingle();
  const b = data as Booking | null;
  if (!b || b.cancel_token !== token) return new Response("Não encontrado", { status: 404 });

  const ics = buildIcs({
    uid: b.id,
    start: new Date(b.start_at),
    end: new Date(b.end_at),
    summary: b.title,
    description: b.meeting_url ? `Link da reunião: ${b.meeting_url}` : undefined,
    location: b.meeting_url ?? b.location ?? undefined,
  });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="agendamento.ics"',
    },
  });
}
