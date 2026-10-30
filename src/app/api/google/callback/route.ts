import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appUrl, requireAdmin } from "@/lib/auth";
import { googleExchange } from "@/lib/calendars/google";
import { encrypt } from "@/lib/crypto";
import { relinkAgendas, syncAllLinkedAgendas } from "@/lib/google-sync";
import { admin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const { profile } = await requireAdmin();
  const q = new URL(req.url).searchParams;
  const back = (key: "ok" | "error", msg: string) => {
    const res = NextResponse.redirect(`${appUrl()}/dashboard/calendars?${key}=${encodeURIComponent(msg)}`);
    res.cookies.delete("g_state");
    return res;
  };

  const expected = (await cookies()).get("g_state")?.value;
  if (!expected || q.get("state") !== expected) return back("error", "Sessão de conexão expirada. Tente de novo.");
  const code = q.get("code");
  if (!code) return back("error", "Conexão com o Google cancelada.");

  try {
    const { secret, email } = await googleExchange(code, `${appUrl()}/api/google/callback`);
    const db = admin();
    const existing = await db.from("calendar_connections").select("id, is_destination").eq("user_id", profile.id);
    const hasDestination = (existing.data ?? []).some((c) => c.is_destination);
    const { data: saved, error } = await db.from("calendar_connections").upsert(
      {
        user_id: profile.id,
        provider: "google",
        account: email,
        secret: encrypt(JSON.stringify(secret)),
        last_error: null,
        ...(hasDestination ? {} : { is_destination: true }),
      },
      { onConflict: "user_id,provider,account" },
    ).select("id").single();
    if (error) throw new Error(error.message);
    // Se a conta tinha sido desconectada, as agendas perderam a ligação: religa e reenvia.
    const relinked = await relinkAgendas(saved.id as string);
    if (relinked.length) {
      await syncAllLinkedAgendas();
      return back("ok", `Google Agenda conectado (${email}). ${relinked.length} agenda(s) religada(s) e sincronizada(s).`);
    }
    return back("ok", `Google Agenda conectado (${email}).`);
  } catch (err) {
    return back("error", err instanceof Error ? err.message : "Falha ao conectar com o Google.");
  }
}
