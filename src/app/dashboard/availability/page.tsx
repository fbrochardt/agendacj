import { Flash, PageHeader, type Search } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { WEEKDAYS, type AvailabilityRule } from "@/lib/types";
import { saveAvailability } from "../actions";

const hhmm = (t?: string) => (t ? t.slice(0, 5) : "");

export default async function Availability({ searchParams }: { searchParams: Search }) {
  const { supabase, profile } = await requireUser();
  const sp = await searchParams;
  const { data } = await supabase.from("availability").select("weekday, start_time, end_time").order("start_time");
  const rules = (data ?? []) as AvailabilityRule[];

  return (
    <>
      <PageHeader
        title="Disponibilidade"
        subtitle={`Seus horários de atendimento, no fuso ${profile.timezone.replace(/_/g, " ")}. Compromissos das agendas conectadas são descontados automaticamente.`}
      />
      <Flash {...sp} />
      <form action={saveAvailability} className="card max-w-2xl divide-y divide-neutral-200">
        {WEEKDAYS.map((label, d) => {
          const day = rules.filter((r) => r.weekday === d);
          return (
            <div key={d} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <label className="flex w-28 items-center gap-2 text-sm font-medium">
                <input type="checkbox" name={`on_${d}`} defaultChecked={day.length > 0} className="size-4 accent-neutral-900" />
                {label}
              </label>
              <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-500">
                <input type="time" name={`start_${d}_a`} defaultValue={hhmm(day[0]?.start_time) || "09:00"} className="input w-28" aria-label={`${label}: início`} />
                <span>às</span>
                <input type="time" name={`end_${d}_a`} defaultValue={hhmm(day[0]?.end_time) || "17:00"} className="input w-28" aria-label={`${label}: fim`} />
                <span className="pl-1">e</span>
                <input type="time" name={`start_${d}_b`} defaultValue={hhmm(day[1]?.start_time)} className="input w-28" aria-label={`${label}: segundo início`} />
                <span>às</span>
                <input type="time" name={`end_${d}_b`} defaultValue={hhmm(day[1]?.end_time)} className="input w-28" aria-label={`${label}: segundo fim`} />
              </div>
            </div>
          );
        })}
        <div className="flex items-center justify-between gap-3 p-4">
          <p className="text-xs text-neutral-500">
            O segundo período é opcional: use para pausas, como 09:00 às 12:00 e 14:00 às 18:00.
          </p>
          <button className="btn shrink-0">Salvar</button>
        </div>
      </form>
    </>
  );
}
