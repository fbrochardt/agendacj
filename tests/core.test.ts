import test from "node:test";
import assert from "node:assert/strict";
import { computeSlots } from "../src/lib/slots.ts";
import { buildIcs, parseBusy } from "../src/lib/calendars/ics.ts";

const tz = "America/Fortaleza"; // UTC-3
const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_time: "09:00:00", end_time: "12:00:00" }));
const now = new Date("2026-10-08T12:00:00Z"); // quinta, 09:00 local

test("gera horários no fuso de quem atende", () => {
  const slots = computeSlots({
    rules: weekdays, timezone: tz, now,
    from: new Date("2026-10-09T03:00:00Z"), to: new Date("2026-10-10T03:00:00Z"),
    durationMin: 30,
  });
  assert.equal(slots.length, 6);
  assert.equal(slots[0], "2026-10-09T12:00:00.000Z"); // 09:00 local
  assert.equal(slots.at(-1), "2026-10-09T14:30:00.000Z"); // 11:30 local
});

test("respeita antecedência mínima e fim de semana", () => {
  const slots = computeSlots({
    rules: weekdays, timezone: tz, now,
    from: new Date("2026-10-08T03:00:00Z"), to: new Date("2026-10-12T03:00:00Z"),
    durationMin: 60, minNoticeMin: 120, stepMin: 60,
  });
  // quinta: só 11:00 (09h + 2h de antecedência); sexta: 09, 10, 11; sáb/dom: nada
  assert.deepEqual(slots, [
    "2026-10-08T14:00:00.000Z",
    "2026-10-09T12:00:00.000Z",
    "2026-10-09T13:00:00.000Z",
    "2026-10-09T14:00:00.000Z",
  ]);
});

test("remove horários ocupados, com intervalo entre reuniões", () => {
  const busy = [{ start: Date.parse("2026-10-09T13:00:00Z"), end: Date.parse("2026-10-09T13:30:00Z") }];
  const base = {
    rules: weekdays, timezone: tz, now, busy,
    from: new Date("2026-10-09T03:00:00Z"), to: new Date("2026-10-10T03:00:00Z"),
    durationMin: 30,
  };
  const plain = computeSlots(base);
  assert.ok(!plain.includes("2026-10-09T13:00:00.000Z"));
  assert.ok(plain.includes("2026-10-09T12:30:00.000Z"));
  assert.ok(plain.includes("2026-10-09T13:30:00.000Z"));
  const buffered = computeSlots({ ...base, bufferMin: 15 });
  assert.ok(!buffered.includes("2026-10-09T12:30:00.000Z"));
  assert.ok(!buffered.includes("2026-10-09T13:30:00.000Z"));
  assert.ok(buffered.includes("2026-10-09T12:00:00.000Z"));
});

test("respeita a janela máxima de agendamento", () => {
  const slots = computeSlots({
    rules: weekdays, timezone: tz, now,
    from: new Date("2026-10-08T03:00:00Z"), to: new Date("2026-12-01T03:00:00Z"),
    durationMin: 30, windowDays: 2,
  });
  assert.ok(slots.every((s) => Date.parse(s) < now.getTime() + 2 * 86400000));
});

test("horário de verão: 09:00 local continua 09:00 local", () => {
  const rules = [{ weekday: 1, start_time: "09:00", end_time: "10:00" }];
  const opts = { rules, timezone: "America/New_York", now: new Date("2026-10-01T00:00:00Z"), durationMin: 60, windowDays: 90 };
  const before = computeSlots({ ...opts, from: new Date("2026-10-26T04:00:00Z"), to: new Date("2026-10-27T04:00:00Z") });
  const after = computeSlots({ ...opts, from: new Date("2026-11-02T05:00:00Z"), to: new Date("2026-11-03T05:00:00Z") });
  assert.deepEqual(before, ["2026-10-26T13:00:00.000Z"]); // EDT
  assert.deepEqual(after, ["2026-11-02T14:00:00.000Z"]); // EST
});

const VTZ = `BEGIN:VTIMEZONE
TZID:America/Fortaleza
BEGIN:STANDARD
DTSTART:19700101T000000
TZOFFSETFROM:-0300
TZOFFSETTO:-0300
TZNAME:-03
END:STANDARD
END:VTIMEZONE`;

test("ics: evento simples com fuso", () => {
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
${VTZ}
BEGIN:VEVENT
UID:a1
DTSTART;TZID=America/Fortaleza:20261009T100000
DTEND;TZID=America/Fortaleza:20261009T110000
SUMMARY:Dentista
END:VEVENT
END:VCALENDAR`;
  const busy = parseBusy(ics, new Date("2026-10-09T00:00:00Z"), new Date("2026-10-10T00:00:00Z"), tz);
  assert.deepEqual(busy, [{ start: Date.parse("2026-10-09T13:00:00Z"), end: Date.parse("2026-10-09T14:00:00Z") }]);
});

test("ics: fuso sem VTIMEZONE usa o TZID informado", () => {
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:a2
DTSTART;TZID=America/Sao_Paulo:20261009T100000
DTEND;TZID=America/Sao_Paulo:20261009T110000
END:VEVENT
END:VCALENDAR`;
  const busy = parseBusy(ics, new Date("2026-10-09T00:00:00Z"), new Date("2026-10-10T00:00:00Z"), "Asia/Tokyo");
  assert.deepEqual(busy, [{ start: Date.parse("2026-10-09T13:00:00Z"), end: Date.parse("2026-10-09T14:00:00Z") }]);
});

test("ics: recorrência semanal com exceção movida e ocorrência cancelada", () => {
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
${VTZ}
BEGIN:VEVENT
UID:r1
DTSTART;TZID=America/Fortaleza:20260105T090000
DTEND;TZID=America/Fortaleza:20260105T100000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=America/Fortaleza:20261019T090000
SUMMARY:Semanal
END:VEVENT
BEGIN:VEVENT
UID:r1
RECURRENCE-ID;TZID=America/Fortaleza:20261012T090000
DTSTART;TZID=America/Fortaleza:20261012T150000
DTEND;TZID=America/Fortaleza:20261012T160000
SUMMARY:Semanal (movida)
END:VEVENT
END:VCALENDAR`;
  const busy = parseBusy(ics, new Date("2026-10-05T03:00:00Z"), new Date("2026-10-27T03:00:00Z"), tz);
  assert.deepEqual(busy.map((b) => new Date(b.start).toISOString()), [
    "2026-10-05T12:00:00.000Z", // normal
    "2026-10-12T18:00:00.000Z", // movida para 15h
    "2026-10-26T12:00:00.000Z", // dia 19 foi excluído
  ]);
});

test("ics: ignora eventos livres e cancelados; dia inteiro ocupado bloqueia", () => {
  const mk = (extra: string) => `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:x
DTSTART;VALUE=DATE:20261009
DTEND;VALUE=DATE:20261010
${extra}
END:VEVENT
END:VCALENDAR`;
  const range = [new Date("2026-10-08T00:00:00Z"), new Date("2026-10-11T00:00:00Z")] as const;
  assert.equal(parseBusy(mk("TRANSP:TRANSPARENT"), ...range, tz).length, 0);
  assert.equal(parseBusy(mk("STATUS:CANCELLED"), ...range, tz).length, 0);
  assert.deepEqual(parseBusy(mk("TRANSP:OPAQUE"), ...range, tz), [
    { start: Date.parse("2026-10-09T03:00:00Z"), end: Date.parse("2026-10-10T03:00:00Z") },
  ]);
});

test("ics gerado é lido de volta", () => {
  const ics = buildIcs({
    uid: "b1", start: new Date("2026-10-09T13:00:00Z"), end: new Date("2026-10-09T13:30:00Z"),
    summary: "Reunião; com, vírgula", description: "linha 1\nlinha 2 " + "x".repeat(120), location: "Google Meet",
  });
  assert.ok(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75));
  const busy = parseBusy(ics, new Date("2026-10-09T00:00:00Z"), new Date("2026-10-10T00:00:00Z"), tz);
  assert.deepEqual(busy, [{ start: Date.parse("2026-10-09T13:00:00Z"), end: Date.parse("2026-10-09T13:30:00Z") }]);
});
