import { createClient } from "@supabase/supabase-js";

// Service-role client — server-only. Bypasses RLS, so every caller MUST
// verify ownership itself before touching a row or a storage object.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export const OFFERINGS_BUCKET = "phantom-offerings";
