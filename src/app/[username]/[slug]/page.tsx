import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadEventType } from "@/lib/booking";
import { locationText } from "@/lib/types";
import Booker from "./booker";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ username: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username, slug } = await params;
  const found = await loadEventType(username, slug);
  return { title: found ? `${found.eventType.title} · ${found.host.name}` : "Página não encontrada" };
}

export default async function BookingPage({ params }: Props) {
  const { username, slug } = await params;
  const found = await loadEventType(username, slug);
  if (!found) notFound();
  const { host, eventType: et } = found;
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-start justify-center px-4 py-8 md:items-center">
      <Booker
        username={host.username}
        slug={et.slug}
        hostName={host.name}
        hostTimezone={host.timezone}
        title={et.title}
        description={et.description}
        durationMin={et.duration_min}
        windowDays={et.window_days}
        location={locationText(et)}
      />
    </main>
  );
}
