# SEQUENCE roadmap

In priority order. Pick one item per session; tick it off here when it's merged.
The same list lives in the claude.ai Project ("SEQNCE / SEQUENCE v1", `claude/sequence-todo.md`). Update both when either changes.

## 1. Before real customers use it

- [ ] **Upgrade Supabase to Pro shortly before launch** (no pausing, daily backups), then delete `.github/workflows/keep-alive.yml`. Until then the workflow keeps the free project awake.
- [ ] **Choose the hosting plan before the first paying customer.** Vercel's free Hobby plan is non-commercial only; a paid product needs Vercel Pro ($20/month per seat) or moving the app's hosting to Cloudflare (commercial use allowed free; data and sign-in stay on Supabase and Clerk). Check which Vercel plan the project is on first. See "When to consider Cloudflare".
- [ ] **Before moving Clerk to production (do these first, in order):**
  1. ~~**Choose and buy a domain.**~~ Done 15 Nov 2026: `sqnce.co.uk` (main address) and `sequenceevents.co.uk` registered at Cloudflare for one year with auto-renew, registrant details private, DNSSEC active. (`sequence.co.uk` belongs to another business.) Pointed at the app on 15 Nov.
  2. ~~**Decide what happens to existing data.**~~ Decided 18 Nov 2026: start fresh on production. Straight after the move, delete the old test rows (projects, costs, tasks, time, invoices, invoice settings) in one SQL step so invoice numbers restart at INV-0001; keep `keep_alive()` and `keep_alive_log`.
  3. ~~**Check whether Google (or other social) sign-in is used.**~~ Checked 18 Nov 2026: no social or enterprise sign-in connections in Clerk and none in the code, so no Google keys needed. If social sign-in is added later, production needs our own keys (Clerk's shared ones don't work there).
  4. **Have the logins ready** in the browser pane: Cloudflare (the domain registrar, to add DNS records), Clerk, Vercel and Supabase.
- [ ] **Move Clerk to a production instance.** At the same time, switch from the deprecated `@clerk/clerk-react` to `@clerk/react`. Then update the Clerk domain in Supabase → Authentication → Third-Party Auth (currently `sought-quail-4553.clerk.accounts.dev`) and the Clerk keys in Vercel. Users can't move between Clerk instances, so everyone signs up again and recreates the organisation and invoice business details. Existing test data is not moved: delete it straight after the move (see the decision above), leaving the keep-alive function and table alone.
- [ ] **At the Clerk production move, also:** add "never sends email" records to `sequenceevents.co.uk` (SPF `v=spf1 -all` + DMARC `p=reject`), and decide `sqnce.co.uk`'s email records alongside Clerk's.
- [ ] **Redirect the old address** `project-dashboard-wczx.vercel.app` to `sqnce.co.uk` once nothing relies on it.
- [ ] **Watch for Cloudflare's registrant-check email** for both domains (Nominet shows name and address "awaiting validation"); unvalidated .uk domains can be suspended.
- [ ] **Shorten the lockout after failed sign-ins.** In Clerk → Protections → user lockout, shorten how long an account stays locked after too many failed sign-in attempts (Clerk's default is 1 hour) and check the attempt limit (10 on new instances; older instances may still allow 100). Not about how long people stay signed in. Set it on the production instance, since settings don't carry over from development.
- [ ] **Install Tailwind properly** (PostCSS/CLI in the Vite build) and remove the CDN script from `index.html`.
- [ ] **A test copy of the app.** Separate Supabase project + Vercel previews; turn `supabase/` files into Supabase migrations.

## 2. Making it easier to keep building

- [ ] **Split up `src/App.jsx`** (about 1,000 lines) into screens/components.
- [ ] **Automated tests** for billing, VAT, rounding and progress-from-tasks.
- [ ] **Delete redundant code:** unused code; the second Vercel project (`project-dashboard`) if not needed; `supabase/bill-logged-time.sql` (superseded by `billing-v2.sql`); old merged branches.
- [ ] **Library upgrades:** Recharts 2 → 3 (2.x no longer maintained); Vite 4 → current.
- [ ] **Time Tracking paging/filters** (the list shows only the latest 50 entries).
- [ ] Idea: **page addresses inside the app** (e.g. `/projects/123`), so links can be shared. Today everything lives at `/`; any other path is a 404.

## 3. Useful for planners

- [ ] **Let team members do more** (tick tasks, log/edit their own time); members can only view today.
- [ ] **Templates:** a new event starts with standard tasks and cost categories.
- [ ] **Event date + deadlines overview:** overdue tasks and unpaid costs across all projects.
- [ ] **Client side of money:** markup or client price per item (invoices are at cost today), "billable to client" flag, record of issued invoices.
- [ ] **Phone layout** for on-site use.
- [ ] Smaller: attach a receipt/invoice file to a cost item.

## When to consider Cloudflare

Decided 16 Nov 2026: stay on Supabase for the database (row-level security + Clerk link + ready-made API; Cloudflare D1 is SQLite with none of these, so moving means rewriting the database functions and writing and securing our own API).

- **Hosting only (small move):** when the first paying customer is near and we're on Vercel Hobby, or Vercel's bill grows.
- **Database too (big move):** only if Supabase's bill grows well beyond Pro (roughly £100+/month), its prices, terms or reliability get worse, a developer joins who can own a backend API, or many customers are far from the UK.
