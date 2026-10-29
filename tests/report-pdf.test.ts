import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { buildReportPdf } from "../src/lib/report-pdf.ts";

const t = (c: number, a: number, ok: number, x: number, s: number, p: number) =>
  ({ criados: c, agendados: a, concluidos: ok, cancelados: x, sem_desfecho: s, pendentes: p, taxa_conclusao: a - p ? ok / (a - p) : null });

test("gera PDF do relatório com acentos, várias páginas e caracteres fora do padrão", async () => {
  const ag = Array.from({ length: 140 }, (_, i) => ({
    id: `x${i}`, inicio: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T${String(9 + (i % 8)).padStart(2, "0")}:00:00.000-03:00`,
    fim: null, agenda_id: "a1", agenda: ["Raissa", "Willians Siqueira", "Felipe Vendas"][i % 3], dono: "Dono",
    titulo: i % 2 ? "Reunião online" : "Reunião presencial com conversão de financiamento muito longa", cliente: "João Conceição 😀",
    telefone: "5581999990000", email: null, observacoes: null,
    situacao: ["completed", "cancelled", "no_outcome", "upcoming"][i % 4],
    situacao_texto: ["Concluído", "Cancelado", "Sem desfecho", "Pendente"][i % 4],
    agendado_por: "Ana SDR", agendado_por_id: "s1", agendado_em: null, desfecho_por: i % 4 < 2 ? "Raissa" : null, desfecho_em: null,
  }));
  const rep = {
    periodo: { de: "2026-10-01", ate: "2026-10-31", fuso: "America/Fortaleza" },
    filtros: { agenda: null, pessoa: null },
    gerado_em: "2026-10-29T11:20:00.000-03:00",
    totais: t(150, 140, 35, 35, 35, 35),
    por_agenda: [{ agenda_id: "a1", agenda: "Raissa", dono: "Raissa", ...t(50, 47, 12, 12, 12, 11) }],
    por_pessoa: [{ pessoa_id: "s1", pessoa: "Ana SDR", funcao: "sdr", ...t(80, 70, 20, 10, 20, 20) }, { pessoa_id: null, pessoa: null, funcao: null, ...t(1, 1, 0, 0, 1, 0) }],
    por_dia: [{ dia: "2026-10-01", ...t(0, 5, 1, 1, 2, 1) }],
    agendamentos: ag,
    atividades: [{ em: "2026-10-28T10:00:00.000-03:00", acao: "rescheduled", acao_texto: "reagendou", pessoa: "Ana SDR", agenda: "Raissa", agendamento_id: "x1", titulo: "Reunião", cliente: "Erika", de: "2026-10-28T10:00:00.000-03:00", para: "2026-10-29T15:00:00.000-03:00" }],
  };
  const pdf = await buildReportPdf(rep as never);
  assert.ok(pdf.length > 3000);
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), "%PDF-");
  if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, pdf);
});
