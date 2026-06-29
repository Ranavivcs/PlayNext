// Steam OpenID 2.0 — identity only. Supabase owns the session; we just learn
// the user's 64-bit steamid and store it in `steam_accounts`.
// Flow: build a login URL -> Steam authenticates -> Steam redirects back to
// our return_to with signed openid.* params -> we re-POST them with
// mode=check_authentication so Steam confirms it really signed them.

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";

const STEAM_RETURN_PATH = "/api/steam/callback";

/**
 * URL to send the browser to so the user can authenticate with Steam.
 * `origin` is the live request origin (e.g. https://play-next-five.vercel.app),
 * passed in by the route so we never depend on a build-time env var.
 */
export function buildSteamLoginUrl(origin: string): string {
  const site = origin.replace(/\/+$/, "");
  const params = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": `${site}${STEAM_RETURN_PATH}`,
    "openid.realm": site,
    // identifier_select tells Steam to pick the identity for the logged-in user.
    "openid.identity": IDENTIFIER_SELECT,
    "openid.claimed_id": IDENTIFIER_SELECT,
  });
  return `${STEAM_OPENID_URL}?${params.toString()}`;
}

/**
 * Verify the assertion Steam redirected back with.
 * Returns the 64-bit steamid on success, or null if verification fails.
 */
export async function verifySteamAssertion(
  query: URLSearchParams,
  origin: string,
): Promise<string | null> {
  if (query.get("openid.mode") !== "id_res") return null;

  // Defense-in-depth: the assertion must be for our own return_to.
  const site = origin.replace(/\/+$/, "");
  const returnTo = query.get("openid.return_to") ?? "";
  if (!returnTo.startsWith(`${site}${STEAM_RETURN_PATH}`)) return null;

  // Echo every openid.* param back, but flip mode to check_authentication.
  const body = new URLSearchParams();
  for (const [key, value] of query.entries()) {
    if (key.startsWith("openid.")) body.set(key, value);
  }
  body.set("openid.mode", "check_authentication");

  const res = await fetch(STEAM_OPENID_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });
  if (!res.ok) return null;

  const text = await res.text();
  if (!/is_valid\s*:\s*true/i.test(text)) return null;

  // claimed_id looks like https://steamcommunity.com/openid/id/76561198XXXXXXXXX
  const claimedId = query.get("openid.claimed_id") ?? "";
  const match = claimedId.match(/\/openid\/id\/(\d{17})\/?$/);
  return match ? match[1] : null;
}
