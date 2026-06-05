import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Lands here from Supabase auth email links (e.g. password reset). Exchanges the
// one-time `code` for a session (sets cookies), then forwards to `next`.
export async function GET(request: NextRequest) {
  // Build absolute redirects against the ACTUAL request origin (not an env var),
  // so this works on prod and localhost regardless of NEXT_PUBLIC_SITE_URL.
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${proto}://${host}` : request.nextUrl.origin;

  const code = request.nextUrl.searchParams.get("code");
  // Password reset is currently the only email-link flow, so default here is the
  // set-new-password page. A `next` param (same-site only) can override it; note
  // that if you add one, the redirectTo with that query must be allowlisted in
  // Supabase or it falls back to the Site URL.
  const nextParam = request.nextUrl.searchParams.get("next") ?? "/reset-password";
  const dest = nextParam.startsWith("/") ? nextParam : "/reset-password";

  if (!code) {
    const msg = encodeURIComponent("Invalid or expired link. Please try again.");
    return NextResponse.redirect(`${origin}/login?error=${msg}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const msg = encodeURIComponent("Invalid or expired link. Please request a new one.");
    return NextResponse.redirect(`${origin}/login?error=${msg}`);
  }

  return NextResponse.redirect(`${origin}${dest}`);
}
