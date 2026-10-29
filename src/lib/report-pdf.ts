import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { ReportJson } from "./report-json";

// A4 retrato, em pontos.
const W = 595.28;
const H = 841.89;
const M = 36;
const INK = rgb(0.09, 0.09, 0.09);
const MUTED = rgb(0.42, 0.42, 0.45);
const LINE = rgb(0.88, 0.88, 0.9);
const GREEN = rgb(0.02, 0.47, 0.34);
const RED = rgb(0.73, 0.11, 0.11);
const AMBER = rgb(0.71, 0.33, 0.04);
const BLUE = rgb(0.11, 0.31, 0.85);

const SITUATION_COLOR: Record<string, ReturnType<typeof rgb>> = {
  completed: GREEN,
  cancelled: RED,
  no_outcome: AMBER,
  upcoming: BLUE,
};

// As fontes padrão do PDF usam a codificação WinAnsi (acentos do português incluídos).
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
function clean(text: unknown): string {
  return [...String(text ?? "").replace(/\s+/g, " ").trim()]
    .filter((ch) => ch.charCodeAt(0) < 256 || WIN_ANSI_EXTRA.has(ch)) // emojis e afins saem
    .join("")
    .trim();
}

function fmtDate(iso: string | null, withTime = true): string {
  if (!iso) return "";
  // O ISO já vem no fuso do relatório (ex.: 2026-10-21T14:00:00.000-03:00).
  const [d, t] = iso.split("T");
  const [y, m, day] = d.split("-");
  return withTime && t ? `${day}/${m}/${y} ${t.slice(0, 5)}` : `${day}/${m}/${y}`;
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

class Writer {
  doc!: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  bold!: PDFFont;
  y = 0;
  pageNo = 0;
  footer = "";

  static async create(footer: string) {
    const w = new Writer();
    w.doc = await PDFDocument.create();
    w.font = await w.doc.embedFont(StandardFonts.Helvetica);
    w.bold = await w.doc.embedFont(StandardFonts.HelveticaBold);
    w.footer = footer;
    w.newPage();
    return w;
  }

  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.pageNo++;
    this.y = H - M;
    this.page.drawText(clean(`${this.footer} · página ${this.pageNo}`), {
      x: M, y: M / 2, size: 7, font: this.font, color: MUTED,
    });
  }

  ensure(space: number) {
    if (this.y - space < M) this.newPage();
  }

  /** Corta o texto com "…" para caber na largura. */
  fit(text: string, width: number, size: number, font = this.font): string {
    let t = clean(text);
    if (font.widthOfTextAtSize(t, size) <= width) return t;
    while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > width) t = t.slice(0, -1);
    return t + "…";
  }

  /** Quebra o texto em linhas que caibam na largura. */
  wrap(text: string, width: number, size: number, font = this.font): string[] {
    const words = clean(text).split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width && cur) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  text(t: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}) {
    const size = o.size ?? 9;
    const font = o.bold ? this.bold : this.font;
    for (const line of this.wrap(t, W - 2 * M, size, font)) {
      this.ensure(size + 4);
      this.y -= size + 2;
      this.page.drawText(line, { x: M, y: this.y, size, font, color: o.color ?? INK });
    }
    this.y -= o.gap ?? 4;
  }

  heading(t: string) {
    this.ensure(40);
    this.y -= 10;
    this.text(t, { size: 11, bold: true, gap: 6 });
  }

  rule() {
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.5, color: LINE });
  }

  /** Tabela simples: largura de cada coluna em fração, alinhamento à direita opcional. */
  table(
    cols: { title: string; w: number; right?: boolean }[],
    rows: { cells: string[]; colors?: (ReturnType<typeof rgb> | undefined)[] }[],
    size = 7.5,
  ) {
    const total = W - 2 * M;
    const widths = cols.map((c) => c.w * total);
    const rowH = size + 6;
    const header = () => {
      this.ensure(rowH * 2);
      this.y -= rowH;
      let x = M;
      cols.forEach((c, i) => {
        const t = this.fit(c.title, widths[i] - 4, size, this.bold);
        const tx = c.right ? x + widths[i] - 2 - this.bold.widthOfTextAtSize(t, size) : x + 2;
        this.page.drawText(t, { x: tx, y: this.y + 3, size, font: this.bold, color: MUTED });
        x += widths[i];
      });
      this.rule();
    };
    header();
    if (rows.length === 0) {
      this.y -= rowH;
      this.page.drawText("Nada no período.", { x: M + 2, y: this.y + 3, size, font: this.font, color: MUTED });
    }
    for (const r of rows) {
      if (this.y - rowH < M) {
        this.newPage();
        header();
      }
      this.y -= rowH;
      let x = M;
      r.cells.forEach((cell, i) => {
        const t = this.fit(cell, widths[i] - 4, size);
        const tx = cols[i].right ? x + widths[i] - 2 - this.font.widthOfTextAtSize(t, size) : x + 2;
        this.page.drawText(t, { x: tx, y: this.y + 3, size, font: this.font, color: r.colors?.[i] ?? INK });
        x += widths[i];
      });
      this.rule();
    }
    this.y -= 6;
  }
}

/** Gera o PDF do relatório a partir do mesmo JSON entregue pela API. */
export async function buildReportPdf(rep: ReportJson): Promise<Uint8Array> {
  const period = `${fmtDate(rep.periodo.de, false)} a ${fmtDate(rep.periodo.ate, false)}`;
  const w = await Writer.create(`Relatório das agendas · ${period} · gerado em ${fmtDate(rep.gerado_em)}`);
  const t = rep.totais;

  w.text("Relatório das agendas da equipe", { size: 16, bold: true, gap: 2 });
  w.text(`Período: ${period} · horários em ${rep.periodo.fuso.replace(/_/g, " ")}`, { color: MUTED, gap: 1 });
  const filters = [
    rep.filtros.agenda ? `agenda ${rep.por_agenda.find((a) => a.agenda_id === rep.filtros.agenda)?.agenda ?? rep.filtros.agenda}` : "todas as agendas",
    rep.filtros.pessoa ? `pessoa ${rep.por_pessoa.find((p) => p.pessoa_id === rep.filtros.pessoa)?.pessoa ?? rep.filtros.pessoa}` : "todas as pessoas",
  ];
  w.text(`Filtros: ${filters.join(" · ")} · gerado em ${fmtDate(rep.gerado_em)}`, { color: MUTED, gap: 10 });

  // Indicadores em caixas.
  const kpis: [string, string, ReturnType<typeof rgb>][] = [
    ["Criados", String(t.criados ?? 0), BLUE],
    ["Agendados", String(t.agendados), INK],
    ["Concluídos", String(t.concluidos), GREEN],
    ["Cancelados", String(t.cancelados), RED],
    ["Sem desfecho", String(t.sem_desfecho), AMBER],
    ["Pendentes", String(t.pendentes), INK],
    ["Conclusão", pct(t.taxa_conclusao), INK],
  ];
  const boxW = (W - 2 * M - 6 * 6) / 7;
  w.ensure(52);
  kpis.forEach(([label, value, color], i) => {
    const x = M + i * (boxW + 6);
    w.page.drawRectangle({ x, y: w.y - 46, width: boxW, height: 46, borderColor: LINE, borderWidth: 0.8 });
    w.page.drawText(clean(label), { x: x + 6, y: w.y - 14, size: 7, font: w.font, color: MUTED });
    w.page.drawText(clean(value), { x: x + 6, y: w.y - 36, size: 16, font: w.bold, color });
  });
  w.y -= 54;
  w.text(
    "Criados: pela data de cadastro. Demais números: pela data marcada da reunião. Conclusão: concluídos sobre os que já passaram.",
    { size: 7, color: MUTED, gap: 4 },
  );

  const tallyCols = [
    { title: "Nome", w: 0.3 },
    { title: "Criados", w: 0.09, right: true },
    { title: "Agendados", w: 0.1, right: true },
    { title: "Concluídos", w: 0.1, right: true },
    { title: "Cancelados", w: 0.1, right: true },
    { title: "Sem desfecho", w: 0.11, right: true },
    { title: "Pendentes", w: 0.1, right: true },
    { title: "Conclusão", w: 0.1, right: true },
  ];
  const tallyRow = (name: string, x: ReportJson["totais"]) => ({
    cells: [name, String(x.criados ?? 0), String(x.agendados), String(x.concluidos), String(x.cancelados),
      String(x.sem_desfecho), String(x.pendentes), pct(x.taxa_conclusao)],
    colors: [undefined, BLUE, undefined, GREEN, RED, AMBER, undefined, undefined],
  });
  const byCreated = <T extends { criados?: number; agendados: number }>(a: T, b: T) =>
    (b.criados ?? 0) - (a.criados ?? 0) || b.agendados - a.agendados;

  w.heading("Por agenda (vendedor)");
  w.table(tallyCols, [...rep.por_agenda].sort(byCreated).map((a) => tallyRow(a.dono ? `${a.agenda} (${a.dono})` : a.agenda, a)));

  w.heading("Por quem agendou (SDR)");
  w.table(tallyCols, [...rep.por_pessoa].sort(byCreated).map((p) =>
    tallyRow(`${p.pessoa ?? "Sem registro"}${p.funcao ? ` · ${p.funcao === "sdr" ? "SDR" : "Vendedor"}` : ""}`, p)));

  w.heading("Por dia");
  w.table(
    [
      { title: "Dia", w: 0.2 },
      { title: "Agendados", w: 0.16, right: true },
      { title: "Concluídos", w: 0.16, right: true },
      { title: "Cancelados", w: 0.16, right: true },
      { title: "Sem desfecho", w: 0.16, right: true },
      { title: "Pendentes", w: 0.16, right: true },
    ],
    rep.por_dia.map((d) => ({
      cells: [fmtDate(d.dia, false), String(d.agendados), String(d.concluidos), String(d.cancelados), String(d.sem_desfecho), String(d.pendentes)],
      colors: [undefined, undefined, GREEN, RED, AMBER, undefined],
    })),
  );

  w.heading(`Agendamentos do período (${rep.agendamentos.length})`);
  w.table(
    [
      { title: "Data", w: 0.12 },
      { title: "Agenda", w: 0.14 },
      { title: "Título", w: 0.15 },
      { title: "Cliente", w: 0.15 },
      { title: "Telefone", w: 0.11 },
      { title: "Agendado por", w: 0.12 },
      { title: "Situação", w: 0.11 },
      { title: "Desfecho por", w: 0.1 },
    ],
    rep.agendamentos.map((a) => ({
      cells: [fmtDate(a.inicio), a.agenda, a.titulo, a.cliente ?? "", a.telefone ?? "", a.agendado_por ?? "",
        a.situacao_texto, a.desfecho_por ?? ""],
      colors: [undefined, undefined, undefined, undefined, undefined, undefined, SITUATION_COLOR[a.situacao], undefined],
    })),
    7,
  );

  w.heading(`Histórico de atividades (${rep.atividades.length})`);
  w.table(
    [
      { title: "Quando", w: 0.13 },
      { title: "Quem", w: 0.16 },
      { title: "Ação", w: 0.1 },
      { title: "Agendamento", w: 0.33 },
      { title: "Agenda", w: 0.28 },
    ],
    rep.atividades.map((e) => ({
      cells: [
        fmtDate(e.em), e.pessoa ?? "—", e.acao_texto,
        [e.titulo, e.cliente].filter(Boolean).join(" · ") +
          (e.de && e.para ? ` (de ${fmtDate(e.de)} para ${fmtDate(e.para)})` : ""),
        e.agenda,
      ],
    })),
    7,
  );

  return w.doc.save();
}
