# Prompt for Claude Code

Copy this folder into an empty project directory, open Claude Code there, and paste everything below the line.

---

Build the VAT Input Claims Register as a production web app in this directory.

Read these first, in this order:
1. `SPEC.md` — what to build, the screens, the rules and the acceptance figures.
2. `supabase/migrations/0001_init.sql` — the database schema, views, RLS policies and upload functions. Use it as is; if you need a change, add a new migration and tell me why.
3. `reference/prototype.html` — a working prototype. Port its upload parsing, matching, report calculations and number formatting faithfully. Ignore its `window.claude` storage and download calls; those are replaced by Supabase and normal browser downloads.

Stack: Next.js App Router with TypeScript, Tailwind CSS, `@supabase/ssr` + `@supabase/supabase-js`, SheetJS (`xlsx`) in the browser. Deploy target is Vercel. Database and auth are Supabase.

Requirements:
- Email + password sign-in with Supabase Auth; protect every route except the sign-in page with middleware.
- All data access goes through the signed-in user's session so row level security applies. Use only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the app. No service-role key in client code.
- Read invoices from the `invoice_claim_status` view and schedule lines from `schedule_line_match`. Do not recompute matching in the client. Page or batch reads so more than 1,000 rows load correctly.
- Uploads: parse in the browser, show the preview described in the spec, then call `replace_ledger_month` / `replace_schedule_month` on confirm.
- Hide edit controls for viewers based on the user's role in `company_members`.
- Keep the app simple: one layout with company switcher, tax-year selector and five tabs. Tables must stay usable with several thousand rows.
- Money is LKR with two decimals and thousands separators; right-align and use tabular numerals.

Deliver:
- The app, a `.env.example`, and a `README.md` with exact steps to: create the Supabase project, run the migration and `supabase/seed.sql`, create the first user and add them to `company_members` as admin for the seeded company (id `00000000-0000-0000-0000-000000000001`), and deploy to Vercel with the environment variables.
- Unit tests for the upload parsers and date handling, run against the files in `templates/` plus small fixtures you create.

Work in this order and stop to show me after step 2:
1. Scaffold the project and auth.
2. Invoice listing with upload, filters and inline edits.
3. IRD input schedule.
4. VAT reconciliation.
5. Summary reports and Excel export.
6. Members screen.

When finished, check the app's figures against the "Acceptance checks" section of `SPEC.md` using the seed data and report any that differ. Ask me before adding anything listed under "Out of scope".
