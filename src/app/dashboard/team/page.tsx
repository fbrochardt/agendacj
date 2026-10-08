import Link from "next/link";
import { Flash, PageHeader, TimezoneSelect, type Search } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";
import { addMember, removeMember, setRole } from "../actions";

export default async function Team({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAdmin();
  const sp = await searchParams;
  const { data } = await admin().from("profiles").select("*").order("created_at");
  const members = (data ?? []) as Profile[];

  return (
    <>
      <PageHeader title="Equipe" subtitle="Cada pessoa tem login, agendas e página de agendamento próprios." />
      <Flash {...sp} />

      <section className="card mb-8 divide-y divide-neutral-200">
        {members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {m.name}
                <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-normal text-neutral-600">
                  {m.role === "admin" ? "Administrador" : "Membro"}
                </span>
              </p>
              <p className="truncate text-sm text-neutral-500">
                {m.email} ·{" "}
                <Link href={`/${m.username}`} target="_blank" className="hover:text-neutral-900">/{m.username}</Link>
              </p>
            </div>
            {m.id !== profile.id && (
              <div className="flex gap-2">
                <form action={setRole}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="role" value={m.role === "admin" ? "member" : "admin"} />
                  <button className="btn-outline">{m.role === "admin" ? "Tornar membro" : "Tornar administrador"}</button>
                </form>
                <form action={removeMember}>
                  <input type="hidden" name="id" value={m.id} />
                  <button className="btn-danger">Remover</button>
                </form>
              </div>
            )}
          </div>
        ))}
      </section>

      <h2 className="mb-2 text-sm font-semibold">Adicionar usuário</h2>
      <form action={addMember} className="card max-w-2xl space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">Nome</label>
            <input id="name" name="name" required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" required autoComplete="off" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="username">Endereço da página</label>
            <input id="username" name="username" required pattern="[a-z0-9\-]{3,30}" placeholder="nome-da-pessoa" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="password">Senha provisória</label>
            <input id="password" name="password" type="text" required minLength={8} autoComplete="off" className="input" />
            <p className="hint">A pessoa pode trocar depois em Perfil.</p>
          </div>
          <div>
            <label className="label">Fuso horário</label>
            <TimezoneSelect name="timezone" defaultValue={profile.timezone} />
          </div>
          <div>
            <label className="label" htmlFor="role">Papel</label>
            <select id="role" name="role" defaultValue="member" className="input">
              <option value="member">Membro</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
        </div>
        <button className="btn">Adicionar usuário</button>
        <p className="hint">
          Remover um usuário apaga a página, os tipos de evento e o histórico dele aqui. Os eventos já gravados nas
          agendas do Google ou da Apple não são apagados.
        </p>
      </form>
    </>
  );
}
