import "server-only";
import { IANAZone } from "luxon";
import { admin } from "./supabase/admin";
import { RESERVED_USERNAMES } from "./types";

export type NewUser = {
  email: string;
  name: string;
  username: string;
  password: string;
  role: "admin" | "member";
  timezone?: string;
};

export function validateUsername(username: string): string | null {
  if (!/^[a-z0-9-]{3,30}$/.test(username)) {
    return "O endereço deve ter de 3 a 30 caracteres: letras minúsculas, números ou hífen.";
  }
  if (RESERVED_USERNAMES.has(username)) return "Esse endereço é reservado. Escolha outro.";
  return null;
}

/** Cria login + perfil, com disponibilidade e um tipo de evento iniciais. */
export async function createUser(u: NewUser): Promise<{ error: string | null }> {
  const email = u.email.trim().toLowerCase();
  const name = u.name.trim();
  const username = u.username.trim().toLowerCase();
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return { error: "Informe nome e e-mail válidos." };
  if (u.password.length < 8) return { error: "A senha precisa ter pelo menos 8 caracteres." };
  const bad = validateUsername(username);
  if (bad) return { error: bad };
  const timezone = u.timezone && IANAZone.isValidZone(u.timezone) ? u.timezone : "America/Fortaleza";

  const db = admin();
  const taken = await db.from("profiles").select("id").eq("username", username).maybeSingle();
  if (taken.data) return { error: "Esse endereço já está em uso." };

  const created = await db.auth.admin.createUser({ email, password: u.password, email_confirm: true });
  if (created.error || !created.data.user) {
    return { error: created.error?.message ?? "Não foi possível criar o usuário." };
  }
  const id = created.data.user.id;

  const profile = await db.from("profiles").insert({ id, email, name, username, timezone, role: u.role });
  if (profile.error) {
    await db.auth.admin.deleteUser(id);
    return { error: profile.error.message };
  }

  await db.from("availability").insert(
    [1, 2, 3, 4, 5].map((weekday) => ({ user_id: id, weekday, start_time: "09:00", end_time: "17:00" })),
  );
  await db.from("event_types").insert({
    user_id: id,
    title: "Reunião de 30 min",
    slug: "30min",
    duration_min: 30,
    location_type: "google_meet",
  });
  return { error: null };
}
