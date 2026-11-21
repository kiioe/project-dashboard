# SQNCE roadmap

In priority order. Pick one item per session; tick it off here when it's merged.
The same list lives in the claude.ai Project ("SEQNCE / SEQUENCE v1", `claude/sequence-todo.md`). Update both when either changes.

## 1. Before real customers use it

- [ ] **Upgrade Supabase to Pro shortly before launch** (no pausing, daily backups), then delete `.github/workflows/keep-alive.yml`. Until then the workflow keeps the free project awake.
- [ ] **Choose the hosting plan before the first paying customer.** Vercel's free Hobby plan is non-commercial only; a paid product needs Vercel Pro ($20/month per seat) or moving the app's hosting to Cloudflare (commercial use allowed free; data and sign-in stay on Supabase and Clerk). Check which Vercel plan the project is on first. See "When to consider Cloudflare".
- [ ] **Finish moving Clerk to production (in progress).** Production instance, DNS, lockout (10 tries → 1 minute), `@clerk/react` v6, the live `pk_live_` key in Vercel and Supabase trusting only `clerk.sqnce.co.uk` are done (18 Nov). E signed up on production and created the organisation; the old test data was deleted and the keep-alive job checked green (19 Nov). Left: E re-enters the invoice business details, then a full live test in E's own browser (sign in with no `accounts.dev` address, create a project, admin/member rules, first invoice is INV-0001).
- [ ] **Phone app and layout (next after the Clerk move).** (a) Installable app (PWA): manifest, icon, full screen, named "SQNCE", so Safari → Share → Add to Home Screen opens it without browser bars. (b) Phone layout following the approved mock-ups (https://claude.ai/artifact/WvrtA5778vpgbBFE388npC): compact header (organisation switcher, account), bottom tabs Projects / Tasks / Costs / Time, projects as cards. No SQL.
- [ ] **Brand name is SQNCE** (decided 21 Nov 2026): a SEQUENCE word mark exists in classes 9/42 (Sequence HQ Ltd, billing software). Rename "SEQUENCE" in the app's visible text to SQNCE (can ride with the phone item). Search the UK IPO for SQNCE before filing.
- [ ] **Redirect the old address** `project-dashboard-wczx.vercel.app` to `sqnce.co.uk` once nothing relies on it.
- [ ] **Watch for Cloudflare's registrant-check email** for both domains (Nominet shows name and address "awaiting validation"); unvalidated .uk domains can be suspended.
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
- [ ] Smaller: attach a receipt/invoice file to a cost item.

## When to consider Cloudflare

Decided 16 Nov 2026: stay on Supabase for the database (row-level security + Clerk link + ready-made API; Cloudflare D1 is SQLite with none of these, so moving means rewriting the database functions and writing and securing our own API).

- **Hosting only (small move):** when the first paying customer is near and we're on Vercel Hobby, or Vercel's bill grows.
- **Database too (big move):** only if Supabase's bill grows well beyond Pro (roughly £100+/month), its prices, terms or reliability get worse, a developer joins who can own a backend API, or many customers are far from the UK.
