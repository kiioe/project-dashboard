-- Let organisation admins change their organisation's projects (e.g. raise the budget).
-- Uses the helper functions from cost-tracking.sql. Run once in the Supabase SQL editor.
create policy "Org admins can update org projects" on public.projects
  for update to authenticated
  using (public.jwt_org_id() = org_id and public.jwt_is_org_admin())
  with check (public.jwt_org_id() = org_id and public.jwt_is_org_admin());
