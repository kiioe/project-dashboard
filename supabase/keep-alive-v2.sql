-- Keep the free-plan database awake, version 2 (run after keep-alive.sql).
-- The project paused on 15 Nov 2026 although keep_alive() had been called
-- successfully on 10 and 13 Nov. Supabase only says "a few user requests to
-- the database each day" is typically enough, so the GitHub Actions job now
-- runs daily, and each call writes a timestamp, which is unmistakably real
-- database activity.
--
-- One tiny table with a single row. The app never reads it, and no one can
-- read or change it directly: only keep_alive() touches it.
-- To see when the job last ran: select * from public.keep_alive_log;

create table if not exists public.keep_alive_log (
  id smallint primary key default 1 check (id = 1),
  last_ping timestamptz not null default now(),
  ping_count bigint not null default 0
);

insert into public.keep_alive_log (id) values (1)
on conflict (id) do nothing;

alter table public.keep_alive_log enable row level security;
-- No policies on purpose: anon and signed-in users can't touch the table.
revoke all on table public.keep_alive_log from public, anon, authenticated;

-- Same name, same "ok" answer, so the workflow and its checks don't change.
-- The function changes from stable (read-only) to volatile (writes), so it is
-- dropped and recreated rather than replaced.
drop function if exists public.keep_alive();

create function public.keep_alive()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.keep_alive_log
     set last_ping = now(),
         ping_count = ping_count + 1
   where id = 1;
  return 'ok';
end;
$$;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;
