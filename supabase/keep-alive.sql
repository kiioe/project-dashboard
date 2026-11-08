-- Keep the free-plan database awake.
-- Supabase pauses free projects after 7 days without activity. A GitHub Actions
-- job (.github/workflows/keep-alive.yml) calls this function every 3 days.
-- It reads no tables, so it is safe to call without signing in.

create or replace function public.keep_alive()
returns text
language sql
stable
set search_path = ''
as $$
  select 'ok'::text;
$$;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;
