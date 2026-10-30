"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { logActivity } from "@/lib/activity";
import { canAccessAgenda, isUuid } from "@/lib/agendas";
import { createGoogleCalendar, listGoogleCalendars, syncAppointmentToGoogle, syncUpcomingForAgenda } from "@/lib/google-sync";
import { requireAdmin, requireUser } from "@/lib/auth";
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
  const owner = await db.from("profiles").select("id, timezone").eq("id", owner_id).maybeSingle();
  if (!owner.data) go(LIST, "error", "Usuário não encontrado.");
  const googleConn = fd.get("google_create") === "on" ? s(fd, "google_connection_id") : "";
  const { data, error } = await db
    .from("agendas")
    .insert({ name, owner_id, description: s(fd, "description") || null, created_by: profile.id })
    .select("id")
    .single();
  if (error) go(LIST, "error", error.message);
  revalidatePath(LIST);
  const back = `${LIST}/${data!.id}`;

  // Cria também a agenda no Google e já deixa as duas ligadas.
  if (isUuid(googleConn)) {
    const g = await createGoogleCalendar(googleConn, name, (owner.data!.timezone as string) ?? "America/Fortaleza");
    if (g.id) {
      await db.from("agendas").update({ google_connection_id: googleConn, google_calendar_id: g.id, google_calendar_name: name })
        .eq("id", data!.id);
      go(back, "ok", `Agenda criada no app e no Google Agenda (“${name}”), já sincronizadas.`);
    }
    go(back, "error", g.needsReconnect
      ? "Agenda criada no app, mas não no Google: reconecte a conta Google em “Google e Apple” para liberar a criação de agendas e depois ligue esta agenda abaixo."
      : `Agenda criada no app, mas não no Google (${g.error}). Você pode ligar uma agenda do Google abaixo.`);
  }
  go(back, "ok", "Agenda criada.");
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
  // Tira do Google os eventos de hoje em diante antes de apagar a agenda.
  await admin().from("agendas").update({ google_connection_id: null, google_calendar_id: null }).eq("id", id);
  await syncUpcomingForAgenda(id);
  const { error } = await admin().from("agendas").delete().eq("id", id);
  if (error) go(`${LIST}/${id}`, "error", error.message);
  revalidatePath(LIST);
  go(LIST, "ok", "Agenda excluída.");
}

export async function createAppointment(fd: FormData) {
  const { profile } = await requireUser();
  const agendaId = s(fd, "agenda_id");
  if (!isUuid(agendaId)) go(LIST, "error", "Agenda não encontrada.");
  const date = s(fd, "date");
  const back = `${LIST}/${agendaId}${/^\d{4}-\d{2}-\d{2}$/.test(date) ? `?dia=${date}` : ""}`;

  const db = admin();
  const agenda = await db.from("agendas").select("id, owner_id").eq("id", agendaId).maybeSingle();
  if (!agenda.data || !(await canAccessAgenda(profile, agenda.data))) go(LIST, "error", "Agenda não encontrada.");
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

  const { data: created, error } = await db.from("appointments").insert({
    agenda_id: agendaId,
    title,
    start_at: start.toUTC().toISO(),
    end_at: start.plus({ minutes: duration }).toUTC().toISO(),
    client_name: s(fd, "client_name", 120) || null,
    client_phone: s(fd, "client_phone", 40) || null,
    client_email: s(fd, "client_email", 200) || null,
    notes: s(fd, "notes", 2000) || null,
    created_by: profile.id,
  }).select("id").single();
  if (error) {
    go(back, "error", error.code === "23P01" ? "Já existe um agendamento nesse horário nesta agenda." : error.message);
  }
  await logActivity({ appointmentId: created!.id, agendaId, actorId: profile.id, action: "created" });
  await syncAppointmentToGoogle(created!.id);
  revalidatePath(`${LIST}/${agendaId}`);
  go(back, "ok", `Agendado para ${start.setLocale("pt-BR").toFormat("dd/LL 'às' HH:mm")}.`);
}

/** Muda o status de um agendamento confirmado para concluído ou cancelado e registra quem fez. */
async function setAppointmentStatus(fd: FormData, status: "completed" | "cancelled") {
  const { profile } = await requireUser();
  const id = s(fd, "id");
  const agendaId = s(fd, "agenda_id");
  const dia = s(fd, "dia");
  const back = `${LIST}/${agendaId}${/^\d{4}-\d{2}-\d{2}$/.test(dia) ? `?dia=${dia}` : ""}`;
  if (!isUuid(id) || !isUuid(agendaId)) go(LIST, "error", "Agendamento não encontrado.");
  const agenda = await admin().from("agendas").select("id, owner_id").eq("id", agendaId).maybeSingle();
  if (!agenda.data || !(await canAccessAgenda(profile, agenda.data))) go(LIST, "error", "Agenda não encontrada.");
  const { data, error } = await admin()
    .from("appointments")
    .update({ status, status_changed_by: profile.id, status_changed_at: new Date().toISOString() })
    .eq("id", id).eq("agenda_id", agendaId).eq("status", "confirmed")
    .select("id");
  if (error) go(back, "error", error.message);
  if (!data?.length) go(back, "error", "Esse agendamento já tinha sido concluído ou cancelado.");
  await logActivity({ appointmentId: id, agendaId, actorId: profile.id, action: status });
  await syncAppointmentToGoogle(id);
  revalidatePath(`${LIST}/${agendaId}`);
  revalidatePath("/dashboard");
  go(back, "ok", status === "completed" ? "Agendamento marcado como concluído." : "Agendamento cancelado e retirado da agenda.");
}

/** Volta um agendamento concluído para pendente (confirmado). */
export async function reopenAppointment(fd: FormData) {
  const { profile } = await requireUser();
  const id = s(fd, "id");
  const agendaId = s(fd, "agenda_id");
  const dia = s(fd, "dia");
  const back = `${LIST}/${agendaId}${/^\d{4}-\d{2}-\d{2}$/.test(dia) ? `?dia=${dia}` : ""}`;
  if (!isUuid(id) || !isUuid(agendaId)) go(LIST, "error", "Agendamento não encontrado.");
  const agenda = await admin().from("agendas").select("id, owner_id").eq("id", agendaId).maybeSingle();
  if (!agenda.data || !(await canAccessAgenda(profile, agenda.data))) go(LIST, "error", "Agenda não encontrada.");
  // Limpa o registro de conclusão: o aviso pendente some e, se concluir de novo, quem agendou é avisado de novo.
  const { data, error } = await admin()
    .from("appointments")
    .update({ status: "confirmed", status_changed_by: null, status_changed_at: null, creator_seen_at: null })
    .eq("id", id).eq("agenda_id", agendaId).eq("status", "completed")
    .select("id");
  if (error) go(back, "error", error.message);
  if (!data?.length) go(back, "error", "Esse agendamento não está concluído.");
  await logActivity({ appointmentId: id, agendaId, actorId: profile.id, action: "reopened" });
  await syncAppointmentToGoogle(id);
  revalidatePath(`${LIST}/${agendaId}`);
  revalidatePath("/dashboard");
  go(back, "ok", "Agendamento retomado.");
}

export async function completeAppointment(fd: FormData) {
  await setAppointmentStatus(fd, "completed");
}

export async function cancelAppointment(fd: FormData) {
  await setAppointmentStatus(fd, "cancelled");
}

/** Quem agendou marca o aviso de concluído/cancelado como visto (um ou todos). */
export async function dismissNotice(fd: FormData) {
  const { profile } = await requireUser();
  const id = s(fd, "id");
  let q = admin().from("appointments").update({ creator_seen_at: new Date().toISOString() })
    .eq("created_by", profile.id).is("creator_seen_at", null).in("status", ["completed", "cancelled"]);
  if (id !== "all") {
    if (!isUuid(id)) redirect("/dashboard");
    q = q.eq("id", id);
  }
  await q;
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/** Edita título, cliente, contato, observações, data, horário e duração de um agendamento. */
export async function updateAppointment(fd: FormData) {
  const { profile } = await requireUser();
  const id = s(fd, "id");
  const agendaId = s(fd, "agenda_id");
  const dia = s(fd, "dia");
  const date = s(fd, "date");
  const backTo = (d: string) => `${LIST}/${agendaId}${/^\d{4}-\d{2}-\d{2}$/.test(d) ? `?dia=${d}` : ""}`;
  if (!isUuid(id) || !isUuid(agendaId)) go(LIST, "error", "Agendamento não encontrado.");

  const db = admin();
  const agenda = await db.from("agendas").select("id, owner_id").eq("id", agendaId).maybeSingle();
  if (!agenda.data || !(await canAccessAgenda(profile, agenda.data))) go(LIST, "error", "Agenda não encontrada.");
  const current = await db
    .from("appointments").select("id, status, start_at, end_at").eq("id", id).eq("agenda_id", agendaId).maybeSingle();
  if (!current.data || current.data.status !== "confirmed") go(backTo(dia), "error", "Agendamento não encontrado ou já cancelado.");

  const owner = await db.from("profiles").select("timezone").eq("id", agenda.data!.owner_id).maybeSingle();
  const zone = owner.data?.timezone ?? "America/Fortaleza";
  const duration = Math.round(Number(fd.get("duration_min")));
  // Data e hora são interpretadas no fuso do dono da agenda.
  const start = DateTime.fromFormat(`${date} ${s(fd, "time")}`, "yyyy-MM-dd HH:mm", { zone });
  if (!start.isValid) go(backTo(dia), "error", "Informe data e horário válidos.");
  if (!Number.isFinite(duration) || duration < 5 || duration > 720) {
    go(backTo(dia), "error", "A duração deve ficar entre 5 e 720 minutos.");
  }

  const title = s(fd, "title", 120);
  if (!title) go(backTo(dia), "error", "Informe o título do agendamento.");

  const { error } = await db
    .from("appointments")
    .update({
      title,
      client_name: s(fd, "client_name", 120) || null,
      client_phone: s(fd, "client_phone", 40) || null,
      client_email: s(fd, "client_email", 200) || null,
      notes: s(fd, "notes", 2000) || null,
      start_at: start.toUTC().toISO(),
      end_at: start.plus({ minutes: duration }).toUTC().toISO(),
    })
    .eq("id", id).eq("agenda_id", agendaId).eq("status", "confirmed");
  if (error) {
    go(backTo(dia), "error", error.code === "23P01" ? "Já existe um agendamento nesse horário nesta agenda." : error.message);
  }
  const newStart = start.toUTC().toISO()!;
  const newEnd = start.plus({ minutes: duration }).toUTC().toISO()!;
  const moved =
    Date.parse(current.data!.start_at) !== Date.parse(newStart) || Date.parse(current.data!.end_at) !== Date.parse(newEnd);
  await logActivity({
    appointmentId: id,
    agendaId,
    actorId: profile.id,
    action: moved ? "rescheduled" : "updated",
    details: moved ? { de: current.data!.start_at, para: newStart } : undefined,
  });
  await syncAppointmentToGoogle(id);
  revalidatePath(`${LIST}/${agendaId}`);
  go(backTo(date), "ok", `Agendamento atualizado (${start.setLocale("pt-BR").toFormat("dd/LL 'às' HH:mm")}).`);
}

// ---------- Acesso às agendas (somente admin) ----------

export async function addAgendaMember(fd: FormData) {
  const { profile } = await requireAdmin();
  const agendaId = s(fd, "agenda_id");
  const userId = s(fd, "user_id");
  const back = `${LIST}/${agendaId}`;
  if (!isUuid(agendaId)) go(LIST, "error", "Agenda não encontrada.");
  if (!isUuid(userId)) go(back, "error", "Escolha uma pessoa.");
  const { error } = await admin()
    .from("agenda_members")
    .upsert({ agenda_id: agendaId, user_id: userId, created_by: profile.id }, { onConflict: "agenda_id,user_id" });
  if (error) go(back, "error", error.message);
  revalidatePath(back);
  go(back, "ok", "Acesso concedido.");
}

export async function removeAgendaMember(fd: FormData) {
  await requireAdmin();
  const agendaId = s(fd, "agenda_id");
  const back = `${LIST}/${agendaId}`;
  if (!isUuid(agendaId)) go(LIST, "error", "Agenda não encontrada.");
  const { error } = await admin()
    .from("agenda_members").delete().eq("agenda_id", agendaId).eq("user_id", s(fd, "user_id"));
  if (error) go(back, "error", error.message);
  revalidatePath(back);
  go(back, "ok", "Acesso removido.");
}

// ---------- Ligação com o Google Agenda (somente admin) ----------

export async function setAgendaGoogle(fd: FormData) {
  await requireAdmin();
  const id = s(fd, "id");
  const back = `${LIST}/${id}`;
  if (!isUuid(id)) go(LIST, "error", "Agenda não encontrada.");
  const choice = s(fd, "google", 600);
  const manual = s(fd, "manual_calendar_id", 300);
  const connManual = s(fd, "manual_connection_id");

  let patch: Record<string, string | null> = { google_connection_id: null, google_calendar_id: null, google_calendar_name: null };
  if (manual) {
    if (!isUuid(connManual)) go(back, "error", "Escolha a conta Google.");
    patch = { google_connection_id: connManual, google_calendar_id: manual, google_calendar_name: manual };
  } else if (choice) {
    const sep = choice.indexOf("|");
    const connId = choice.slice(0, sep);
    const calId = choice.slice(sep + 1);
    if (!isUuid(connId) || !calId) go(back, "error", "Escolha uma agenda do Google.");
    const list = await listGoogleCalendars(connId);
    const cal = list.calendars.find((c) => c.id === calId);
    if (!cal) go(back, "error", "Essa agenda do Google não foi encontrada na conta.");
    patch = { google_connection_id: connId, google_calendar_id: calId, google_calendar_name: cal!.name };
  }
  const { error } = await admin().from("agendas").update(patch).eq("id", id);
  if (error) go(back, "error", error.message);

  // Envia (ou move) os agendamentos de hoje em diante para a agenda escolhida.
  const r = await syncUpcomingForAgenda(id);
  revalidatePath(back);
  const what = patch.google_calendar_id ? `ligada a “${patch.google_calendar_name}” no Google` : "desligada do Google";
  if (r.errors) go(back, "error", `Agenda ${what}, mas ${r.errors} de ${r.total} agendamento(s) não sincronizaram. Veja os avisos.`);
  go(back, "ok", `Agenda ${what}.${r.total ? ` ${r.total} agendamento(s) de hoje em diante sincronizados.` : ""}`);
}

export async function retryGoogleSync(fd: FormData) {
  const { profile } = await requireUser();
  const id = s(fd, "id");
  const agendaId = s(fd, "agenda_id");
  const dia = s(fd, "dia");
  if (!isUuid(id) || !isUuid(agendaId)) go(LIST, "error", "Agendamento não encontrado.");
  const agenda = await admin().from("agendas").select("id, owner_id").eq("id", agendaId).maybeSingle();
  if (!agenda.data || !(await canAccessAgenda(profile, agenda.data))) go(LIST, "error", "Agenda não encontrada.");
  const appt = await admin().from("appointments").select("id").eq("id", id).eq("agenda_id", agendaId).maybeSingle();
  if (!appt.data) go(LIST, "error", "Agendamento não encontrado.");
  await syncAppointmentToGoogle(id);
  revalidatePath(`${LIST}/${agendaId}`);
  go(`${LIST}/${agendaId}${/^\d{4}-\d{2}-\d{2}$/.test(dia) ? `?dia=${dia}` : ""}`, "ok", "Sincronização com o Google refeita.");
}
