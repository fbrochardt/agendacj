import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  const links = [
    { href: "/dashboard", label: "Agendamentos" },
    { href: "/dashboard/event-types", label: "Tipos de evento" },
    { href: "/dashboard/availability", label: "Disponibilidade" },
    { href: "/dashboard/agendas", label: "Agendas da equipe" },
    { href: "/dashboard/calendars", label: "Google e Apple" },
    ...(profile.role === "admin" ? [{ href: "/dashboard/team", label: "Equipe" }] : []),
    { href: "/dashboard/settings", label: "Perfil" },
  ];
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col md:flex-row">
      <aside className="shrink-0 border-b border-neutral-200 px-4 py-4 md:w-56 md:border-b-0 md:border-r md:py-8">
        <div className="mb-4 flex items-center justify-between md:block">
          <div>
            <p className="text-sm font-semibold">{profile.name}</p>
            <Link href={`/${profile.username}`} target="_blank" className="text-xs text-neutral-500 hover:text-neutral-900">
              /{profile.username} ↗
            </Link>
          </div>
        </div>
        <nav className="-mx-1 flex gap-1 overflow-x-auto md:flex-col">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-neutral-700 hover:bg-neutral-200/70 hover:text-neutral-900"
            >
              {l.label}
            </Link>
          ))}
          <form action={signOut}>
            <button className="w-full cursor-pointer whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-200/70">
              Sair
            </button>
          </form>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">{children}</main>
    </div>
  );
}
