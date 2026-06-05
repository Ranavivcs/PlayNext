import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/steam/openid";

// Lands here from Supabase auth email links (e.g. password reset). Exchanges the
// one-time `code` for a session (sets cookies), then forwards to `next`.
export async function GET(request: NextRequest) {
  const site = getSiteUrl();
  const code = request.nextUrl.searchParams.get("code");
  // Password reset is currently the only email-link flow, so default here is the
  // set-new-password page. A `next` param (same-site only) can override it; note
  // that if you add one, the redirectTo with that query must be allowlisted in
  // Supabase or it falls back to the Site URL.
  const next = request.nextUrl.searchParams.get("next") ?? "/reset-password";
  const dest = next.startsWith("/") ? next : "/reset-password";

  if (!code) {
    const msg = encodeURIComponent("Invalid or expired link. Please try again.");
    return NextResponse.redirect(`${site}/login?error=${msg}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const msg = encodeURIComponent("Invalid or expired link. Please request a new one.");
    return NextResponse.redirect(`${site}/login?error=${msg}`);
  }

  return NextResponse.redirect(`${site}${dest}`);
}
