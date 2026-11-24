-- Feedback (24 Nov 2026)
-- Two kinds of row in one table:
--   'vote'    : "Was this section helpful?" thumbs up (1) / down (-1) on a section, with an optional comment
--               (up to 500 characters). One vote per person per section per organisation; it can be changed or taken back.
--   'general' : the header's "Feedback" link: Bug / Idea / Other, a message (up to 2,000 characters),
--               and whether the person is happy to be contacted.
-- Anyone signed in to an organisation (admin or member) can send feedback.
-- People can read, change and delete only their OWN votes (so the app can remember them).
-- General feedback can only be sent, never read back, from the app.
-- Nobody in a customer's organisation can see anyone else's feedback. E reads it all in Supabase
-- (the dashboard and SQL editor bypass these rules). Saved queries are at the bottom of this file.

create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  org_id text not null,
  user_id text not null,
  user_name text check (char_length(user_name) <= 200),
  user_email text check (char_length(user_email) <= 320),
  kind text not null check (kind in ('vote', 'general')),
  section text check (section in ('projects', 'overview', 'timeline', 'budget', 'tasks', 'costs', 'time', 'invoices')),
  vote smallint check (vote in (-1, 1)),
  topic text check (topic in ('Bug', 'Idea', 'Other')),
  comment text,
  contact_ok boolean not null default false,
  device text check (device in ('desktop', 'phone')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_shape check (
    (kind = 'vote' and section is not null and vote is not null and topic is null
      and (comment is null or char_length(comment) <= 500))
    or
    (kind = 'general' and section is null and vote is null and topic is not null
      and comment is not null and char_length(btrim(comment)) between 1 and 2000)
  )
);

-- One vote per person per section per organisation (general rows have no section, so they never clash).
create unique index if not exists feedback_one_vote on public.feedback (user_id, org_id, section);

create or replace function public.feedback_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  -- A vote can't be moved to another person, organisation or section, or turned into general feedback.
  new.user_id := old.user_id;
  new.org_id := old.org_id;
  new.section := old.section;
  new.kind := old.kind;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists feedback_touch on public.feedback;
create trigger feedback_touch before update on public.feedback
  for each row execute function public.feedback_touch();

alter table public.feedback enable row level security;

drop policy if exists "Send feedback" on public.feedback;
create policy "Send feedback" on public.feedback for insert to authenticated
  with check (public.jwt_org_id() = org_id and auth.jwt()->>'sub' = user_id);

drop policy if exists "Read own votes" on public.feedback;
create policy "Read own votes" on public.feedback for select to authenticated
  using (kind = 'vote' and public.jwt_org_id() = org_id and auth.jwt()->>'sub' = user_id);

drop policy if exists "Change own votes" on public.feedback;
create policy "Change own votes" on public.feedback for update to authenticated
  using (kind = 'vote' and public.jwt_org_id() = org_id and auth.jwt()->>'sub' = user_id)
  with check (kind = 'vote' and public.jwt_org_id() = org_id and auth.jwt()->>'sub' = user_id);

drop policy if exists "Take back own votes" on public.feedback;
create policy "Take back own votes" on public.feedback for delete to authenticated
  using (kind = 'vote' and public.jwt_org_id() = org_id and auth.jwt()->>'sub' = user_id);

revoke all on public.feedback from anon;
grant select, insert, update, delete on public.feedback to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Saved queries for E (copy into the SQL editor; not run as part of this file).
--
-- Thumbs per section:
--   select section, count(*) filter (where vote = 1) as up, count(*) filter (where vote = -1) as down
--   from public.feedback where kind = 'vote' group by section order by section;
--
-- Thumbs-down comments, newest first:
--   select updated_at, section, user_name, user_email, comment, device
--   from public.feedback where kind = 'vote' and vote = -1 and comment is not null order by updated_at desc;
--
-- General feedback, newest first:
--   select created_at, topic, comment, user_name, user_email, contact_ok, device
--   from public.feedback where kind = 'general' order by created_at desc;
