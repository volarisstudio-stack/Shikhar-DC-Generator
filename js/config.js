// Public, client-safe Supabase config.
// The anon/publishable key is designed to be exposed in client code — it can
// only do what the database's Row Level Security policies allow (see the
// migration in supabase/migrations/). It is NOT a secret like the old
// JSONBin master key was.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://iaktywhaipuawyrnnynz.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable__xF3HDZdE_IFXAR7CYgTFQ_um0EqVfw',
};
