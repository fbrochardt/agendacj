import { NextResponse } from "next/server";
import { availableSlots, loadEventType } from "@/lib/booking";

export const dynamic = "force-dynamic";

const MAX_RANGE = 45 * 86_400_000;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const from = new Date(q.get("from") ?? "");
  const to = new Date(q.get("to") ?? "");
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > MAX_RANGE) {
    return NextResponse.json({ error: "Período inválido." }, { status: 400 });
  }
  const found = await loadEventType(q.get("username") ?? "", q.get("slug") ?? "");
  if (!found) return NextResponse.json({ error: "Evento não encontrado." }, { status: 404 });
  try {
    const slots = await availableSlots(found.host, found.eventType, from, to);
    return NextResponse.json({ slots });
  } catch (err) {
    console.error("slots", err);
    return NextResponse.json({ error: "Não foi possível carregar os horários." }, { status: 500 });
  }
}
