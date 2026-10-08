import { NextResponse } from "next/server";
import { appUrl, requireUser } from "@/lib/auth";
import { googleAuthUrl, googleConfigured } from "@/lib/calendars/google";
import { randomToken } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireUser();
  if (!googleConfigured()) {
    const msg = encodeURIComponent("Google ainda não configurado: defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.");
    return NextResponse.redirect(`${appUrl()}/dashboard/calendars?error=${msg}`);
  }
  const state = randomToken(16);
  const res = NextResponse.redirect(googleAuthUrl(`${appUrl()}/api/google/callback`, state));
  res.cookies.set("g_state", state, {
    httpOnly: true, sameSite: "lax", secure: appUrl().startsWith("https"), maxAge: 600, path: "/",
  });
  return res;
}
