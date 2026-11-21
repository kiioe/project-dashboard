-- One-click "Generate invoice": client details on projects, and a record of issued invoices.
-- Uses the helper functions from cost-tracking.sql and bill_logged_time() from billing-v2.sql.
-- Run once in the Supabase SQL editor.

------------------------------------------------------------------------------
-- Client name and address on each project (invoices fill them in).
------------------------------------------------------------------------------
alter table public.projects
  add column client_name text not null default '' check (length(client_name) <= 120),
  add column client_address text not null default '' check (length(client_address) <= 500);

------------------------------------------------------------------------------
-- Issued invoices. Each keeps a copy of what was on it (seller, client, lines, totals),
-- so it can be downloaded again exactly as issued, even if items change later.
------------------------------------------------------------------------------
create table public.invoices (
  id bigint generated always as identity primary key,
  org_id text not null,
  project_id bigint not null references public.projects(id) on delete cascade,
  number text not null check (length(trim(number)) between 1 and 40),
  issue_date date not null,
  due_date date,
  currency text not null,
  vat_rate numeric(5,2) check (vat_rate between 0 and 100), -- empty = no VAT
  subtotal numeric(14,2) not null,
  vat numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  client_name text not null,
  client_address text not null default '',
  notes text not null default '' check (length(notes) <= 1000),
  seller_name text not null,
  seller_address text not null default '',
  seller_email text not null default '',
  seller_payment_details text not null default '',
  created_by text,
  created_at timestamptz not null default now(),
  unique (org_id, number),
  check (due_date is null or due_date >= issue_date)
);
create index invoices_project_id_idx on public.invoices (project_id);

-- The lines on each invoice. A cost item can be on only one invoice (unique).
-- An invoiced cost item can't be deleted on its own, so its hours can't be billed twice. The check runs
-- at the end of the change (deferred), so deleting a whole project, invoices included, still works.
create table public.invoice_items (
  id bigint generated always as identity primary key,
  org_id text not null,
  invoice_id bigint not null references public.invoices(id) on delete cascade,
  cost_item_id bigint unique references public.cost_items(id) deferrable initially deferred,
  position integer not null,
  description text not null,
  category text not null default '',
  quantity numeric(10,2) not null,
  unit_cost numeric(12,2) not null,
  total numeric(14,2) not null
);
create index invoice_items_invoice_id_idx on public.invoice_items (invoice_id);

-- Everyone in the organisation can view. Nobody writes directly: invoices are only
-- created through issue_invoice() below (admins only), and are never edited.
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

create policy "Org members can view invoices" on public.invoices
  for select to authenticated
  using (public.jwt_org_id() = org_id);

create policy "Org members can view invoice items" on public.invoice_items
  for select to authenticated
  using (public.jwt_org_id() = org_id);

------------------------------------------------------------------------------
-- Issue an invoice in one step:
--   1. bills the chosen logged time (it becomes cost items, as bill_logged_time does),
--   2. checks every chosen item is on this project and not on an issued invoice,
--   3. takes the next number (INV-0001, ...) unless one was typed,
--   4. records the invoice and its lines, and keeps the client details on the project.
-- If anything fails, nothing is saved (and no number is used up).
-- Returns the new invoice's id.
------------------------------------------------------------------------------
create or replace function public.issue_invoice(
  p_project_id bigint,
  p_item_ids bigint[],
  p_entry_ids bigint[],
  p_number text,          -- empty = next number in the sequence
  p_issue_date date,
  p_due_date date,
  p_vat_rate numeric,     -- empty = no VAT
  p_notes text,
  p_client_name text,
  p_client_address text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org text := public.jwt_org_id();
  v_project public.projects;
  v_seller public.org_invoice_settings;
  v_item_ids bigint[] := coalesce(p_item_ids, '{}');
  v_entry_ids bigint[] := coalesce(p_entry_ids, '{}');
  v_number text := trim(coalesce(p_number, ''));
  v_n integer;
  v_subtotal numeric(14,2);
  v_vat numeric(14,2);
  v_invoice_id bigint;
begin
  if v_org is null or not public.jwt_is_org_admin() then
    raise exception 'Only organisation admins can create invoices.';
  end if;

  -- Locking the project means two invoices for it can't be issued at the same moment.
  select * into v_project from public.projects
    where id = p_project_id and org_id = v_org for update;
  if not found then
    raise exception 'Project not found.';
  end if;

  select * into v_seller from public.org_invoice_settings where org_id = v_org for update;
  if not found or trim(v_seller.business_name) = '' then
    raise exception 'Add your business details first.';
  end if;
  if trim(coalesce(p_client_name, '')) = '' then
    raise exception 'Add who the invoice is for (the client''s name).';
  end if;
  if p_issue_date is null then
    raise exception 'Add an issue date.';
  end if;
  if p_due_date is not null and p_due_date < p_issue_date then
    raise exception 'The due date can''t be before the issue date.';
  end if;
  if p_vat_rate is not null and (p_vat_rate < 0 or p_vat_rate > 100 or p_vat_rate <> round(p_vat_rate, 2)) then
    raise exception 'VAT rate must be between 0 and 100, with up to 2 decimal places.';
  end if;

  -- 1. Bill the chosen logged time; the new cost items join the invoice.
  if cardinality(v_entry_ids) > 0 then
    if exists (
      select 1 from unnest(v_entry_ids) as e(id)
      where not exists (select 1 from public.time_entries t
                        where t.id = e.id and t.project_id = v_project.id and t.cost_item_id is null)
    ) then
      raise exception 'Some of that logged time has already been billed. Close the invoice and open it again.';
    end if;
    perform public.bill_logged_time(v_project.id, v_entry_ids, null, 'Booked');
    v_item_ids := v_item_ids || array(
      select distinct cost_item_id from public.time_entries where id = any (v_entry_ids));
  end if;

  -- 2. Check the items.
  if cardinality(v_item_ids) = 0 then
    raise exception 'Tick at least one item to invoice.';
  end if;
  perform 1 from public.cost_items where id = any (v_item_ids) for update;
  if exists (
    select 1 from unnest(v_item_ids) as x(id)
    where not exists (select 1 from public.cost_items c where c.id = x.id and c.project_id = v_project.id)
  ) then
    raise exception 'Some of those items aren''t on this project any more. Close the invoice and open it again.';
  end if;
  if exists (select 1 from public.invoice_items where cost_item_id = any (v_item_ids)) then
    raise exception 'Some of those items are already on an issued invoice. Close the invoice and open it again.';
  end if;

  -- 3. The number: the next in the sequence (skipping any already typed by hand), or the one typed.
  if v_number = '' then
    loop
      update public.org_invoice_settings
        set next_invoice_number = next_invoice_number + 1, updated_at = now()
        where org_id = v_org
        returning next_invoice_number - 1 into v_n;
      v_number := 'INV-' || lpad(v_n::text, 4, '0');
      exit when not exists (select 1 from public.invoices where org_id = v_org and number = v_number);
    end loop;
  elsif exists (select 1 from public.invoices where org_id = v_org and number = v_number) then
    raise exception 'Invoice number % has already been used.', v_number;
  end if;

  -- 4. Record it. Totals are to the penny; VAT is worked out on the subtotal.
  select sum(total) into v_subtotal from public.cost_items where id = any (v_item_ids);
  v_vat := case when p_vat_rate is null then 0 else round(v_subtotal * p_vat_rate / 100, 2) end;

  insert into public.invoices (
    org_id, project_id, number, issue_date, due_date, currency, vat_rate, subtotal, vat, total,
    client_name, client_address, notes,
    seller_name, seller_address, seller_email, seller_payment_details, created_by)
  values (
    v_org, v_project.id, v_number, p_issue_date, p_due_date, v_project.currency, p_vat_rate,
    v_subtotal, v_vat, v_subtotal + v_vat,
    trim(p_client_name), trim(coalesce(p_client_address, '')), trim(coalesce(p_notes, '')),
    trim(v_seller.business_name), v_seller.address, v_seller.email, v_seller.payment_details,
    auth.jwt()->>'sub')
  returning id into v_invoice_id;

  insert into public.invoice_items (org_id, invoice_id, cost_item_id, position, description, category, quantity, unit_cost, total)
  select v_org, v_invoice_id, c.id, row_number() over (order by c.id), c.description, coalesce(pc.name, ''),
         c.quantity, c.unit_cost, c.total
  from public.cost_items c
  left join public.project_categories pc on pc.id = c.category_id
  where c.id = any (v_item_ids);

  -- Keep the client details on the project for next time.
  update public.projects
    set client_name = trim(p_client_name), client_address = trim(coalesce(p_client_address, ''))
    where id = v_project.id
      and (client_name, client_address) is distinct from (trim(p_client_name), trim(coalesce(p_client_address, '')));

  return v_invoice_id;
end;
$$;

revoke execute on function public.issue_invoice(bigint, bigint[], bigint[], text, date, date, numeric, text, text, text) from public, anon;
grant execute on function public.issue_invoice(bigint, bigint[], bigint[], text, date, date, numeric, text, text, text) to authenticated;
