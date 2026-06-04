import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Search the shared game catalog by name for the seed picker. Returns the most
// popular matches (enriched games only). proxy.ts already requires auth for
// non-public paths; the user check here is a defensive fallback.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ games: [] });
  }

  const { data, error } = await supabase
    .from("games")
    .select("app_id, name, header_image")
    .not("enriched_at", "is", null)
    .ilike("name", `%${q}%`)
    .order("total_reviews", { ascending: false, nullsFirst: false })
    .limit(12);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const games = (data ?? []).map((g) => ({
    appId: g.app_id as number,
    name: g.name as string,
    headerImage: (g.header_image as string | null) ?? null,
  }));
  return NextResponse.json({ games });
}
