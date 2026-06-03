// Live smoke test: signup -> profile trigger -> RLS -> cleanup.
// Run: node --env-file=.env.local tests/smoke-auth.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

const pub = createClient(url, anon, { auth: { persistSession: false } });
const admin = createClient(url, service, { auth: { persistSession: false } });

const email = `playnext.smoketest+${Date.now()}@gmail.com`;
const password = "Test123456!";
let ok = true;

const { data: su, error: suErr } = await pub.auth.signUp({
  email,
  password,
  options: { data: { display_name: "Smoke Test" } },
});
if (suErr) {
  console.error("FAIL signup:", suErr.message);
  process.exit(1);
}
const userId = su.user?.id;
console.log(`PASS signup -> user ${userId} (session: ${!!su.session})`);

const { data: profile } = await admin
  .from("profiles")
  .select("id, display_name")
  .eq("id", userId)
  .maybeSingle();
if (profile?.id === userId) {
  console.log(`PASS trigger -> profile row created (display_name="${profile.display_name}")`);
} else {
  console.error("FAIL trigger: no profile row for new user");
  ok = false;
}

// Use a fresh, never-authenticated client: with email confirmation off,
// signUp returns a session, so `pub` is now the logged-in user (who can read
// their own profile). A separate anon client is the real RLS negative test.
const anonClient = createClient(url, anon, { auth: { persistSession: false } });
const { data: anonRead } = await anonClient.from("profiles").select("id");
if ((anonRead?.length ?? 0) === 0) {
  console.log("PASS RLS -> anonymous client cannot read profiles");
} else {
  console.error(`FAIL RLS: anon read returned ${anonRead.length} rows`);
  ok = false;
}

const { error: delErr } = await admin.auth.admin.deleteUser(userId);
console.log(delErr ? `WARN cleanup: ${delErr.message}` : "PASS cleanup -> test user deleted");

process.exit(ok ? 0 : 1);
