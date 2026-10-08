import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadHost } from "@/lib/booking";
import { admin } from "@/lib/supabase/admin";
import { locationText, type EventType } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const host = await loadHost((await params).username);
  return { title: host ? `Agende com ${host.name}` : "Página não encontrada" };
}

export default async function PublicProfile({ params }: Props) {
  const host = await loadHost((await params).username);
  if (!host) notFound();
  const { data } = await admin()
    .from("event_types").select("*").eq("user_id", host.id).eq("active", true).order("created_at");
  const items = (data ?? []) as EventType[];

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-neutral-900 text-xl font-semibold text-white">
          {host.name.charAt(0).toUpperCase()}
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{host.name}</h1>
        <p className="mt-1 text-sm text-neutral-500">Escolha um tipo de reunião para ver os horários disponíveis.</p>
      </div>
      <div className="card divide-y divide-neutral-200 overflow-hidden">
        {items.length === 0 && <p className="p-6 text-center text-sm text-neutral-500">Nenhum horário disponível no momento.</p>}
        {items.map((et) => (
          <Link key={et.id} href={`/${host.username}/${et.slug}`} className="block p-5 transition hover:bg-neutral-50">
            <p className="text-sm font-semibold">{et.title}</p>
            {et.description && <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{et.description}</p>}
            <p className="mt-2 text-xs text-neutral-500">
              <span className="rounded bg-neutral-100 px-1.5 py-0.5">{et.duration_min} min</span>
              <span className="ml-2">{locationText(et)}</span>
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
