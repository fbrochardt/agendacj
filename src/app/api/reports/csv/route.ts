import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildReportCsv, loadReport, parseFilters } from "@/lib/reports";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role, job, timezone").eq("id", data.user.id).maybeSingle();
  const isAdmin = me?.role === "admin";
  if (!me || (!isAdmin && me.job !== "sdr")) {
    return NextResponse.json({ error: "Somente administradores e SDRs." }, { status: 403 });
  }

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  // SDR que não é administrador só baixa o próprio relatório.
  if (!isAdmin) sp.pessoa = data.user.id;
  const zone = me.timezone as string;
  const f = parseFilters(sp, zone);
  const r = await loadReport(f);
  const csv = buildReportCsv(r, zone);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="relatorio-agendas-${f.fromStr}-a-${f.toStr}.csv"`,
    },
  });
}
