# SEQUENCE roadmap

In priority order. Pick one item per session; tick it off here when it's merged.
The same list lives in the claude.ai Project ("SEQNCE / SEQUENCE v1", `claude/sequence-todo.md`). Update both when either changes.

## 1. Before real customers use it

- [ ] **Upgrade Supabase to Pro shortly before launch** (no pausing, daily backups), then delete `.github/workflows/keep-alive.yml`. Until then the workflow keeps the free project awake.
- [ ] **Move Clerk to a production instance.** At the same time, switch from the deprecated `@clerk/clerk-react` to `@clerk/react`. Then update the Clerk domain in Supabase → Authentication → Third-Party Auth (currently `sought-quail-4553.clerk.accounts.dev`) and the Clerk keys in Vercel.
- [ ] **Install Tailwind properly** (PostCSS/CLI in the Vite build) and remove the CDN script from `index.html`.
- [ ] **A test copy of the app.** Separate Supabase project + Vercel previews; turn `supabase/` files into Supabase migrations.

## 2. Making it easier to keep building

- [ ] **Split up `src/App.jsx`** (about 1,000 lines) into screens/components.
- [ ] **Automated tests** for billing, VAT, rounding and progress-from-tasks.
- [ ] **Delete redundant code:** unused code; the second Vercel project (`project-dashboard`) if not needed; `supabase/bill-logged-time.sql` (superseded by `billing-v2.sql`); old merged branches.
- [ ] **Library upgrades:** Recharts 2 → 3 (2.x no longer maintained); Vite 4 → current.
- [ ] **Time Tracking paging/filters** (the list shows only the latest 50 entries).

## 3. Useful for planners

- [ ] **Let team members do more** (tick tasks, log/edit their own time); members can only view today.
- [ ] **Templates:** a new event starts with standard tasks and cost categories.
- [ ] **Event date + deadlines overview:** overdue tasks and unpaid costs across all projects.
- [ ] **Client side of money:** markup or client price per item (invoices are at cost today), "billable to client" flag, record of issued invoices.
- [ ] **Phone layout** for on-site use.
- [ ] Smaller: attach a receipt/invoice file to a cost item.
