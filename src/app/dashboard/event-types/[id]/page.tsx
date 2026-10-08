import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, PageHeader, type Search } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { LOCATION_LABELS, type EventType } from "@/lib/types";
import { deleteEventType, saveEventType } from "../../actions";

export default async function EditEventType({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Search;
}) {
  const { supabase, profile } = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const isNew = id === "new";
  let et: EventType | null = null;
  if (!isNew) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const { data } = await supabase.from("event_types").select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    et = data as EventType;
  }

  return (
    <>
      <PageHeader
        title={isNew ? "Novo tipo de evento" : "Editar tipo de evento"}
        action={<Link href="/dashboard/event-types" className="btn-outline">Voltar</Link>}
      />
      <Flash {...sp} />
      <form action={saveEventType} className="card max-w-2xl space-y-5 p-5">
        {et && <input type="hidden" name="id" value={et.id} />}
        <div>
          <label className="label" htmlFor="title">Título</label>
          <input id="title" name="title" required defaultValue={et?.title ?? ""} placeholder="Reunião de 30 min" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="slug">Endereço</label>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm text-neutral-500">/{profile.username}/</span>
            <input id="slug" name="slug" defaultValue={et?.slug ?? ""} placeholder="30min" className="input" />
          </div>
          <p className="hint">Deixe em branco para gerar a partir do título.</p>
        </div>
        <div>
          <label className="label" htmlFor="description">Descrição</label>
          <textarea id="description" name="description" rows={3} defaultValue={et?.description ?? ""} className="input" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="duration_min">Duração (minutos)</label>
            <input id="duration_min" name="duration_min" type="number" min={5} max={480} step={5} required defaultValue={et?.duration_min ?? 30} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="buffer_min">Intervalo entre reuniões (minutos)</label>
            <input id="buffer_min" name="buffer_min" type="number" min={0} max={240} step={5} defaultValue={et?.buffer_min ?? 0} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="min_notice_hours">Antecedência mínima (horas)</label>
            <input id="min_notice_hours" name="min_notice_hours" type="number" min={0} max={720} defaultValue={Math.round((et?.min_notice_min ?? 120) / 60)} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="window_days">Aceitar reservas até (dias à frente)</label>
            <input id="window_days" name="window_days" type="number" min={1} max={365} defaultValue={et?.window_days ?? 60} className="input" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="location_type">Local</label>
            <select id="location_type" name="location_type" defaultValue={et?.location_type ?? "google_meet"} className="input">
              {Object.entries(LOCATION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <p className="hint">Google Meet gera o link automaticamente e exige uma conta Google conectada.</p>
          </div>
          <div>
            <label className="label" htmlFor="location_value">Endereço, telefone ou link</label>
            <input id="location_value" name="location_value" defaultValue={et?.location_value ?? ""} className="input" />
            <p className="hint">Usado quando o local não é Google Meet.</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={et?.active ?? true} className="size-4 accent-neutral-900" />
          Visível na minha página pública
        </label>
        <button className="btn">Salvar</button>
      </form>

      {et && (
        <form action={deleteEventType} className="mt-6 max-w-2xl">
          <input type="hidden" name="id" value={et.id} />
          <button className="btn-danger">Excluir este tipo de evento</button>
          <p className="hint">Agendamentos já feitos continuam valendo.</p>
        </form>
      )}
    </>
  );
}
