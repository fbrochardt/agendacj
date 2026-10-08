import { redirect } from "next/navigation";
import { Flash, TimezoneSelect, type Search } from "@/components/ui";
import { admin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createUser } from "@/lib/users";

export const dynamic = "force-dynamic";

async function hasUsers(): Promise<boolean> {
  const { count, error } = await admin().from("profiles").select("id", { count: "exact", head: true });
  if (error) throw new Error("Banco não configurado: rode supabase/migrations/0001_init.sql. " + error.message);
  return Boolean(count);
}

async function createAdmin(fd: FormData) {
  "use server";
  // A instalação só pode ser feita uma vez: depois disso, só o admin cria usuários.
  if (await hasUsers()) redirect("/login");
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  const { error } = await createUser({
    name: String(fd.get("name") ?? ""),
    email,
    username: String(fd.get("username") ?? ""),
    password,
    role: "admin",
    timezone: String(fd.get("timezone") ?? ""),
  });
  if (error) redirect("/setup?error=" + encodeURIComponent(error));
  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email, password });
  redirect("/dashboard");
}

export default async function Setup({ searchParams }: { searchParams: Search }) {
  if (await hasUsers()) redirect("/login");
  const sp = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Vamos configurar sua agenda</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Crie a conta de administrador. Depois você adiciona o restante da equipe pelo painel.
      </p>
      <Flash {...sp} />
      <form action={createAdmin} className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="name">Seu nome</label>
          <input id="name" name="name" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="username">Endereço da sua página</label>
          <input id="username" name="username" required pattern="[a-z0-9\-]{3,30}" placeholder="seu-nome" className="input" />
          <p className="hint">Letras minúsculas, números e hífen. Sua página ficará em /seu-nome.</p>
        </div>
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password">Senha</label>
          <input id="password" name="password" type="password" required minLength={8} className="input" />
        </div>
        <div>
          <label className="label">Fuso horário</label>
          <TimezoneSelect name="timezone" defaultValue="America/Fortaleza" />
        </div>
        <button className="btn w-full">Criar conta de administrador</button>
      </form>
    </main>
  );
}
