import Link from "next/link";
import { Flash, PageHeader, type Search } from "@/components/ui";
import { listAgendas } from "@/lib/agendas";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";
import { createAgenda } from "./actions";

export default async function Agendas({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireUser();
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

  let members: Pick<Profile, "id" | "name" | "email">[] = [];
  if (isAdmin) {
    const { data } = await admin().from("profiles").select("id, name, email").order("name");
    members = data ?? [];
  }

  return (
    <>
      <PageHeader
        title="Agendas da equipe"
        subtitle={
          isAdmin
            ? "Agendas internas do app, uma para cada vendedor. Não dependem de Google nem de Apple."
            : "Agendas internas em que você é o dono. Os agendamentos são feitos pelos administradores."
        }
      />
      <Flash {...sp} />

      <section className="card mb-8 divide-y divide-neutral-200">
        {agendas.length === 0 && (
          <p className="p-6 text-sm text-neutral-500">
            {isAdmin ? "Nenhuma agenda criada ainda. Crie a primeira abaixo." : "Você ainda não é dono de nenhuma agenda."}
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
                    <option key={m.id} value={m.id}>{m.name} ({m.email})</option>
                  ))}
                </select>
                <p className="hint">
                  O dono é definido aqui e não muda depois. Falta alguém?{" "}
                  <Link href="/dashboard/team" className="underline">Adicione em Equipe</Link>.
                </p>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="description">Descrição (opcional)</label>
              <input id="description" name="description" maxLength={200} className="input" />
            </div>
            <button className="btn">Criar agenda</button>
          </form>
        </>
      )}
    </>
  );
}
