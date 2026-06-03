import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildSteamLoginUrl, getSiteUrl } from "@/lib/steam/openid";

// Starts the Steam OpenID flow. proxy.ts already requires auth for /api/steam/*,
// so this user check is a defensive fallback.
export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${getSiteUrl()}/login`);
  }

  return NextResponse.redirect(buildSteamLoginUrl());
}
