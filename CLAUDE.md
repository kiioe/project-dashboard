# SEQUENCE: project dashboard for event planners

A dashboard for wedding and private-event planners: projects, tasks, costs, time tracking and PDF invoices.
The to-do list is in `ROADMAP.md`. Keep it up to date.

## Stack

- **React + Vite**, deployed on **Vercel** (`project-dashboard-wczx`). Merging to `main` deploys automatically.
  Live app: https://sqnce.co.uk (main address). `www.sqnce.co.uk`, `sequenceevents.co.uk` and `www.sequenceevents.co.uk` 308-redirect to it (set in Vercel → Domains; Cloudflare holds CNAMEs to Vercel, proxy off). The old `project-dashboard-wczx.vercel.app` still works.
- **Clerk** for sign-in and organisations. Roles: organisation admins and members.
- **Supabase** (Postgres) for data, with Clerk as a third-party auth provider. All access is controlled by row-level security.
- **Libraries** are locked by `package-lock.json` and built with **Node 22** (`engines` in `package.json`). Vercel installs exactly the locked versions.
- **Tailwind** is currently loaded from the CDN in `index.html`; installing it properly is on the roadmap.

## Code map

- `src/App.jsx`: the main screen (project form, timeline, budget chart, time tracking, project table) and, below 768px wide, the phone layout (`renderPhone`). Large; splitting it up is on the roadmap.
- `src/PhoneLayout.jsx`: phone shell (header, bottom tabs, drag-down refresh), `useIsPhone()`, round + `AddButton`, slide-up `BottomSheet`, `ProjectTitle` (tap to switch project). `src/PhoneOverview.jsx`: the phone Overview (coming up, budget bars). `TasksPanel` and `CostsPanel` take `phone` to add via the + button. `public/` holds the app icons and `manifest.webmanifest` (installable app).
- `src/CostsPanel.jsx`: cost categories and items, billing logged time, the "Generate invoice" button and the project's issued invoices.
- `src/TasksPanel.jsx`: project tasks. Progress comes from these.
- `src/InvoiceDialog.jsx` and `src/invoicePdf.js`: the invoice preview and PDF builder (jsPDF, loaded only when needed). Issued invoices are rebuilt from their saved copy.
- `src/Feedback.jsx`: feedback. `FeedbackProvider` (wraps the signed-in app), the header `FeedbackLink`, and `SectionFeedback section="…"` (the thumbs strip; put one at the bottom of any new main section, using a section name allowed in `supabase/feedback.sql`).
- `src/SettingsDialog.jsx`: organisation Settings (admins only; header gear via `SettingsLink`): date format, invoice business details, default VAT rate, next invoice number (shown only). Future organisation settings go here.
- `src/money.js`: shared rules for money and hours (typing, parsing, formatting, adding up in pence). Use these; don't duplicate them.
- `src/dates.jsx`: shared rules for showing dates in the organisation's format (`useDates()`, `formatDate`, `formatDatesIn`) and `DateInput` (the browser's date picker with the date echoed underneath). Never show raw `2026-11-28` dates or use `toLocaleDateString`; use `<DateInput>` instead of `<input type="date">`.
- `supabase/*.sql`: database changes, run by hand in the Supabase SQL editor, in this order: `cost-tracking.sql`, `edit-projects.sql`, `bill-logged-time.sql`, `billing-v2.sql`, `edit-time-entries.sql`, `invoices-and-tasks.sql`, `keep-alive.sql`, `keep-alive-v2.sql`, `generate-invoice.sql`, `keep-invoices.sql`, `feedback.sql`, `date-format.sql`.
  Earlier setup (the projects and time_entries tables and their first rules) was done in the dashboard before these files existed.

## How we work

- **One item per session**, picked from `ROADMAP.md`.
- **Agree the rules first.** Propose how a change should behave and get E's confirmation before building.
- **Batch related changes:** one SQL step, one pull request, one check.
- **Check in proportion to risk.** Test properly anything touching money, permissions or data; low-risk changes can be merged for E to check.
- **Database changes:** put them in a new `supabase/*.sql` file in the same pull request. E runs the SQL first, then the pull request is merged. E has given standing approval to merge once the SQL has run (or straight away if there is none).
- **Libraries:** add or upgrade them with `npm install <name>@<version>` and commit the updated `package-lock.json` in the same pull request. Never delete the lock file to fix an install; upgrades are their own roadmap item, not a side effect. `.gitignore` keeps out `node_modules/`, `dist/` and `.env*` files; never commit keys.
- **At the end of a session**, update `ROADMAP.md` (and the Decisions below if any changed).

## Keep-alive watch list

`.github/workflows/keep-alive.yml` stops working if any of these change. Whenever a session touches one of them, make the matching update in the same pull request (or tell E which setting to change), then run the workflow by hand and check it goes green.

- **Supabase key rotated, regenerated, or legacy keys switched off** → update the `SUPABASE_ANON_KEY` repo secret (and `VITE_SUPABASE_ANON_KEY` in Vercel).
- **Different Supabase project** (test copy, migration, new project ref) → update the `SUPABASE_URL` secret and run `supabase/keep-alive.sql` and `supabase/keep-alive-v2.sql` there.
- **`keep_alive()` dropped, renamed or its grants changed** (e.g. turning `supabase/` into migrations, tightening permissions) → keep the function, its `keep_alive_log` table and `grant execute … to anon` in place.
- **Supabase network restrictions or IP allow-lists turned on** → GitHub's runners must still be able to reach the API.
- **Repo renamed, transferred or made a fork** → secrets don't follow; re-add them and check the workflow is enabled.
- **60 days without a commit** → GitHub disables scheduled workflows (and emails first); re-enable it on the Actions tab.
- **Workflow edited** (schedule, file name, runner image) → keep it running daily and re-run by hand.
- **GitHub Actions disabled, or out of minutes** → each run uses well under a minute, but Actions must stay enabled.
- **Supabase changes its inactivity rules** → recheck the interval. (Every 3 days proved too rare: paused 15 Nov 2026.)
- **Upgrade to Supabase Pro** → delete the workflow and the two secrets; this list no longer applies.

## Session lessons (apply every session)

- **Check what's reachable first.** Before a step needing E's logins, check which browser is connected and which accounts are signed in, so setup isn't discovered half-way.
- **Prove it works before merging.** Run the real check (workflow run, live call) before calling a change done, so fixes don't need a second pull request.
- **Name both Supabase key types** (legacy anon `eyJ…` or `sb_publishable_…`) and say exactly where to copy them from.
- **Read a Project doc before rewriting it** (`project_read`, then `project_write`).
- **Clone with all branches tracked** (`git clone --depth 1 --no-single-branch`), so new branches push with tracking and no "unpushed commit" warnings.
- **Credentials stay with E.** Claude never types API keys or tokens; it opens the right page, fills in the name, and E pastes the value.

## Decisions (keep consistent)

- **Settings (25 Nov 2026):** admins only; members don't see the gear. One Save button; closing with unsaved changes asks first. The next invoice number is shown, not editable. The invoice preview's "Your details" still edits the same business details.

- **Rounding:** money rounds to the nearest penny; fields block a third decimal place; invoices always show pence (£3,420.00).
- **Money fields** (Budget, Amount Spent, Hourly Rate, category budgets, unit costs): 0 or more, up to 2 decimal places, enforced in the app and the database. **Hours:** more than 0, up to 24, 2 decimal places.
- **Currency** is per project (GBP, EUR, USD). Budget Overview compares one currency at a time, with no conversion. A project's currency locks once it has cost categories.
- **Costs:** categories (each with a budget) contain items. Status Quoted → Booked → Invoiced → Paid; Booked or later counts as committed. A project's Amount Spent = the amount entered on the project + items marked Paid. A £0-budget category shows "No budget set", not a negative "Left".
- **Logged time** is billed via `bill_logged_time()` at the rate recorded when logged (else the project's rate), into the project's Staffing/Labour category (created as "Staffing" if missing). Only your own **unbilled** entries can be edited or deleted. Deleting a billed cost item unbills its hours.
- **Progress** comes only from tasks (done ÷ total, equal weight; 0% with none). Database triggers enforce it, so it can't be set by hand. Status is a manual choice.
- **Invoices (one-click, 21 Nov 2026):** "Generate invoice" (admins, any status) opens a pre-filled preview of everything not yet invoiced: cost items plus unbilled logged time (billed when issued). `issue_invoice()` records it in `invoices`/`invoice_items` in one step (a cost item can be on only one invoice; once invoiced it, and its category, can't be deleted: the app shows a pop-up naming the invoice, and a database trigger enforces it); the saved copy is what the PDF shows and re-downloads. Client name/address live on the project. Business details saved per organisation in `org_invoice_settings`; numbers INV-0001, … per organisation (typed numbers allowed; the sequence skips used ones). Item statuses are not changed by invoicing. **Invoices are kept for audit:** deleting a project keeps its invoices (with the project's name copied on) and the dashboard's Invoices list shows them all. **VAT** is ticked by default at the saved rate (20% unless changed); unticking it for one invoice doesn't change the default.
- **Keeping the database awake:** while on Supabase's free plan, `.github/workflows/keep-alive.yml` calls `keep_alive()` daily; each call updates the one-row `keep_alive_log` table, so it counts as real database activity (needs the `SUPABASE_URL` and `SUPABASE_ANON_KEY` repository secrets). Upgrade to Supabase Pro shortly before real customers arrive (no pausing, daily backups), then delete the workflow.
- **Permissions:** everyone in an organisation can view; only organisation admins can add, change or delete. Rules use `jwt_org_id()` and `jwt_is_org_admin()`, which accept both Clerk token formats (`org_id`/`org_role` and `o.id`/`o.rol`). Use these helpers in new rules.
- **Feedback (24 Nov 2026):** anyone signed in can send it; people read, change or take back only their own section votes; general feedback can't be read back from the app. Nobody in a customer's organisation sees others' feedback, admins included; E reads it in Supabase. Section strips show after 1+ day of use (was 3; changed 24 Nov) and 3+ opens of that section (kept in the browser's storage per user); the header link is always there.
- **Date format (24 Nov 2026):** one per organisation in `org_settings.date_format`, `uk` (default; also when there's no row) or `us`; everyone in the organisation reads it, admins change it in Settings (the header gear; saved with the Save button). Shown as 28 Nov 2026 (lists, cards, invoices), 28/11/2026 (tight table columns, dates inside text such as "Logged time" lines), Sat 28 Nov 2026 (cards), 28 November 2026 (PDF details). Dates stay stored as ISO; only display changes. Date pickers are the browser's own (they follow the device's language) with the chosen date echoed underneath in the organisation's format.
- **Clerk production move:** start fresh (decided 18 Nov 2026). Old test data isn't moved; delete it in one SQL step straight after the move (projects, costs, tasks, time, invoices, invoice settings), never touching `keep_alive()` or `keep_alive_log`.
