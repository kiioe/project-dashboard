-- Payments, credit notes and refunds on issued invoices (agreed with E, 25 Nov 2026).
-- Run once in the Supabase SQL editor, after date-format.sql.
--
-- Rules:
--   * An issued invoice is never edited or deleted. To reduce or cancel it, issue a credit note
--     (CN-0001, ... per organisation) against it, for the whole invoice or some lines (full or part amounts).
--   * Payments received are recorded against an invoice (date, amount, method). A payment can't be more
--     than what's still owed. A payment entered by mistake can be deleted, unless a refund depends on it.
--   * A refund is recorded against a credit note, only up to the money received beyond what's now owed.
--   * Balance = total - credits - payments + refunds. Status: Unpaid, Part paid, Paid, Credited (fully).
--   * No credit on account: a credit only reduces its own invoice, or is refunded.
--   * When a line has been credited in full, its cost item (or billed time) goes back to "not yet invoiced"
--     so it can be billed again. A part-credited line stays invoiced.
--   * Client money doesn't change a project's Amount Spent.
--   * Everyone in the organisation can view; only admins record, through the functions below.

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------
alter table public.org_invoice_settings
  add column next_credit_note_number integer not null default 1 check (next_credit_note_number > 0);

create table public.invoice_payments (
  id bigint generated always as identity primary key,
  org_id text not null,
  invoice_id bigint not null references public.invoices(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null,
  method text not null check (method in ('Bank transfer', 'Card', 'Cash', 'Other')),
  note text not null default '' check (length(note) <= 500),
  created_by text,
  created_at timestamptz not null default now()
);
create index invoice_payments_invoice_id_idx on public.invoice_payments (invoice_id);

create table public.credit_notes (
  id bigint generated always as identity primary key,
  org_id text not null,
  invoice_id bigint not null references public.invoices(id) on delete restrict,
  number text not null,
  issue_date date not null,
  reason text not null check (length(trim(reason)) between 1 and 1000),
  currency text not null,
  vat_rate numeric(5,2),
  subtotal numeric(14,2) not null check (subtotal > 0),
  vat numeric(14,2) not null default 0 check (vat >= 0),
  total numeric(14,2) not null,
  created_by text,
  created_at timestamptz not null default now(),
  unique (org_id, number)
);
create index credit_notes_invoice_id_idx on public.credit_notes (invoice_id);

create table public.credit_note_items (
  id bigint generated always as identity primary key,
  org_id text not null,
  credit_note_id bigint not null references public.credit_notes(id) on delete restrict,
  invoice_item_id bigint not null references public.invoice_items(id) on delete restrict,
  position integer not null,
  description text not null,
  category text not null default '',
  amount numeric(14,2) not null check (amount > 0),  -- before VAT
  released_cost_item_id bigint                       -- set when this credit made the item billable again
);
create index credit_note_items_credit_note_id_idx on public.credit_note_items (credit_note_id);
create index credit_note_items_invoice_item_id_idx on public.credit_note_items (invoice_item_id);

create table public.refunds (
  id bigint generated always as identity primary key,
  org_id text not null,
  invoice_id bigint not null references public.invoices(id) on delete restrict,
  credit_note_id bigint not null references public.credit_notes(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  refunded_on date not null,
  method text not null check (method in ('Bank transfer', 'Card', 'Cash', 'Other')),
  note text not null default '' check (length(note) <= 500),
  created_by text,
  created_at timestamptz not null default now()
);
create index refunds_invoice_id_idx on public.refunds (invoice_id);

-- Everyone in the organisation can view. Nobody writes directly; admins use the functions below.
alter table public.invoice_payments enable row level security;
alter table public.credit_notes enable row level security;
alter table public.credit_note_items enable row level security;
alter table public.refunds enable row level security;

create policy "Org members can view payments" on public.invoice_payments
  for select to authenticated using (public.jwt_org_id() = org_id);
create policy "Org members can view credit notes" on public.credit_notes
  for select to authenticated using (public.jwt_org_id() = org_id);
create policy "Org members can view credit note items" on public.credit_note_items
  for select to authenticated using (public.jwt_org_id() = org_id);
create policy "Org members can view refunds" on public.refunds
  for select to authenticated using (public.jwt_org_id() = org_id);

------------------------------------------------------------------------------
-- Helpers (not callable from the app)
------------------------------------------------------------------------------
-- Locks the invoice (so two changes can't race) and checks it's in the caller's organisation.
create or replace function public.lock_org_invoice(p_invoice_id bigint) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invoices;
begin
  if public.jwt_org_id() is null or not public.jwt_is_org_admin() then
    raise exception 'Only organisation admins can record payments, credit notes and refunds.';
  end if;
  select * into v_inv from public.invoices where id = p_invoice_id and org_id = public.jwt_org_id() for update;
  if not found then
    raise exception 'Invoice not found.';
  end if;
  return v_inv;
end;
$$;

-- Money figures for one invoice.
create or replace function public.invoice_money(p_invoice_id bigint,
  out credited numeric, out paid numeric, out refunded numeric, out balance numeric, out refundable numeric)
language sql stable security definer set search_path = public as $$
  select c.t, p.t, r.t,
         i.total - c.t - p.t + r.t,
         greatest(p.t - r.t - (i.total - c.t), 0)
  from public.invoices i,
       lateral (select coalesce(sum(total), 0) t from public.credit_notes where invoice_id = i.id) c,
       lateral (select coalesce(sum(amount), 0) t from public.invoice_payments where invoice_id = i.id) p,
       lateral (select coalesce(sum(amount), 0) t from public.refunds where invoice_id = i.id) r
  where i.id = p_invoice_id;
$$;

create or replace function public.check_money_args(p_amount numeric, p_date date, p_method text) returns void
language plpgsql immutable as $$
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'The amount must be more than 0, with up to 2 decimal places.';
  end if;
  if p_date is null then
    raise exception 'Add a date.';
  end if;
  if p_method is null or p_method not in ('Bank transfer', 'Card', 'Cash', 'Other') then
    raise exception 'Choose how it was paid.';
  end if;
end;
$$;

revoke execute on function public.lock_org_invoice(bigint) from public, anon, authenticated;
revoke execute on function public.invoice_money(bigint) from public, anon, authenticated;
revoke execute on function public.check_money_args(numeric, date, text) from public, anon, authenticated;

------------------------------------------------------------------------------
-- Payments
------------------------------------------------------------------------------
create or replace function public.record_payment(p_invoice_id bigint, p_amount numeric, p_paid_on date, p_method text, p_note text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invoices := public.lock_org_invoice(p_invoice_id);
  v_m record;
  v_id bigint;
begin
  perform public.check_money_args(p_amount, p_paid_on, p_method);
  select * into v_m from public.invoice_money(v_inv.id);
  if v_m.balance <= 0 then
    raise exception 'Nothing is owed on invoice %.', v_inv.number;
  end if;
  if p_amount > v_m.balance then
    raise exception 'That''s more than the % still owed on invoice %.', v_m.balance, v_inv.number;
  end if;
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on, method, note, created_by)
  values (v_inv.org_id, v_inv.id, p_amount, p_paid_on, p_method, left(trim(coalesce(p_note, '')), 500), auth.jwt()->>'sub')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_payment(p_payment_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_invoice_id bigint;
  v_inv public.invoices;
begin
  select invoice_id into v_invoice_id from public.invoice_payments where id = p_payment_id and org_id = public.jwt_org_id();
  if v_invoice_id is null then
    raise exception 'Payment not found.';
  end if;
  v_inv := public.lock_org_invoice(v_invoice_id);
  if exists (select 1 from public.refunds where invoice_id = v_inv.id) then
    raise exception 'Invoice % has a refund, so its payments can''t be deleted. Delete the refund first.', v_inv.number;
  end if;
  delete from public.invoice_payments where id = p_payment_id;
end;
$$;

------------------------------------------------------------------------------
-- Credit notes
--   p_lines: [{"invoice_item_id": 12, "amount": 150.00}, ...] (amounts before VAT)
------------------------------------------------------------------------------
create or replace function public.issue_credit_note(p_invoice_id bigint, p_lines jsonb, p_issue_date date, p_reason text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invoices := public.lock_org_invoice(p_invoice_id);
  v_line record;
  v_subtotal numeric(14,2);
  v_vat numeric(14,2);
  v_prev_sub numeric(14,2);
  v_prev_vat numeric(14,2);
  v_n integer;
  v_number text;
  v_cn_id bigint;
begin
  if p_issue_date is null then
    raise exception 'Add an issue date.';
  end if;
  if p_issue_date < v_inv.issue_date then
    raise exception 'A credit note can''t be dated before its invoice.';
  end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'Add a reason for the credit note.';
  end if;
  if length(trim(p_reason)) > 1000 then
    raise exception 'The reason can be up to 1,000 characters.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Choose at least one line to credit.';
  end if;

  -- Each chosen line, with what's still uncredited on it.
  set local client_min_messages = warning;
  drop table if exists cn_lines;
  create temp table cn_lines on commit drop as
    select ii.id as invoice_item_id, ii.position, ii.description, ii.category, ii.total, ii.cost_item_id,
           (x->>'amount')::numeric as amount,
           ii.total - coalesce((select sum(ci.amount) from public.credit_note_items ci where ci.invoice_item_id = ii.id), 0) as remaining
    from jsonb_array_elements(p_lines) x
    left join public.invoice_items ii on ii.id = (x->>'invoice_item_id')::bigint and ii.invoice_id = v_inv.id;

  if exists (select 1 from cn_lines where invoice_item_id is null) then
    raise exception 'Some of those lines aren''t on invoice %.', v_inv.number;
  end if;
  if (select count(*) from cn_lines) <> (select count(distinct invoice_item_id) from cn_lines) then
    raise exception 'Each line can be credited once per credit note.';
  end if;
  if exists (select 1 from cn_lines where amount is null or amount <= 0 or amount <> round(amount, 2)) then
    raise exception 'Each amount must be more than 0, with up to 2 decimal places.';
  end if;
  for v_line in select * from cn_lines where amount > remaining loop
    if v_line.remaining <= 0 then
      raise exception '"%" has already been credited in full.', v_line.description;
    end if;
    raise exception '"%" has only % left to credit.', v_line.description, v_line.remaining;
  end loop;

  -- Totals. VAT at the invoice's rate; the last credit takes exactly what's left, so pennies always add up.
  select sum(amount) into v_subtotal from cn_lines;
  select coalesce(sum(subtotal), 0), coalesce(sum(vat), 0) into v_prev_sub, v_prev_vat
    from public.credit_notes where invoice_id = v_inv.id;
  if v_inv.vat_rate is null then
    v_vat := 0;
  elsif v_prev_sub + v_subtotal = v_inv.subtotal then
    v_vat := v_inv.vat - v_prev_vat;
  else
    v_vat := least(round(v_subtotal * v_inv.vat_rate / 100, 2), v_inv.vat - v_prev_vat);
  end if;

  -- The number: CN-0001, ... per organisation, skipping any already used.
  insert into public.org_invoice_settings (org_id) values (v_inv.org_id) on conflict (org_id) do nothing;
  loop
    update public.org_invoice_settings
      set next_credit_note_number = next_credit_note_number + 1, updated_at = now()
      where org_id = v_inv.org_id
      returning next_credit_note_number - 1 into v_n;
    v_number := 'CN-' || lpad(v_n::text, 4, '0');
    exit when not exists (select 1 from public.credit_notes where org_id = v_inv.org_id and number = v_number);
  end loop;

  insert into public.credit_notes (org_id, invoice_id, number, issue_date, reason, currency, vat_rate, subtotal, vat, total, created_by)
  values (v_inv.org_id, v_inv.id, v_number, p_issue_date, trim(p_reason), v_inv.currency, v_inv.vat_rate,
          v_subtotal, v_vat, v_subtotal + v_vat, auth.jwt()->>'sub')
  returning id into v_cn_id;

  -- Lines credited in full release their cost item, so it can go on a new invoice.
  insert into public.credit_note_items (org_id, credit_note_id, invoice_item_id, position, description, category, amount, released_cost_item_id)
  select v_inv.org_id, v_cn_id, invoice_item_id, row_number() over (order by position), description, category, amount,
         case when amount = remaining then cost_item_id end
  from cn_lines;

  update public.invoice_items ii set cost_item_id = null
    from cn_lines l
    where ii.id = l.invoice_item_id and l.amount = l.remaining;

  return v_cn_id;
end;
$$;

------------------------------------------------------------------------------
-- Refunds
------------------------------------------------------------------------------
create or replace function public.record_refund(p_credit_note_id bigint, p_amount numeric, p_refunded_on date, p_method text, p_note text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_cn public.credit_notes;
  v_inv public.invoices;
  v_m record;
  v_cn_left numeric;
  v_id bigint;
begin
  select * into v_cn from public.credit_notes where id = p_credit_note_id and org_id = public.jwt_org_id();
  if not found then
    raise exception 'Credit note not found.';
  end if;
  v_inv := public.lock_org_invoice(v_cn.invoice_id);
  perform public.check_money_args(p_amount, p_refunded_on, p_method);
  if p_refunded_on < v_cn.issue_date then
    raise exception 'A refund can''t be dated before its credit note.';
  end if;
  select * into v_m from public.invoice_money(v_inv.id);
  v_cn_left := v_cn.total - coalesce((select sum(amount) from public.refunds where credit_note_id = v_cn.id), 0);
  if least(v_m.refundable, v_cn_left) <= 0 then
    raise exception 'Nothing can be refunded against %: the client hasn''t paid more than they now owe.', v_cn.number;
  end if;
  if p_amount > least(v_m.refundable, v_cn_left) then
    raise exception 'You can refund up to % against %.', least(v_m.refundable, v_cn_left), v_cn.number;
  end if;
  insert into public.refunds (org_id, invoice_id, credit_note_id, amount, refunded_on, method, note, created_by)
  values (v_inv.org_id, v_inv.id, v_cn.id, p_amount, p_refunded_on, p_method, left(trim(coalesce(p_note, '')), 500), auth.jwt()->>'sub')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_refund(p_refund_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_invoice_id bigint;
begin
  select invoice_id into v_invoice_id from public.refunds where id = p_refund_id and org_id = public.jwt_org_id();
  if v_invoice_id is null then
    raise exception 'Refund not found.';
  end if;
  perform public.lock_org_invoice(v_invoice_id);
  delete from public.refunds where id = p_refund_id;
end;
$$;

revoke execute on function public.record_payment(bigint, numeric, date, text, text) from public, anon;
revoke execute on function public.delete_payment(bigint) from public, anon;
revoke execute on function public.issue_credit_note(bigint, jsonb, date, text) from public, anon;
revoke execute on function public.record_refund(bigint, numeric, date, text, text) from public, anon;
revoke execute on function public.delete_refund(bigint) from public, anon;
grant execute on function public.record_payment(bigint, numeric, date, text, text) to authenticated;
grant execute on function public.delete_payment(bigint) to authenticated;
grant execute on function public.issue_credit_note(bigint, jsonb, date, text) to authenticated;
grant execute on function public.record_refund(bigint, numeric, date, text, text) to authenticated;
grant execute on function public.delete_refund(bigint) to authenticated;
