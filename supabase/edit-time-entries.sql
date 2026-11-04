-- Let organisation admins edit their own logged time, as long as it hasn't been billed yet.
-- Uses the helper functions from cost-tracking.sql. Run once in the Supabase SQL editor.

-- Edit rule: own entries, in your organisation, not billed; it must stay that way after the edit
-- (so editing can't bill or unbill hours, or move them to another organisation's project).
create policy "Org admins can edit own unbilled time" on public.time_entries
  for update to authenticated
  using (public.jwt_org_id() = org_id
    and public.jwt_is_org_admin()
    and auth.jwt()->>'sub' = user_id
    and cost_item_id is null)
  with check (public.jwt_org_id() = org_id
    and public.jwt_is_org_admin()
    and auth.jwt()->>'sub' = user_id
    and cost_item_id is null
    and exists (select 1 from public.projects p where p.id = project_id and p.org_id = time_entries.org_id));

-- Hours: more than 0, at most 24, up to 2 decimal places.
alter table public.time_entries
  alter column hours type numeric(4,2) using round(hours, 2);

-- Moving hours to another project picks up that project's hourly rate
-- (reuses the function that sets the rate when time is first logged).
create trigger time_entries_reset_rate_on_move
  before update of project_id on public.time_entries
  for each row
  when (old.project_id is distinct from new.project_id)
  execute function public.set_time_entry_rate();
