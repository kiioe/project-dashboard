# SQNCE roadmap

In priority order. Pick one item per session; tick it off here when it's merged.
The same list lives in the claude.ai Project ("SEQNCE / SEQUENCE v1", `claude/sequence-todo.md`). Update both when either changes.

## 1. Before real customers use it

- [ ] **Upgrade Supabase to Pro shortly before launch** (no pausing, daily backups), then delete `.github/workflows/keep-alive.yml`. Until then the workflow keeps the free project awake.
- [ ] **Choose the hosting plan before the first paying customer.** Vercel's free Hobby plan is non-commercial only; a paid product needs Vercel Pro ($20/month per seat) or moving the app's hosting to Cloudflare (commercial use allowed free; data and sign-in stay on Supabase and Clerk). Check which Vercel plan the project is on first. See "When to consider Cloudflare".
- [x] **Phone app and layout** (done 22 Nov 2026): installable as "SQNCE" (manifest, icons, full screen); below 768px wide the app shows a compact header, bottom tabs Projects / Tasks / Costs / Time, projects as cards (tap for Tasks, Costs, Edit, Invoice, Delete), cost items as stacked rows. Timeline and budget chart are desktop only. Code: `src/PhoneLayout.jsx`.
- [x] **Phone polish** (22 Nov 2026, E's feedback): drag down to refresh on every tab; Invoices in a slide-up panel from a button on Projects; round + button (bottom right) on Projects (new project; 23 Nov), Tasks, Costs (item or category) and Time; tap the project title to switch project (design a1); List | Overview switch on Projects with "Coming up" countdowns and per-project budget bars (design b1). Code: `src/PhoneOverview.jsx`, `AddButton`/`BottomSheet`/`ProjectTitle` in `src/PhoneLayout.jsx`.
- [ ] **UK date format (E, 22 Nov).** Dates shown the UK way (22/11/2026 or 22 Nov 2026) everywhere, including invoices and PDFs; US format as an option. Rules to agree (per organisation or per user; date pickers).
- [ ] **Refunds and credit notes (E, 22 Nov).** Issued invoices are never edited: reduce or cancel them with a credit note (CN-0001…) and its PDF. Refunds need a paid/unpaid status on invoices first. Rules to agree (credit on account, re-billing credited items, partial refunds). Money: full live test.
- [ ] **Billing details partly filled in (E, 22 Nov).** Invoice business details and client filled in from what's already in the app (organisation name, signed-in user's email, clients used before). Rules to agree.
- [ ] **Brand name is SQNCE** (decided 21 Nov 2026): a SEQUENCE word mark exists in classes 9/42 (Sequence HQ Ltd, billing software). The app's visible text, page title and home-screen name now say SQNCE (22 Nov). Search the UK IPO for SQNCE before filing.
- [ ] **Redirect the old address** `project-dashboard-wczx.vercel.app` to `sqnce.co.uk` once nothing relies on it.
- [ ] **Watch for Cloudflare's registrant-check email** for both domains (Nominet shows name and address "awaiting validation"); unvalidated .uk domains can be suspended.
- [ ] **Install Tailwind properly** (PostCSS/CLI in the Vite build) and remove the CDN script from `index.html`.
- [ ] **A test copy of the app.** Separate Supabase project + Vercel previews; turn `supabase/` files into Supabase migrations.

## 2. Making it easier to keep building

- [ ] **Split up `src/App.jsx`** (about 1,000 lines) into screens/components.
- [ ] **Automated tests** for billing, VAT, rounding, invoicing and progress-from-tasks.
- [ ] **Delete redundant code:** unused code; the second Vercel project (`project-dashboard`) if not needed; `supabase/bill-logged-time.sql` (superseded by `billing-v2.sql`); `claim_invoice_number()` (replaced by `issue_invoice()`); old merged branches.
- [ ] **Library upgrades:** Recharts 2 → 3 (2.x no longer maintained); Vite 4 → current.
- [ ] **Time Tracking paging/filters** (the list shows only the latest 50 entries).
- [ ] Idea: **page addresses inside the app** (e.g. `/projects/123`), so links can be shared. Today everything lives at `/`; any other path is a 404.

## 3. Useful for planners

- [ ] **Let team members do more** (tick tasks, log/edit their own time); members can only view today.
- [ ] **Easier task entry (E, 22 Nov).** Quick-add box (Enter adds, stays open), paste a list to add many, edit in place, due date and owner on the same line.
- [ ] **Templates: pre-loaded tasks and costs (E, 22 Nov).** A new event starts with standard tasks and cost categories with typical items and costs in, to adjust. Rules to agree (per organisation, several templates, Quoted at £0 or typical prices).
- [ ] **Event date + deadlines overview:** overdue tasks and unpaid costs across all projects.
- [ ] **Client side of money:** markup or client price per item (invoices are at cost today), "billable to client" flag. Later invoice ideas: deposits, paid/unpaid status (needed for refunds).
- [ ] Smaller: attach a receipt/invoice file to a cost item.

## When to consider Cloudflare

Decided 16 Nov 2026: stay on Supabase for the database (row-level security + Clerk link + ready-made API; Cloudflare D1 is SQLite with none of these, so moving means rewriting the database functions and writing and securing our own API).

- **Hosting only (small move):** when the first paying customer is near and we're on Vercel Hobby, or Vercel's bill grows.
- **Database too (big move):** only if Supabase's bill grows well beyond Pro (roughly £100+/month), its prices, terms or reliability get worse, a developer joins who can own a backend API, or many customers are far from the UK.
