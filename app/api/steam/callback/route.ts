import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifySteamAssertion } from "@/lib/steam/openid";
import { getPlayerSummary } from "@/lib/steam/api";
import { getOrigin } from "@/lib/origin";

// Steam redirects the browser here after the user authenticates. We verify the
// signed assertion, then upsert the steamid onto the logged-in user's account.
export async function GET(request: NextRequest) {
  const site = await getOrigin();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${site}/login`);
  }

  const steamId = await verifySteamAssertion(request.nextUrl.searchParams, site);
  if (!steamId) {
    const msg = encodeURIComponent("Steam verification failed. Please try again.");
    return NextResponse.redirect(`${site}/dashboard?steam_error=${msg}`);
  }

  // Best-effort enrichment; linking should still succeed if this fails.
  let summary = null;
  try {
    summary = await getPlayerSummary(steamId);
  } catch {
    summary = null;
  }

  // RLS "own steam account" lets the user-scoped client write their own row.
  const { error } = await supabase.from("steam_accounts").upsert(
    {
      user_id: user.id,
      steam_id: steamId,
      persona_name: summary?.personaName ?? null,
      avatar_url: summary?.avatarUrl ?? null,
      profile_public: summary?.profilePublic ?? false,
      linked_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    // Likely the steamid is already linked to another account (unique steam_id).
    const msg = encodeURIComponent(
      error.code === "23505"
        ? "This Steam account is already linked to another user."
        : error.message,
    );
    return NextResponse.redirect(`${site}/dashboard?steam_error=${msg}`);
  }

  return NextResponse.redirect(`${site}/dashboard?steam_linked=1`);
}
