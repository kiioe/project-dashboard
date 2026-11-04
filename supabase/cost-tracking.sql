-- Cost tracking: each project has cost categories (with their own budget),
-- and each category holds individual cost items.
-- Run once in the Supabase SQL editor.

-- Helpers that read the organisation and role from the Clerk sign-in token.
-- They accept both the older (org_id / org_role) and newer (o.id / o.rol) Clerk token formats.
create or replace function public.jwt_org_id() returns text
language sql stable as $$
  select coalesce(auth.jwt()->>'org_id', auth.jwt()->'o'->>'id')
$$;

create or replace function public.jwt_is_org_admin() returns boolean
language sql stable as $$
  select coalesce(auth.jwt()->>'org_role', 'org:' || (auth.jwt()->'o'->>'rol')) = 'org:admin'
$$;

-- Categories: e.g. Venue, Catering, Flowers. Each has its own budget in the project's currency.
create table public.project_categories (
  id bigint generated always as identity primary key,
  org_id text not null,
  project_id bigint not null references public.projects(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  budget numeric(12,2) not null default 0 check (budget >= 0),
  created_at timestamptz not null default now(),
  unique (project_id, name),
  unique (id, project_id)
);
create index project_categories_project_id_idx on public.project_categories (project_id);

-- Items: individual costs inside a category. The total is worked out by the database.
create table public.cost_items (
  id bigint generated always as identity primary key,
  org_id text not null,
  project_id bigint not null references public.projects(id) on delete cascade,
  category_id bigint not null,
  description text not null check (length(trim(description)) between 1 and 120),
  supplier text not null default '' check (length(supplier) <= 120),
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  total numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
  status text not null default 'Quoted' check (status in ('Quoted', 'Booked', 'Invoiced', 'Paid')),
  due_date date,
  created_at timestamptz not null default now(),
  -- An item's category must belong to the same project.
  foreign key (category_id, project_id)
    references public.project_categories (id, project_id) on delete cascade
);
create index cost_items_project_id_idx on public.cost_items (project_id);
create index cost_items_category_id_idx on public.cost_items (category_id);

-- Access: everyone in the organisation can view; only organisation admins can add, change or delete.
alter table public.project_categories enable row level security;
alter table public.cost_items enable row level security;

create policy "Org members can view project categories" on public.project_categories
  for select to authenticated
  using (public.jwt_org_id() = org_id);

create policy "Org admins can add project categories" on public.project_categories
  for insert to authenticated
  with check (public.jwt_org_id() = org_id and public.jwt_is_org_admin()
    and exists (select 1 from public.projects p where p.id = project_id and p.org_id = project_categories.org_id));

create policy "Org admins can change project categories" on public.project_categories
  for update to authenticated
  using (public.jwt_org_id() = org_id and public.jwt_is_org_admin())
  with check (public.jwt_org_id() = org_id and public.jwt_is_org_admin()
    and exists (select 1 from public.projects p where p.id = project_id and p.org_id = project_categories.org_id));

create policy "Org admins can delete project categories" on public.project_categories
  for delete to authenticated
  using (public.jwt_org_id() = org_id and public.jwt_is_org_admin());

create policy "Org members can view cost items" on public.cost_items
  for select to authenticated
  using (public.jwt_org_id() = org_id);

create policy "Org admins can add cost items" on public.cost_items
  for insert to authenticated
  with check (public.jwt_org_id() = org_id and public.jwt_is_org_admin()
    and exists (select 1 from public.projects p where p.id = project_id and p.org_id = cost_items.org_id));

create policy "Org admins can change cost items" on public.cost_items
  for update to authenticated
  using (public.jwt_org_id() = org_id and public.jwt_is_org_admin())
  with check (public.jwt_org_id() = org_id and public.jwt_is_org_admin()
    and exists (select 1 from public.projects p where p.id = project_id and p.org_id = cost_items.org_id));

create policy "Org admins can delete cost items" on public.cost_items
  for delete to authenticated
  using (public.jwt_org_id() = org_id and public.jwt_is_org_admin());
