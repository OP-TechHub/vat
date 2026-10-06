import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * All of this app's tables, views and functions live in their own Postgres schema so the
 * Supabase project can be shared with other apps. Must match supabase/migrations/0001_init.sql
 * and be listed under Project Settings -> API -> Exposed schemas.
 */
export const DB_SCHEMA = "vat_claims" as const;

/** A Supabase client bound to the app schema. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, typeof DB_SCHEMA, typeof DB_SCHEMA>;
