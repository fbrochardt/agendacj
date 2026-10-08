import Link from "next/link";
import { Flash, PageHeader, type Search } from "@/components/ui";
import { appUrl, requireUser } from "@/lib/auth";
import { locationText, type EventType } from "@/lib/types";

export default async function EventTypes({ searchParams }: { searchParams: Search }) {
  const { supabase, profile } = await requireUser();
  const sp = await searchParams;
  const { data } = await supabase.from("event_types").select("*").order("created_at");
  const items = (data ?? []) as EventType[];
  return (
    <>
      <PageHeader
        title="Tipos de evento"
        subtitle="Cada tipo tem um link próprio para você compartilhar."
        action={<Link href="/dashboard/event-types/new" className="btn">Novo tipo de evento</Link>}
      />
      <Flash {...sp} />
      <section className="card divide-y divide-neutral-200">
        {items.length === 0 && <p className="p-6 text-sm text-neutral-500">Você ainda não tem tipos de evento.</p>}
        {items.map((et) => {
          const path = `/${profile.username}/${et.slug}`;
          return (
            <div key={et.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {et.title}
                  {!et.active && (
                    <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-normal text-neutral-500">Oculto</span>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-neutral-500">
                  {et.duration_min} min · {locationText(et)}
                </p>
                <p className="mt-0.5 truncate text-xs text-neutral-400">{appUrl() + path}</p>
              </div>
              <div className="flex gap-2">
                <Link href={path} target="_blank" className="btn-outline">Ver página</Link>
                <Link href={`/dashboard/event-types/${et.id}`} className="btn-outline">Editar</Link>
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}
