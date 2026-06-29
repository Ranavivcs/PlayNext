import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildSteamLoginUrl } from "@/lib/steam/openid";
import { getOrigin } from "@/lib/origin";

// Starts the Steam OpenID flow. proxy.ts already requires auth for /api/steam/*,
// so this user check is a defensive fallback.
export async function GET() {
  const origin = await getOrigin();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  return NextResponse.redirect(buildSteamLoginUrl(origin));
}
