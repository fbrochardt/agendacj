"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Upcoming = {
  id: string;
  title: string;
  start_at: string;
  client_name: string | null;
  agenda_name: string;
  agenda_id: string;
};

const LEAD_MS = 10 * 60_000; // avisa quando faltarem 10 minutos
const POLL_MS = 30_000;
const ENABLED_KEY = "agenda-alertas-ativos";
const SEEN_KEY = "agenda-alertas-avisados";

function readSeen(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, number>;
    const cutoff = Date.now() - 24 * 3600_000;
    return Object.fromEntries(Object.entries(raw).filter(([, t]) => t > cutoff));
  } catch {
    return {};
  }
}

function writeSeen(seen: Record<string, number>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* sem armazenamento: pode repetir o aviso ao recarregar */
  }
}

/** Toca um "plim-plim" curto com a Web Audio API (sem arquivo de áudio). */
function chime(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  [0, 0.35, 0.7].forEach((offset, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = i === 1 ? 660 : 880;
    gain.gain.setValueAtTime(0.0001, t0 + offset);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + offset);
    osc.stop(t0 + offset + 0.32);
  });
}

export default function AppointmentAlerts() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [active, setActive] = useState<Upcoming[]>([]);
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    let on = false;
    try {
      on = localStorage.getItem(ENABLED_KEY) === "1";
    } catch {
      /* ignora */
    }
    setEnabled(on);
  }, []);

  const ensureAudio = useCallback(() => {
    if (!audio.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio.current = new Ctor();
    }
    if (audio.current.state === "suspended") void audio.current.resume();
    return audio.current;
  }, []);

  // O navegador só libera o som depois de um clique na página: reaproveita qualquer clique.
  useEffect(() => {
    if (!enabled) return;
    const unlock = () => ensureAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, [enabled, ensureAudio]);

  const check = useCallback(async () => {
    let data: { upcoming: Upcoming[] };
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (!res.ok) return;
      data = await res.json();
    } catch {
      return;
    }
    const now = Date.now();
    const seen = readSeen();
    const due = data.upcoming.filter((a) => {
      const left = Date.parse(a.start_at) - now;
      return left > 0 && left <= LEAD_MS && !seen[a.id];
    });
    if (due.length === 0) return;

    for (const a of due) seen[a.id] = now;
    writeSeen(seen);
    setActive((cur) => [...cur.filter((c) => !due.some((d) => d.id === c.id)), ...due]);

    try {
      chime(ensureAudio());
    } catch {
      /* som bloqueado pelo navegador: o aviso visual continua */
    }
    if ("Notification" in window && Notification.permission === "granted") {
      for (const a of due) {
        const hhmm = new Date(a.start_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        new Notification(`Começa às ${hhmm}: ${a.title}`, {
          body: `${hhmm}${a.client_name ? ` · ${a.client_name}` : ""} · ${a.agenda_name}`,
          tag: a.id,
        });
      }
    }
  }, [ensureAudio]);

  useEffect(() => {
    if (!enabled) return;
    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, check]);

  async function turnOn() {
    try {
      localStorage.setItem(ENABLED_KEY, "1");
    } catch {
      /* ignora */
    }
    try {
      chime(ensureAudio()); // toca uma vez para confirmar e liberar o som
    } catch {
      /* ignora */
    }
    if ("Notification" in window && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        /* ignora */
      }
    }
    setEnabled(true);
  }

  function turnOff() {
    try {
      localStorage.removeItem(ENABLED_KEY);
    } catch {
      /* ignora */
    }
    setEnabled(false);
  }

  if (enabled === null) return null;

  return (
    <>
      <div className="mt-4 text-xs">
        {enabled ? (
          <button type="button" onClick={turnOff} className="cursor-pointer text-neutral-500 hover:text-neutral-900">
            🔔 Alertas ativos · desativar
          </button>
        ) : (
          <button
            type="button"
            onClick={turnOn}
            className="cursor-pointer rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 hover:bg-amber-100"
          >
            🔔 Ativar alertas sonoros
          </button>
        )}
      </div>

      {active.length > 0 && (
        <div className="fixed inset-x-4 bottom-4 z-50 space-y-2 sm:left-auto sm:right-4 sm:w-96" role="alert">
          {active.map((a) => {
            const hhmm = new Date(a.start_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
            const left = Math.max(0, Math.ceil((Date.parse(a.start_at) - Date.now()) / 60_000));
            return (
              <div key={a.id} className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-lg">
                <p className="text-sm font-semibold text-amber-900">🔔 Começa às {hhmm} (faltam {left} min)</p>
                <p className="mt-1 text-sm text-amber-900">
                  {a.title}
                  {a.client_name ? ` · ${a.client_name}` : ""}
                </p>
                <p className="text-xs text-amber-800">{a.agenda_name}</p>
                <div className="mt-3 flex gap-2">
                  <Link href={`/dashboard/agendas/${a.agenda_id}`} className="btn-outline py-1.5">Abrir agenda</Link>
                  <button
                    type="button"
                    className="btn py-1.5"
                    onClick={() => setActive((cur) => cur.filter((c) => c.id !== a.id))}
                  >
                    Ok
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
