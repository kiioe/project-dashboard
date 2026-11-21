-- Keep invoices for audit, explain why invoiced items can't be deleted, and VAT defaults to 20%.
-- Run once in the Supabase SQL editor, after generate-invoice.sql.

------------------------------------------------------------------------------
-- 1. Invoices outlive their project. Deleting a project keeps its issued invoices
--    (with the project's name copied onto them), so they can still be downloaded.
------------------------------------------------------------------------------
alter table public.invoices add column project_name text not null default '';
update public.invoices i set project_name = p.name from public.projects p where p.id = i.project_id;

alter table public.invoices alter column project_id drop not null;
alter table public.invoices
  drop constraint invoices_project_id_fkey,
  add constraint invoices_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete set null;

-- An invoice's lines keep their copy of each item; the link to the live item clears
-- only when the whole project is deleted (see the rule below).
alter table public.invoice_items
  drop constraint invoice_items_cost_item_id_fkey,
  add constraint invoice_items_cost_item_id_fkey
    foreign key (cost_item_id) references public.cost_items(id) on delete set null;

------------------------------------------------------------------------------
-- 2. A cost item on an issued invoice can't be deleted (on its own or with its category),
--    so the invoice stays accurate and its hours can't be billed twice.
--    Deleting the whole project is allowed: the invoices are kept.
------------------------------------------------------------------------------
create or replace function public.keep_invoiced_cost_items() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number text;
begin
  select i.number into v_number
    from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
    where ii.cost_item_id = old.id
    limit 1;
  -- The project still existing means this isn't part of deleting the whole project.
  if v_number is not null and exists (select 1 from public.projects where id = old.project_id) then
    raise exception '"%" is on invoice %, so it can''t be deleted.', old.description, v_number;
  end if;
  return old;
end;
$$;

create trigger cost_items_keep_invoiced
  before delete on public.cost_items
  for each row execute function public.keep_invoiced_cost_items();

------------------------------------------------------------------------------
-- 3. VAT defaults to 20%. Unticking VAT on one invoice no longer changes the default,
--    so put back 20% wherever it was saved as 0.
------------------------------------------------------------------------------
update public.org_invoice_settings set default_vat_rate = 20 where default_vat_rate = 0;

------------------------------------------------------------------------------
-- 4. issue_invoice() now also copies the project's name onto the invoice.
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
    org_id, project_id, project_name, number, issue_date, due_date, currency, vat_rate, subtotal, vat, total,
    client_name, client_address, notes,
    seller_name, seller_address, seller_email, seller_payment_details, created_by)
  values (
    v_org, v_project.id, v_project.name, v_number, p_issue_date, p_due_date, v_project.currency, p_vat_rate,
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
