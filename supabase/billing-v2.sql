-- Simpler billing of logged time, and Hourly Rate rules.
-- Replaces the bill_logged_time function from bill-logged-time.sql. Run once in the Supabase SQL editor.

-- Hourly Rate: 0 or more, up to 2 decimal places.
alter table public.projects
  alter column hourly_rate type numeric(12,2) using round(hourly_rate, 2);
alter table public.projects
  add constraint projects_hourly_rate_not_negative check (hourly_rate >= 0);

-- Bill a project's logged time in one step.
--   p_entry_ids:   which unbilled time entries to bill (empty = all of them)
--   p_category_id: which category to bill into (empty = the project's Staffing/Labour category,
--                  created as "Staffing" if the project doesn't have one)
-- Hours are charged at the rate recorded when they were logged; hours logged with no rate use
-- the project's current hourly rate. One cost item is created per rate.
-- Returns how many cost items were created.
drop function if exists public.bill_logged_time(bigint, text);

create or replace function public.bill_logged_time(
  p_project_id bigint,
  p_entry_ids bigint[] default null,
  p_category_id bigint default null,
  p_status text default 'Booked'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects;
  v_category_id bigint;
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

  select * into v_project from public.projects
    where id = p_project_id and org_id = public.jwt_org_id();
  if not found then
    raise exception 'Project not found.';
  end if;

  if p_category_id is not null then
    select id into v_category_id from public.project_categories
      where id = p_category_id and project_id = v_project.id;
    if not found then
      raise exception 'That category isn''t on this project.';
    end if;
  else
    select id into v_category_id from public.project_categories
      where project_id = v_project.id and name ~* '(staff|labou?r|time)'
      order by id limit 1;
    if v_category_id is null then
      insert into public.project_categories (org_id, project_id, name, budget)
        values (v_project.org_id, v_project.id, 'Staffing', 0)
        returning id into v_category_id;
    end if;
  end if;

  -- The entries being billed: unbilled, on this project, and (if given) in the chosen list.
  -- Each entry's rate is the one recorded when it was logged, or the project's rate if none was.
  if not exists (
    select 1 from public.time_entries
    where project_id = v_project.id and cost_item_id is null
      and (p_entry_ids is null or id = any (p_entry_ids))
  ) then
    raise exception 'There are no unbilled hours to bill.';
  end if;
  if exists (
    select 1 from public.time_entries
    where project_id = v_project.id and cost_item_id is null
      and (p_entry_ids is null or id = any (p_entry_ids))
      and coalesce(nullif(hourly_rate, 0), v_project.hourly_rate, 0) = 0
  ) then
    raise exception 'Set an hourly rate on the project before billing its logged time.';
  end if;

  for v_group in
    select coalesce(nullif(hourly_rate, 0), v_project.hourly_rate) as rate,
           sum(hours) as hours, min(entry_date) as first_day, max(entry_date) as last_day
    from public.time_entries
    where project_id = v_project.id and cost_item_id is null
      and (p_entry_ids is null or id = any (p_entry_ids))
    group by 1 order by 1
  loop
    insert into public.cost_items (org_id, project_id, category_id, description, quantity, unit_cost, status)
    values (
      v_project.org_id,
      v_project.id,
      v_category_id,
      case when v_group.first_day = v_group.last_day
        then format('Logged time: %s h (%s)', trim(to_char(v_group.hours, 'FM9999990.99'), '.'), v_group.first_day)
        else format('Logged time: %s h (%s to %s)', trim(to_char(v_group.hours, 'FM9999990.99'), '.'), v_group.first_day, v_group.last_day)
      end,
      round(v_group.hours, 2),
      round(v_group.rate, 2),
      p_status
    )
    returning id into v_item_id;

    update public.time_entries
      set cost_item_id = v_item_id
      where project_id = v_project.id and cost_item_id is null
        and (p_entry_ids is null or id = any (p_entry_ids))
        and coalesce(nullif(hourly_rate, 0), v_project.hourly_rate) = v_group.rate;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.bill_logged_time(bigint, bigint[], bigint, text) from public, anon;
grant execute on function public.bill_logged_time(bigint, bigint[], bigint, text) to authenticated;
