import { Flash, PageHeader, TimezoneSelect, type Search } from "@/components/ui";
import { appUrl, requireUser } from "@/lib/auth";
import { changePassword, saveProfile } from "../actions";

export default async function Settings({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireUser();
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="Perfil" subtitle={`Sua página pública: ${appUrl()}/${profile.username}`} />
      <Flash {...sp} />
      <form action={saveProfile} className="card max-w-xl space-y-4 p-5">
        <div>
          <label className="label" htmlFor="name">Nome</label>
          <input id="name" name="name" required defaultValue={profile.name} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="username">Endereço da página</label>
          <input id="username" name="username" required pattern="[a-z0-9\-]{3,30}" defaultValue={profile.username} className="input" />
          <p className="hint">Ao trocar, os links antigos deixam de funcionar.</p>
        </div>
        <div>
          <label className="label">Fuso horário</label>
          <TimezoneSelect name="timezone" defaultValue={profile.timezone} />
          <p className="hint">Sua disponibilidade é interpretada neste fuso.</p>
        </div>
        <button className="btn">Salvar</button>
      </form>

      <h2 className="mb-2 mt-8 text-sm font-semibold">Senha</h2>
      <form action={changePassword} className="card max-w-xl space-y-4 p-5">
        <div>
          <label className="label" htmlFor="password">Nova senha</label>
          <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="input" />
        </div>
        <button className="btn-outline">Alterar senha</button>
      </form>
    </>
  );
}
