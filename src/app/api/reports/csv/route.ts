import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { loadReport, OUTCOME_LABELS, outcomeOf, parseFilters } from "@/lib/reports";

export const dynamic = "force-dynamic";

function cell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Evita que planilhas interpretem o conteúdo como fórmula.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role, timezone").eq("id", data.user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "Somente administradores." }, { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const zone = me.timezone as string;
  const f = parseFilters(sp, zone);
  const r = await loadReport(f);
  const now = Date.now();
  const person = (id: string | null) => (id ? (r.personById.get(id)?.name ?? "Usuário removido") : "");
  const fmt = (iso: string | null) => (iso ? DateTime.fromISO(iso, { zone }).toFormat("dd/LL/yyyy HH:mm") : "");

  const header = [
    "Data", "Início", "Fim", "Agenda", "Dono da agenda", "Título", "Cliente", "Telefone", "E-mail",
    "Observações", "Agendado por", "Agendado em", "Situação", "Desfecho por", "Desfecho em",
  ];
  const rows = r.items.map((a) => {
    const ag = r.agendaById.get(a.agenda_id);
    const s = DateTime.fromISO(a.start_at, { zone });
    return [
      s.toFormat("dd/LL/yyyy"), s.toFormat("HH:mm"), DateTime.fromISO(a.end_at, { zone }).toFormat("HH:mm"),
      ag?.name ?? "Agenda removida", ag ? person(ag.owner_id) : "", a.title, a.client_name, a.client_phone,
      a.client_email, a.notes, person(a.created_by), fmt(a.created_at), OUTCOME_LABELS[outcomeOf(a, now)],
      person(a.status_changed_by), fmt(a.status_changed_at),
    ];
  });

  // Ponto e vírgula + BOM: abre direto no Excel em português com acentos corretos.
  const csv = "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="relatorio-agendas-${f.fromStr}-a-${f.toStr}.csv"`,
    },
  });
}
