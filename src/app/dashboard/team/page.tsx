import Link from "next/link";
import { Flash, PageHeader, TimezoneSelect, type Search } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { JOB_LABELS, ROLE_LABELS, type Profile } from "@/lib/types";
import { addMember, removeMember, setJob, setRole } from "../actions";

export default async function Team({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAdmin();
  const sp = await searchParams;
  const { data } = await admin().from("profiles").select("*").order("name");
  const members = (data ?? []) as Profile[];

  return (
    <>
      <PageHeader
        title="Equipe"
        subtitle="Administradores acessam todo o sistema. SDRs agendam, reagendam e cancelam em todas as agendas. Os demais usuários acessam só as agendas atribuídas a eles."
      />
      <Flash {...sp} />

      <section className="card mb-8 divide-y divide-neutral-200">
        {members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {m.name}
                <span
                  className={
                    "ml-2 rounded-full px-2 py-0.5 text-xs font-normal " +
                    (m.role === "admin" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600")
                  }
                >
                  {ROLE_LABELS[m.role]}
                </span>
                {m.job && (
                  <span className="ml-1.5 rounded-full border border-neutral-200 px-2 py-0.5 text-xs font-normal text-neutral-600">
                    {JOB_LABELS[m.job]}
                  </span>
                )}
              </p>
              <p className="truncate text-sm text-neutral-500">
                {m.email} ·{" "}
                <Link href={`/${m.username}`} target="_blank" className="hover:text-neutral-900">/{m.username}</Link>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <form action={setJob} className="flex items-center gap-2">
                <input type="hidden" name="id" value={m.id} />
                <select name="job" defaultValue={m.job ?? ""} className="input w-auto py-1.5" aria-label={`Função de ${m.name}`}>
                  <option value="">Sem função</option>
                  <option value="vendedor">Vendedor</option>
                  <option value="sdr">SDR</option>
                </select>
                <button className="btn-outline py-1.5">Salvar</button>
              </form>
              {m.id !== profile.id && (
                <>
                  <form action={setRole}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="role" value={m.role === "admin" ? "member" : "admin"} />
                    <button className="btn-outline py-1.5">{m.role === "admin" ? "Tornar usuário" : "Tornar administrador"}</button>
                  </form>
                  <form action={removeMember}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="btn-danger">Remover</button>
                  </form>
                </>
              )}
            </div>
          </div>
        ))}
      </section>

      <h2 className="mb-2 text-sm font-semibold">Adicionar pessoa</h2>
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
            <label className="label" htmlFor="job">Função</label>
            <select id="job" name="job" defaultValue="vendedor" className="input">
              <option value="vendedor">Vendedor</option>
              <option value="sdr">SDR</option>
              <option value="">Sem função</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="role">Nível de acesso</label>
            <select id="role" name="role" defaultValue="member" className="input">
              <option value="member">Usuário (só agendas atribuídas)</option>
              <option value="admin">Administrador (todo o sistema)</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Fuso horário</label>
            <TimezoneSelect name="timezone" defaultValue={profile.timezone} />
          </div>
        </div>
        <button className="btn">Adicionar pessoa</button>
        <p className="hint">
          Depois de criar, atribua as agendas que a pessoa pode acessar na tela de cada agenda, em Agendas da equipe.
          Remover alguém apaga a página, os tipos de evento e as agendas de que ela é dona.
        </p>
      </form>
    </>
  );
}
