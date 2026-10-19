import "server-only";
import { admin } from "./supabase/admin";

export type ActivityAction = "created" | "updated" | "rescheduled" | "completed" | "reopened" | "cancelled";

export const ACTION_LABELS: Record<ActivityAction, string> = {
  created: "agendou",
  updated: "editou",
  rescheduled: "reagendou",
  completed: "concluiu",
  reopened: "retomou",
  cancelled: "cancelou",
};

/**
 * Registra uma atividade no histórico. Falhar aqui não deve impedir a ação
 * principal (o agendamento já foi salvo), então o erro só vai para o log.
 */
export async function logActivity(e: {
  appointmentId: string;
  agendaId: string;
  actorId: string;
  action: ActivityAction;
  details?: Record<string, unknown>;
}) {
  const { error } = await admin().from("appointment_events").insert({
    appointment_id: e.appointmentId,
    agenda_id: e.agendaId,
    actor_id: e.actorId,
    action: e.action,
    details: e.details ?? null,
  });
  if (error) console.error("historico", error.message);
}
