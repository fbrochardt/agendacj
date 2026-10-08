"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { isUuid } from "@/lib/agendas";
import { requireAdmin } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";

const LIST = "/dashboard/agendas";
const s = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? "").trim().slice(0, max);
const go = (path: string, key: "ok" | "error", msg: string): never => {
  const sep = path.includes("?") ? "&" : "?";
  return redirect(`${path}${sep}${key}=${encodeURIComponent(msg)}`);
};

export async function createAgenda(fd: FormData) {
  const { profile } = await requireAdmin();
  const name = s(fd, "name", 80);
  const owner_id = s(fd, "owner_id");
  if (!name) go(LIST, "error", "Dê um nome para a agenda.");
  if (!isUuid(owner_id)) go(LIST, "error", "Escolha o dono da agenda.");
  const db = admin();
  const owner = await db.from("profiles").select("id").eq("id", owner_id).maybeSingle();
  if (!owner.data) go(LIST, "error", "Usuário não encontrado.");
  const { data, error } = await db
    .from("agendas")
    .insert({ name, owner_id, description: s(fd, "description") || null, created_by: profile.id })
    .select("id")
    .single();
  if (error) go(LIST, "error", error.message);
  revalidatePath(LIST);
  go(`${LIST}/${data!.id}`, "ok", "Agenda criada.");
}

export async function renameAgenda(fd: FormData) {
  await requireAdmin();
  const id = s(fd, "id");
  const back = `${LIST}/${id}`;
  if (!isUuid(id)) go(LIST, "error", "Agenda não encontrada.");
  const name = s(fd, "name", 80);
  if (!name) go(back, "error", "Dê um nome para a agenda.");
  const { error } = await admin()
    .from("agendas").update({ name, description: s(fd, "description") || null }).eq("id", id);
  if (error) go(back, "error", error.message);
  revalidatePath(LIST);
  go(back, "ok", "Agenda atualizada.");
}

export async function deleteAgenda(fd: FormData) {
  await requireAdmin();
  const id = s(fd, "id");
  if (!isUuid(id)) go(LIST, "error", "Agenda não encontrada.");
  // Proteção contra clique acidental: o nome precisa ser digitado igual.
  const { data } = await admin().from("agendas").select("name").eq("id", id).maybeSingle();
  if (!data) go(LIST, "error", "Agenda não encontrada.");
  if (s(fd, "confirm", 80) !== data!.name) {
    go(`${LIST}/${id}`, "error", "Para excluir, digite o nome da agenda exatamente como aparece.");
  }
  const { error } = await admin().from("agendas").delete().eq("id", id);
  if (error) go(`${LIST}/${id}`, "error", error.message);
  revalidatePath(LIST);
  go(LIST, "ok", "Agenda excluída.");
}

export async function createAppointment(fd: FormData) {
  const { profile } = await requireAdmin();
  const agendaId = s(fd, "agenda_id");
  if (!isUuid(agendaId)) go(LIST, "error", "Agenda não encontrada.");
  const date = s(fd, "date");
  const back = `${LIST}/${agendaId}${/^\d{4}-\d{2}-\d{2}$/.test(date) ? `?dia=${date}` : ""}`;

  const db = admin();
  const agenda = await db.from("agendas").select("id, owner_id").eq("id", agendaId).maybeSingle();
  if (!agenda.data) go(LIST, "error", "Agenda não encontrada.");
  const owner = await db.from("profiles").select("timezone").eq("id", agenda.data!.owner_id).maybeSingle();
  const zone = owner.data?.timezone ?? "America/Fortaleza";

  const title = s(fd, "title", 120);
  const duration = Math.round(Number(fd.get("duration_min")));
  // Data e hora são interpretadas no fuso do dono da agenda.
  const start = DateTime.fromFormat(`${date} ${s(fd, "time")}`, "yyyy-MM-dd HH:mm", { zone });
  if (!title) go(back, "error", "Informe o título do agendamento.");
  if (!start.isValid) go(back, "error", "Informe data e horário válidos.");
  if (!Number.isFinite(duration) || duration < 5 || duration > 720) {
    go(back, "error", "A duração deve ficar entre 5 e 720 minutos.");
  }

  const { error } = await db.from("appointments").insert({
    agenda_id: agendaId,
    title,
    start_at: start.toUTC().toISO(),
    end_at: start.plus({ minutes: duration }).toUTC().toISO(),
    client_name: s(fd, "client_name", 120) || null,
    client_phone: s(fd, "client_phone", 40) || null,
    client_email: s(fd, "client_email", 200) || null,
    notes: s(fd, "notes", 2000) || null,
    created_by: profile.id,
  });
  if (error) {
    go(back, "error", error.code === "23P01" ? "Já existe um agendamento nesse horário nesta agenda." : error.message);
  }
  revalidatePath(`${LIST}/${agendaId}`);
  go(back, "ok", `Agendado para ${start.setLocale("pt-BR").toFormat("dd/LL 'às' HH:mm")}.`);
}

export async function cancelAppointment(fd: FormData) {
  await requireAdmin();
  const id = s(fd, "id");
  const agendaId = s(fd, "agenda_id");
  const dia = s(fd, "dia");
  const back = `${LIST}/${agendaId}${/^\d{4}-\d{2}-\d{2}$/.test(dia) ? `?dia=${dia}` : ""}`;
  if (!isUuid(id) || !isUuid(agendaId)) go(LIST, "error", "Agendamento não encontrado.");
  const { error } = await admin()
    .from("appointments").update({ status: "cancelled" }).eq("id", id).eq("agenda_id", agendaId);
  if (error) go(back, "error", error.message);
  revalidatePath(`${LIST}/${agendaId}`);
  go(back, "ok", "Agendamento cancelado.");
}
