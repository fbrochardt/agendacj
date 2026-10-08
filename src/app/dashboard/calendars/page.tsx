import { Flash, PageHeader, type Search } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { googleConfigured } from "@/lib/calendars/google";
import { admin } from "@/lib/supabase/admin";
import type { CalendarConnection } from "@/lib/types";
import { connectApple, disconnectCalendar, setDestination } from "../actions";

type Row = Omit<CalendarConnection, "secret">;

export default async function Calendars({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireUser();
  const sp = await searchParams;
  // As credenciais ficam só no servidor: a coluna `secret` nunca é selecionada aqui.
  const { data } = await admin()
    .from("calendar_connections")
    .select("id, user_id, provider, account, calendars, destination_calendar, is_destination, last_error")
    .eq("user_id", profile.id)
    .order("created_at");
  const rows = (data ?? []) as Row[];

  return (
    <>
      <PageHeader
        title="Agendas"
        subtitle="Os compromissos das agendas conectadas bloqueiam seus horários. Novos agendamentos são gravados na agenda de destino."
      />
      <Flash {...sp} />

      <section className="card mb-8 divide-y divide-neutral-200">
        {rows.length === 0 && <p className="p-6 text-sm text-neutral-500">Nenhuma agenda conectada ainda.</p>}
        {rows.map((c) => (
          <div key={c.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {c.provider === "google" ? "Google Agenda" : "Apple (iCloud)"}
                  {c.is_destination && (
                    <span className="ml-2 rounded-full bg-neutral-900 px-2 py-0.5 text-xs font-normal text-white">Destino</span>
                  )}
                </p>
                <p className="text-sm text-neutral-500">{c.account}</p>
              </div>
              <form action={disconnectCalendar}>
                <input type="hidden" name="id" value={c.id} />
                <button className="btn-danger">Desconectar</button>
              </form>
            </div>
            {c.last_error && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Último erro ao acessar esta agenda: {c.last_error}. Enquanto isso, os compromissos dela não estão
                bloqueando horários. Desconecte e conecte de novo se persistir.
              </p>
            )}
            <form action={setDestination} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={c.id} />
              {c.provider === "apple" && (
                <select name="calendar" defaultValue={c.destination_calendar ?? ""} className="input w-auto" aria-label="Agenda do iCloud">
                  {c.calendars.map((k) => (
                    <option key={k.url} value={k.url}>{k.name}</option>
                  ))}
                </select>
              )}
              {(!c.is_destination || c.provider === "apple") && (
                <button className="btn-outline">
                  {c.is_destination ? "Salvar agenda" : "Gravar novos agendamentos aqui"}
                </button>
              )}
            </form>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-sm font-semibold">Google Agenda</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Lê seus horários ocupados, cria os eventos e gera o link do Google Meet. O convidado recebe o convite do
            Google por e-mail.
          </p>
          {googleConfigured() ? (
            <form action="/api/google/connect" method="get" className="mt-4">
              <button className="btn">Conectar Google Agenda</button>
            </form>
          ) : (
            <p className="mt-4 rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-600">
              Falta configurar GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor (veja o README).
            </p>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold">Apple (iCloud)</h2>
          <p className="mt-1 text-sm text-neutral-500">
            A Apple não oferece login por botão para a agenda. Gere uma <strong>senha de app</strong> em{" "}
            <a href="https://account.apple.com" target="_blank" rel="noreferrer" className="underline">account.apple.com</a>{" "}
            (Início de sessão e segurança → Senhas de app) e informe abaixo. Ela é guardada criptografada e pode ser
            revogada a qualquer momento na sua conta Apple.
          </p>
          <form action={connectApple} className="mt-4 space-y-3">
            <div>
              <label className="label" htmlFor="apple_id">Apple ID (e-mail)</label>
              <input id="apple_id" name="apple_id" type="email" required autoComplete="off" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="app_password">Senha de app</label>
              <input id="app_password" name="app_password" type="password" required autoComplete="off" placeholder="xxxx-xxxx-xxxx-xxxx" className="input" />
              <p className="hint">Não é a senha normal do seu Apple ID.</p>
            </div>
            <button className="btn">Conectar agenda da Apple</button>
          </form>
        </section>
      </div>
    </>
  );
}
