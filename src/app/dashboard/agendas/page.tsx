import Link from "next/link";
import { Flash, PageHeader, type Search } from "@/components/ui";
import { listAgendas } from "@/lib/agendas";
import { requireAdmin } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { JOB_LABELS, type Profile } from "@/lib/types";
import { createAgenda } from "./actions";

export default async function Agendas({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAdmin();
  const sp = await searchParams;
  const isAdmin = profile.role === "admin";
  const agendas = await listAgendas(profile);

  // Próximos agendamentos por agenda, para o resumo da lista.
  const counts = new Map<string, number>();
  if (agendas.length) {
    const { data } = await admin()
      .from("appointments").select("agenda_id").eq("status", "confirmed")
      .gte("end_at", new Date().toISOString()).in("agenda_id", agendas.map((a) => a.id));
    for (const row of data ?? []) counts.set(row.agenda_id, (counts.get(row.agenda_id) ?? 0) + 1);
  }

  let members: Pick<Profile, "id" | "name" | "email" | "job">[] = [];
  let googleAccounts: { id: string; account: string }[] = [];
  if (isAdmin) {
    const { data } = await admin().from("profiles").select("id, name, email, job").order("name");
    const g = await admin().from("calendar_connections").select("id, account").eq("provider", "google").order("account");
    googleAccounts = (g.data ?? []) as { id: string; account: string }[];
    members = data ?? [];
  }

  return (
    <>
      <PageHeader
        title="Agendas da equipe"
        subtitle={
          isAdmin
            ? "Agendas internas do app, uma para cada vendedor. Não dependem de Google nem de Apple."
            : "Agendas atribuídas a você pelos administradores. Você pode marcar e cancelar horários nelas."
        }
      />
      <Flash {...sp} />

      <section className="card mb-8 divide-y divide-neutral-200">
        {agendas.length === 0 && (
          <p className="p-6 text-sm text-neutral-500">
            {isAdmin ? "Nenhuma agenda criada ainda. Crie a primeira abaixo." : "Nenhuma agenda foi atribuída a você ainda. Fale com um administrador."}
          </p>
        )}
        {agendas.map((a) => {
          const n = counts.get(a.id) ?? 0;
          return (
            <Link key={a.id} href={`/dashboard/agendas/${a.id}`} className="flex items-center justify-between gap-3 p-4 transition hover:bg-neutral-50">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{a.name}</p>
                <p className="truncate text-sm text-neutral-500">
                  Dono: {a.owner?.name ?? "usuário removido"}
                  {a.description ? ` · ${a.description}` : ""}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600">
                {n === 0 ? "Sem agendamentos" : n === 1 ? "1 por vir" : `${n} por vir`}
              </span>
            </Link>
          );
        })}
      </section>

      {isAdmin && (
        <>
          <h2 className="mb-2 text-sm font-semibold">Criar agenda</h2>
          <form action={createAgenda} className="card max-w-2xl space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="name">Nome da agenda</label>
                <input id="name" name="name" required maxLength={80} placeholder="Agenda do João" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="owner_id">Dono</label>
                <select id="owner_id" name="owner_id" required defaultValue="" className="input">
                  <option value="" disabled>Escolha um usuário</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}{m.job ? ` · ${JOB_LABELS[m.job]}` : ""} ({m.email})</option>
                  ))}
                </select>
                <p className="hint">
                  O dono é definido aqui e não muda depois, e já tem acesso à agenda. Outras pessoas você libera na tela da agenda. Falta alguém?{" "}
                  <Link href="/dashboard/team" className="underline">Adicione em Equipe</Link>.
                </p>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="description">Descrição (opcional)</label>
              <input id="description" name="description" maxLength={200} className="input" />
            </div>
            {googleAccounts.length > 0 ? (
              <div className="rounded-md border border-neutral-200 p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" name="google_create" defaultChecked className="size-4 accent-neutral-900" />
                  Criar também no Google Agenda
                </label>
                {googleAccounts.length > 1 ? (
                  <select name="google_connection_id" defaultValue={googleAccounts[0].id} className="input mt-2" aria-label="Conta Google">
                    {googleAccounts.map((g) => <option key={g.id} value={g.id}>{g.account}</option>)}
                  </select>
                ) : (
                  <input type="hidden" name="google_connection_id" value={googleAccounts[0].id} />
                )}
                <p className="hint">
                  Cria uma agenda com o mesmo nome {googleAccounts.length > 1 ? "na conta escolhida" : `em ${googleAccounts[0].account}`} e já
                  liga as duas: os agendamentos daqui vão aparecer lá.
                </p>
              </div>
            ) : (
              <p className="hint">Conecte uma conta em Google e Apple para criar a agenda também no Google Agenda.</p>
            )}
            <button className="btn">Criar agenda</button>
          </form>
        </>
      )}
    </>
  );
}
