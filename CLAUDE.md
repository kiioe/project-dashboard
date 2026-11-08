# SEQUENCE: project dashboard for event planners

A dashboard for wedding and private-event planners: projects, tasks, costs, time tracking and PDF invoices.
The to-do list is in `ROADMAP.md`. Keep it up to date.

## Stack

- **React + Vite**, deployed on **Vercel** (`project-dashboard-wczx`). Merging to `main` deploys automatically.
  Live app: https://project-dashboard-wczx.vercel.app
- **Clerk** for sign-in and organisations. Roles: organisation admins and members.
- **Supabase** (Postgres) for data, with Clerk as a third-party auth provider. All access is controlled by row-level security.
- **Libraries** are locked by `package-lock.json` and built with **Node 22** (`engines` in `package.json`). Vercel installs exactly the locked versions.
- **Tailwind** is currently loaded from the CDN in `index.html`; installing it properly is on the roadmap.

## Code map

- `src/App.jsx`: the main screen (project form, timeline, budget chart, time tracking, project table). Large; splitting it up is on the roadmap.
- `src/CostsPanel.jsx`: cost categories and items, billing logged time, and the "Create invoice" button.
- `src/TasksPanel.jsx`: project tasks. Progress comes from these.
- `src/InvoiceDialog.jsx` and `src/invoicePdf.js`: the invoice window and PDF builder (jsPDF, loaded only when needed).
- `src/money.js`: shared rules for money and hours (typing, parsing, formatting, adding up in pence). Use these; don't duplicate them.
- `supabase/*.sql`: database changes, run by hand in the Supabase SQL editor, in this order: `cost-tracking.sql`, `edit-projects.sql`, `bill-logged-time.sql`, `billing-v2.sql`, `edit-time-entries.sql`, `invoices-and-tasks.sql`, `keep-alive.sql`.
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
- **Different Supabase project** (test copy, migration, new project ref) → update the `SUPABASE_URL` secret and run `supabase/keep-alive.sql` there.
- **`keep_alive()` dropped, renamed or its grants changed** (e.g. turning `supabase/` into migrations, tightening permissions) → keep the function and `grant execute … to anon` in place.
- **Supabase network restrictions or IP allow-lists turned on** → GitHub's runners must still be able to reach the API.
- **Repo renamed, transferred or made a fork** → secrets don't follow; re-add them and check the workflow is enabled.
- **60 days without a commit** → GitHub disables scheduled workflows (and emails first); re-enable it on the Actions tab.
- **Workflow edited** (schedule, file name, runner image) → keep the schedule at 3 days or less and re-run by hand.
- **GitHub Actions disabled, or out of minutes** → each run uses well under a minute, but Actions must stay enabled.
- **Supabase changes its inactivity rules** → recheck the interval.
- **Upgrade to Supabase Pro** → delete the workflow and the two secrets; this list no longer applies.

## Session lessons (apply every session)

- **Check what's reachable first.** Before a step needing E's logins, check which browser is connected and which accounts are signed in, so setup isn't discovered half-way.
- **Prove it works before merging.** Run the real check (workflow run, live call) before calling a change done, so fixes don't need a second pull request.
- **Name both Supabase key types** (legacy anon `eyJ…` or `sb_publishable_…`) and say exactly where to copy them from.
- **Read a Project doc before rewriting it** (`project_read`, then `project_write`).
- **Clone with all branches tracked** (`git clone --depth 1 --no-single-branch`), so new branches push with tracking and no "unpushed commit" warnings.
- **Credentials stay with E.** Claude never types API keys or tokens; it opens the right page, fills in the name, and E pastes the value.

## Decisions (keep consistent)

- **Rounding:** money rounds to the nearest penny; fields block a third decimal place; invoices always show pence (£3,420.00).
- **Money fields** (Budget, Amount Spent, Hourly Rate, category budgets, unit costs): 0 or more, up to 2 decimal places, enforced in the app and the database. **Hours:** more than 0, up to 24, 2 decimal places.
- **Currency** is per project (GBP, EUR, USD). Budget Overview compares one currency at a time, with no conversion. A project's currency locks once it has cost categories.
- **Costs:** categories (each with a budget) contain items. Status Quoted → Booked → Invoiced → Paid; Booked or later counts as committed. A project's Amount Spent = the amount entered on the project + items marked Paid. A £0-budget category shows "No budget set", not a negative "Left".
- **Logged time** is billed via `bill_logged_time()` at the rate recorded when logged (else the project's rate), into the project's Staffing/Labour category (created as "Staffing" if missing). Only your own **unbilled** entries can be edited or deleted. Deleting a billed cost item unbills its hours.
- **Progress** comes only from tasks (done ÷ total, equal weight; 0% with none). Database triggers enforce it, so it can't be set by hand. Status is a manual choice.
- **Invoices:** items chosen each time (all ticked by default); VAT optional (20% default); business details saved once per organisation in `org_invoice_settings`; numbers from `claim_invoice_number()` (INV-0001, …, per organisation).
- **Keeping the database awake:** while on Supabase's free plan, `.github/workflows/keep-alive.yml` calls `keep_alive()` every 3 days (needs the `SUPABASE_URL` and `SUPABASE_ANON_KEY` repository secrets). Upgrade to Supabase Pro shortly before real customers arrive (no pausing, daily backups), then delete the workflow.
- **Permissions:** everyone in an organisation can view; only organisation admins can add, change or delete. Rules use `jwt_org_id()` and `jwt_is_org_admin()`, which accept both Clerk token formats (`org_id`/`org_role` and `o.id`/`o.rol`). Use these helpers in new rules.
