import { redirect } from "next/navigation";
import { Flash, type Search } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function signIn(fd: FormData) {
  "use server";
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(fd.get("email") ?? "").trim(),
    password: String(fd.get("password") ?? ""),
  });
  if (error) redirect("/login?error=" + encodeURIComponent("E-mail ou senha incorretos."));
  redirect("/dashboard");
}

export default async function Login({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Entrar</h1>
      <p className="mb-6 text-sm text-neutral-500">Acesse o painel da sua agenda.</p>
      <Flash {...sp} />
      <form action={signIn} className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" required autoComplete="email" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password">Senha</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" className="input" />
        </div>
        <button className="btn w-full">Entrar</button>
      </form>
      <p className="mt-4 text-center text-xs text-neutral-500">
        Sem acesso? Peça ao administrador da sua equipe para criar o seu usuário.
      </p>
    </main>
  );
}
