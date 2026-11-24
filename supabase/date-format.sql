-- UK date format (24 Nov 2026): the organisation's date format, used everywhere in the app and on invoices.
-- 'uk' (28/11/2026, 28 Nov 2026) is the default; 'us' (11/28/2026, Nov 28, 2026) is the alternative.
-- Dates themselves are still stored as dates; only how they are shown changes, so no data is touched.
-- Everyone in the organisation can read it (members see dates too); only admins can change it.
-- No row yet means UK.

create table if not exists public.org_settings (
  org_id text primary key,
  date_format text not null default 'uk' check (date_format in ('uk', 'us')),
  updated_at timestamptz not null default now()
);

alter table public.org_settings enable row level security;

drop policy if exists "Org members can view org settings" on public.org_settings;
create policy "Org members can view org settings" on public.org_settings
  for select to authenticated
  using (public.jwt_org_id() = org_id);

drop policy if exists "Org admins can add org settings" on public.org_settings;
create policy "Org admins can add org settings" on public.org_settings
  for insert to authenticated
  with check (public.jwt_org_id() = org_id and public.jwt_is_org_admin());

drop policy if exists "Org admins can change org settings" on public.org_settings;
create policy "Org admins can change org settings" on public.org_settings
  for update to authenticated
  using (public.jwt_org_id() = org_id and public.jwt_is_org_admin())
  with check (public.jwt_org_id() = org_id and public.jwt_is_org_admin());

revoke all on public.org_settings from anon;
grant select, insert, update on public.org_settings to authenticated;
