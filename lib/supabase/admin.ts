import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Full-access client (secret key, bypasses RLS). Use only inside admin-only
 * server actions, after checking the caller is an admin with getCurrentUser().
 * Never import this from a Client Component or a page's data reads.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
  }
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
