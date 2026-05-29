import { config } from '@/configs';

// Returns the Supabase project URL and service role key.
// Used only for server-side Realtime broadcasts — no persistent connection kept.
export const getSupabaseConfig = () => ({
  url: config.supabase.url as string,
  serviceRoleKey: config.supabase.serviceRoleKey as string,
});
