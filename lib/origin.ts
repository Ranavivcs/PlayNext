import { headers } from "next/headers";

/**
 * The site origin (e.g. https://play-next-five.vercel.app) derived from the
 * INCOMING REQUEST, not an env var. This is robust on Vercel: `NEXT_PUBLIC_*`
 * vars are baked at build time, so a stale/wrong value (or a cached redeploy)
 * would otherwise produce wrong absolute URLs (e.g. localhost in prod emails).
 * Falls back to NEXT_PUBLIC_SITE_URL only if no request headers are available.
 */
export async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
}
