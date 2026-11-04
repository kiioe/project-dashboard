-- Tasks (progress comes from them) and invoice settings.
-- Uses the helper functions from cost-tracking.sql. Run once in the Supabase SQL editor.

------------------------------------------------------------------------------
-- Tasks: each project has a task list. Progress = tasks done ÷ total tasks.
------------------------------------------------------------------------------
create table public.project_tasks (
  id bigint generated always as identity primary key,
  org_id text not null,
  project_id bigint not null references public.projects(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  done boolean not null default false,
  due_date date,
  created_at timestamptz not null default now()
);
create index project_tasks_project_id_idx on public.project_tasks (project_id);

alter table public.project_tasks enable row level security;

create policy "Org members can view project tasks" on public.project_tasks
  for select to authenticated
  using (public.jwt_org_id() = org_id);

create policy "Org admins can add project tasks" on public.project_tasks
  for insert to authenticated
  with check (public.jwt_org_id() = org_id and public.jwt_is_org_admin()
    and exists (select 1 from public.projects p where p.id = project_id and p.org_id = project_tasks.org_id));

create policy "Org admins can change project tasks" on public.project_tasks
  for update to authenticated
  using (public.jwt_org_id() = org_id and public.jwt_is_org_admin())
  with check (public.jwt_org_id() = org_id and public.jwt_is_org_admin()
    and exists (select 1 from public.projects p where p.id = project_id and p.org_id = project_tasks.org_id));

create policy "Org admins can delete project tasks" on public.project_tasks
  for delete to authenticated
  using (public.jwt_org_id() = org_id and public.jwt_is_org_admin());

-- A project's progress, worked out from its tasks (0 when it has none), as a whole number.
create or replace function public.task_progress(p_project_id bigint) returns integer
language sql stable
set search_path = public
as $$
  select coalesce(round(100.0 * count(*) filter (where done) / nullif(count(*), 0))::int, 0)
  from public.project_tasks where project_id = p_project_id
$$;

-- Progress can't be set by hand: whenever a project is saved, it's recalculated from its tasks.
create or replace function public.projects_progress_from_tasks() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.progress := case when tg_op = 'INSERT' then 0 else public.task_progress(new.id) end;
  return new;
end;
$$;

create trigger projects_progress_from_tasks
  before insert or update on public.projects
  for each row execute function public.projects_progress_from_tasks();

-- When tasks change, refresh the project's progress (security definer so the update
-- isn't blocked by the projects update rule; it only ever touches progress).
create or replace function public.refresh_project_progress() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.projects set progress = public.task_progress(old.project_id) where id = old.project_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) then
    update public.projects set progress = public.task_progress(new.project_id) where id = new.project_id;
  end if;
  return null;
end;
$$;

create trigger project_tasks_refresh_progress
  after insert or update or delete on public.project_tasks
  for each row execute function public.refresh_project_progress();

-- Existing projects: progress now comes from tasks (none yet, so 0%).
update public.projects set progress = 0;

------------------------------------------------------------------------------
-- Invoices: your business details, saved once per organisation, plus numbering.
------------------------------------------------------------------------------
create table public.org_invoice_settings (
  org_id text primary key,
  business_name text not null default '' check (length(business_name) <= 120),
  address text not null default '' check (length(address) <= 500),
  email text not null default '' check (length(email) <= 200),
  payment_details text not null default '' check (length(payment_details) <= 500),
  default_vat_rate numeric(5,2) not null default 20 check (default_vat_rate between 0 and 100),
  next_invoice_number integer not null default 1 check (next_invoice_number > 0),
  updated_at timestamptz not null default now()
);

alter table public.org_invoice_settings enable row level security;

create policy "Org admins can view invoice settings" on public.org_invoice_settings
  for select to authenticated
  using (public.jwt_org_id() = org_id and public.jwt_is_org_admin());

create policy "Org admins can add invoice settings" on public.org_invoice_settings
  for insert to authenticated
  with check (public.jwt_org_id() = org_id and public.jwt_is_org_admin());

create policy "Org admins can change invoice settings" on public.org_invoice_settings
  for update to authenticated
  using (public.jwt_org_id() = org_id and public.jwt_is_org_admin())
  with check (public.jwt_org_id() = org_id and public.jwt_is_org_admin());

-- Takes the next invoice number for your organisation (INV-0001, INV-0002, ...) so no two invoices share one.
create or replace function public.claim_invoice_number() returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org text := public.jwt_org_id();
  v_number integer;
begin
  if v_org is null or not public.jwt_is_org_admin() then
    raise exception 'Only organisation admins can create invoices.';
  end if;
  insert into public.org_invoice_settings (org_id) values (v_org) on conflict (org_id) do nothing;
  update public.org_invoice_settings
    set next_invoice_number = next_invoice_number + 1, updated_at = now()
    where org_id = v_org
    returning next_invoice_number - 1 into v_number;
  return 'INV-' || lpad(v_number::text, 4, '0');
end;
$$;

revoke execute on function public.claim_invoice_number() from public, anon;
grant execute on function public.claim_invoice_number() to authenticated;
