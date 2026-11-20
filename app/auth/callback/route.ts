import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for links in Supabase emails (password recovery, sign-up confirmation).
 * Turns the one-time code in the link into a session cookie, then sends the user on to `next`.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const nextParam = url.searchParams.get("next");
  const fallback = type === "recovery" ? "/reset-password" : "/";
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : fallback;

  const supabase = await createClient();
  let error: { message: string } | null = null;

  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type) {
    ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
  } else {
    error = { message: "The link is missing its code." };
  }

  if (error) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("error", "This link is invalid or has expired. Request a new one.");
    return NextResponse.redirect(login);
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
