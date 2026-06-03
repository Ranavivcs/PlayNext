import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client for server-only privileged operations (Steam ingest,
// writing cached game metadata, embeddings). NEVER import this into client code.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
