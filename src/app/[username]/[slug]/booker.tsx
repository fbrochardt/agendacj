"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";

type Props = {
  username: string;
  slug: string;
  hostName: string;
  hostTimezone: string;
  title: string;
  description: string | null;
  durationMin: number;
  windowDays: number;
  location: string;
};

const WEEK = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function zones(current: string): string[] {
  try {
    const all = Intl.supportedValuesOf("timeZone");
    return all.includes(current) ? all : [current, ...all];
  } catch {
    return [current];
  }
}

export default function Booker(p: Props) {
  const router = useRouter();
  // O fuso do visitante só existe no navegador: começa vazio para não divergir do servidor.
  const [tz, setTz] = useState<string | null>(null);
  const [month, setMonth] = useState<DateTime | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const guess = Intl.DateTimeFormat().resolvedOptions().timeZone || p.hostTimezone;
    setTz(guess);
    setMonth(DateTime.now().setZone(guess).startOf("month"));
  }, [p.hostTimezone]);

  const monthKey = month?.toFormat("yyyy-MM") ?? null;

  useEffect(() => {
    if (!tz || !monthKey) return;
    const start = DateTime.fromFormat(monthKey, "yyyy-MM", { zone: tz });
    const ctrl = new AbortController();
    setSlots(null);
    setLoadError(null);
    const q = new URLSearchParams({
      username: p.username,
      slug: p.slug,
      from: start.toUTC().toISO()!,
      to: start.plus({ months: 1 }).toUTC().toISO()!,
    });
    fetch(`/api/slots?${q}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Erro ao carregar horários.");
        setSlots(json.slots as string[]);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setLoadError(err.message);
      });
    return () => ctrl.abort();
  }, [tz, monthKey, p.username, p.slug, reload]);

  const byDay = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!tz) return map;
    for (const iso of slots ?? []) {
      const key = DateTime.fromISO(iso, { zone: tz }).toISODate()!;
      map.set(key, [...(map.get(key) ?? []), iso]);
    }
    return map;
  }, [slots, tz]);

  // Ao carregar um mês, já seleciona o primeiro dia com horário livre.
  useEffect(() => {
    if (!slots) return;
    setDay((current) => (current && byDay.has(current) ? current : (byDay.keys().next().value ?? null)));
  }, [slots, byDay]);

  if (!tz || !month) {
    return <div className="card w-full p-10 text-center text-sm text-neutral-500">Carregando horários…</div>;
  }

  const now = DateTime.now().setZone(tz);
  const canGoBack = month > now.startOf("month");
  const canGoForward = month.plus({ months: 1 }) <= now.plus({ days: p.windowDays });
  const lead = month.weekday % 7;
  const cells: (DateTime | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: month.daysInMonth! }, (_, i) => month.plus({ days: i })),
  ];
  const selected = slot ? DateTime.fromISO(slot, { zone: tz }).setLocale("pt-BR") : null;
  const daySlots = day ? (byDay.get(day) ?? []) : [];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!slot || sending) return;
    const fd = new FormData(e.currentTarget);
    setSending(true);
    setFormError(null);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: p.username,
          slug: p.slug,
          start: slot,
          timezone: tz,
          name: fd.get("name"),
          email: fd.get("email"),
          notes: fd.get("notes"),
          website: fd.get("website"),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error ?? "Não foi possível concluir o agendamento.");
        if (res.status === 409) {
          setSlot(null);
          setReload((n) => n + 1);
        }
        setSending(false);
        return;
      }
      router.push(`/booking/${json.id}?token=${json.token}&novo=1`);
    } catch {
      setFormError("Falha de conexão. Tente novamente.");
      setSending(false);
    }
  }

  return (
    <div className="card grid w-full overflow-hidden md:grid-cols-[minmax(0,260px)_1fr]">
      <aside className="border-b border-neutral-200 p-6 md:border-b-0 md:border-r">
        <Link href={`/${p.username}`} className="text-sm text-neutral-500 hover:text-neutral-900">{p.hostName}</Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{p.title}</h1>
        {p.description && <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-600">{p.description}</p>}
        <dl className="mt-4 space-y-1.5 text-sm text-neutral-700">
          <div><dt className="sr-only">Duração</dt><dd>⏱ {p.durationMin} min</dd></div>
          <div><dt className="sr-only">Local</dt><dd>📍 {p.location}</dd></div>
          {selected && (
            <div><dt className="sr-only">Horário</dt><dd className="font-medium">🗓 {selected.toFormat("cccc, dd 'de' LLLL 'às' HH:mm")}</dd></div>
          )}
        </dl>
        <label className="mt-5 block text-xs text-neutral-500">
          Fuso horário
          <select
            value={tz}
            onChange={(e) => {
              setTz(e.target.value);
              setMonth(month.setZone(e.target.value, { keepLocalTime: true }));
              setSlot(null);
            }}
            className="input mt-1"
          >
            {zones(tz).map((z) => (
              <option key={z} value={z}>{z.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
      </aside>

      {slot && selected ? (
        <form onSubmit={submit} className="space-y-4 p-6">
          <h2 className="text-sm font-semibold">Seus dados</h2>
          {formError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{formError}</p>}
          <div>
            <label className="label" htmlFor="name">Nome</label>
            <input id="name" name="name" required maxLength={120} autoComplete="name" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" required maxLength={200} autoComplete="email" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="notes">Observações (opcional)</label>
            <textarea id="notes" name="notes" rows={3} maxLength={2000} className="input" />
          </div>
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-outline" onClick={() => { setSlot(null); setFormError(null); }}>Voltar</button>
            <button className="btn" disabled={sending}>{sending ? "Agendando…" : "Confirmar agendamento"}</button>
          </div>
        </form>
      ) : (
        <div className="grid sm:grid-cols-[1fr_190px]">
          <section className="p-6">
            {formError && (
              <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{formError}</p>
            )}
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold capitalize">{month.setLocale("pt-BR").toFormat("LLLL yyyy")}</h2>
              <div className="flex gap-1">
                <button type="button" aria-label="Mês anterior" disabled={!canGoBack} onClick={() => setMonth(month.minus({ months: 1 }))} className="btn-outline px-2.5 disabled:opacity-40">‹</button>
                <button type="button" aria-label="Próximo mês" disabled={!canGoForward} onClick={() => setMonth(month.plus({ months: 1 }))} className="btn-outline px-2.5 disabled:opacity-40">›</button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEK.map((w) => (
                <div key={w} className="pb-1 text-xs uppercase text-neutral-400">{w}</div>
              ))}
              {cells.map((d, i) => {
                if (!d) return <div key={`e${i}`} />;
                const key = d.toISODate()!;
                const open = byDay.has(key);
                const active = key === day;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!open}
                    onClick={() => setDay(key)}
                    aria-pressed={active}
                    className={
                      "aspect-square rounded-md text-sm transition " +
                      (active
                        ? "bg-neutral-900 font-semibold text-white"
                        : open
                          ? "cursor-pointer bg-neutral-100 font-medium text-neutral-900 hover:bg-neutral-200"
                          : "text-neutral-300")
                    }
                  >
                    {d.day}
                  </button>
                );
              })}
            </div>
            {loadError && (
              <p role="alert" className="mt-4 text-sm text-red-700">
                {loadError}{" "}
                <button type="button" className="underline" onClick={() => setReload((n) => n + 1)}>Tentar de novo</button>
              </p>
            )}
            {slots && slots.length === 0 && !loadError && (
              <p className="mt-4 text-sm text-neutral-500">Sem horários livres neste mês.</p>
            )}
          </section>
          <section className="border-t border-neutral-200 p-6 sm:border-l sm:border-t-0">
            <h2 className="mb-3 text-sm font-semibold capitalize">
              {day ? DateTime.fromISO(day, { zone: tz }).setLocale("pt-BR").toFormat("ccc, dd/LL") : "Horários"}
            </h2>
            {slots === null && !loadError && <p className="text-sm text-neutral-400">Carregando…</p>}
            <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-1">
              {daySlots.map((iso) => (
                <button key={iso} type="button" onClick={() => { setSlot(iso); setFormError(null); }} className="btn-outline w-full">
                  {DateTime.fromISO(iso, { zone: tz }).toFormat("HH:mm")}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
