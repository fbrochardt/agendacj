import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { IANAZone } from "luxon";
import { buildReportJson } from "@/lib/report-json";
import { buildReportPdf } from "@/lib/report-pdf";
import { buildReportCsv, loadReport, parseFilters } from "@/lib/reports";

export const dynamic = "force-dynamic";

/**
 * Relatório das agendas da equipe via HTTP.
 *
 *   GET /api/v1/relatorio?de=2026-10-01&ate=2026-10-31&agenda=<id>&pessoa=<id>&formato=json|csv|pdf&fuso=America/Fortaleza
 *   Authorization: Bearer <REPORTS_API_TOKEN>
 */
function authorized(req: Request): boolean {
  const expected = process.env.REPORTS_API_TOKEN;
  if (!expected || expected.length < 24) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  // Compara resumos de tamanho fixo para não vazar informação pelo tempo de resposta.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return given.length > 0 && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!process.env.REPORTS_API_TOKEN) {
    return NextResponse.json({ erro: "API de relatórios desativada: defina REPORTS_API_TOKEN no servidor." }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ erro: "Não autorizado. Envie o cabeçalho Authorization: Bearer <chave>." }, { status: 401 });
  }

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const zone = sp.fuso && IANAZone.isValidZone(sp.fuso) ? sp.fuso : "America/Fortaleza";
  const f = parseFilters(sp, zone);
  let r: Awaited<ReturnType<typeof loadReport>>;
  try {
    r = await loadReport(f);
  } catch (err) {
    console.error("api relatorio", err);
    return NextResponse.json({ erro: "Falha ao montar o relatório." }, { status: 500 });
  }

  if (sp.formato === "csv") {
    return new Response(buildReportCsv(r, zone), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="relatorio-agendas-${f.fromStr}-a-${f.toStr}.csv"`,
      },
    });
  }

  const body = buildReportJson(r, f, zone);
  if (sp.formato === "pdf") {
    const pdf = await buildReportPdf(body);
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="relatorio-agendas-${f.fromStr}-a-${f.toStr}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
