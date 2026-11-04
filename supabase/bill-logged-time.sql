-- Bill logged time: turn a project's unbilled time entries into cost items.
-- Uses the helper functions from cost-tracking.sql. Run once in the Supabase SQL editor.

-- Each time entry remembers which cost item billed it (empty = not billed yet).
-- Deleting that cost item makes its hours unbilled again.
alter table public.time_entries
  add column cost_item_id bigint references public.cost_items(id) on delete set null;
create index time_entries_cost_item_id_idx on public.time_entries (cost_item_id);

-- Billed hours can't be deleted (delete the cost item first to unbill them).
alter policy "Org admins can delete own time entries" on public.time_entries
  using (public.jwt_org_id() = org_id
    and public.jwt_is_org_admin()
    and auth.jwt()->>'sub' = user_id
    and cost_item_id is null);

-- Bills all unbilled hours on the category's project into that category, in one step.
-- Hours are charged at the rate recorded when they were logged; hours logged with no rate
-- use the project's current hourly rate. One cost item is created per rate.
-- Returns how many cost items were created.
create or replace function public.bill_logged_time(p_category_id bigint, p_status text default 'Booked')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category public.project_categories;
  v_project_rate numeric;
  v_group record;
  v_item_id bigint;
  v_count integer := 0;
begin
  if not public.jwt_is_org_admin() then
    raise exception 'Only organisation admins can bill logged time.';
  end if;
  if p_status not in ('Quoted', 'Booked', 'Invoiced', 'Paid') then
    raise exception 'Unknown status %', p_status;
  end if;

  select * into v_category from public.project_categories
    where id = p_category_id and org_id = public.jwt_org_id();
  if not found then
    raise exception 'Category not found.';
  end if;

  select coalesce(hourly_rate, 0) into v_project_rate from public.projects where id = v_category.project_id;

  if exists (
    select 1 from public.time_entries
    where project_id = v_category.project_id and cost_item_id is null
      and coalesce(nullif(hourly_rate, 0), v_project_rate) = 0
  ) then
    raise exception 'Set an hourly rate on the project before billing its logged time.';
  end if;

  for v_group in
    select coalesce(nullif(hourly_rate, 0), v_project_rate) as rate,
           sum(hours) as hours,
           min(entry_date) as first_day,
           max(entry_date) as last_day
    from public.time_entries
    where project_id = v_category.project_id and cost_item_id is null
    group by 1
    order by 1
  loop
    insert into public.cost_items (org_id, project_id, category_id, description, quantity, unit_cost, status)
    values (
      v_category.org_id,
      v_category.project_id,
      v_category.id,
      format('Logged time: %s h (%s to %s)', trim(to_char(v_group.hours, 'FM9999990.99'), '.'), v_group.first_day, v_group.last_day),
      round(v_group.hours, 2),
      round(v_group.rate, 2),
      p_status
    )
    returning id into v_item_id;

    update public.time_entries
      set cost_item_id = v_item_id
      where project_id = v_category.project_id and cost_item_id is null
        and coalesce(nullif(hourly_rate, 0), v_project_rate) = v_group.rate;

    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'There are no unbilled hours on this project.';
  end if;
  return v_count;
end;
$$;

revoke execute on function public.bill_logged_time(bigint, text) from public, anon;
grant execute on function public.bill_logged_time(bigint, text) to authenticated;
