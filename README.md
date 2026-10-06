# VAT Input Claims Register

Tracks which input VAT invoices in the ledger have been claimed on monthly VAT returns (Sri Lanka, tax year April to March). Replaces the Excel workbook. See [SPEC.md](SPEC.md) for the rules and screens.

Stack: Next.js (App Router, TypeScript), Tailwind CSS, Supabase (Postgres, Auth, row level security), SheetJS in the browser. Deploys to Vercel.

## Project layout

| Path | What it is |
|---|---|
| `supabase/migrations/0001_init.sql` | Schema, derived views, RLS policies, upload functions |
| `supabase/migrations/0002_members.sql` | Email lookup functions for the Members screen |
| `lib/reports.ts`, `lib/export.ts` | Summary and reconciliation calculations, Excel export |
| `supabase/seed.sql` | Oceanpick 2026/27 data (608 invoices, 244 schedule lines, April return) |
| `templates/` | Blank upload templates (also downloadable from the app) |
| `lib/parse.ts` | Upload parsing (ledger list and IRD schedule), ported from the prototype |
| `lib/format.ts` | Money and month formatting, matching key |
| `lib/data.ts` | Paged reads from the views so more than 1,000 rows load |
| `components/` | App shell (company switcher, tax year, tabs) and the screens |
| `tests/` | Unit tests for the parsers and date handling |

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard>, click **New project**, pick a name, a database password and the region closest to you (Singapore for Sri Lanka). Wait for it to finish provisioning.
2. Open **Project Settings → API** and note:
   - **Project URL** (`https://<ref>.supabase.co`)
   - **anon public** key

   Only these two values are used by the app. Never put the service-role key in the app or in Vercel.
3. Under **Authentication → Providers**, make sure **Email** is enabled. Turn **Confirm email** off if you will create users by hand in the dashboard (recommended for a small internal app); otherwise users must click the confirmation link before they can sign in.

> The app keeps everything in its own Postgres schema, `vat_claims`, so it can share a Supabase project with other apps without clashing with their tables. Remember that `auth.users` is still shared with any other app in that project.

## 2. Run the migration and the seed

In the dashboard open **SQL Editor → New query**, then:

1. Paste the whole of `supabase/migrations/0001_init.sql` and click **Run**. It creates the `vat_claims` schema, the tables, views, policies and upload functions, and grants the API roles access to the schema.
2. Paste the whole of `supabase/migrations/0002_members.sql` and click **Run**. It adds two functions the Members screen uses to look up logins by email on the database side (the browser cannot read `auth.users`).
3. Paste the whole of `supabase/seed.sql` and click **Run**. It inserts the company `Oceanpick (Pvt) Ltd` with id `00000000-0000-0000-0000-000000000001` and its 2026/27 data.
4. **Expose the schema to the API.** Open **Project Settings → API → Exposed schemas** (under "Data API"), add `vat_claims` to the list next to `public`, and save. Without this the app gets "relation not found" errors for every query. The app is hard-wired to this schema name in `lib/supabase/schema.ts`.

Or, with the Supabase CLI installed and logged in:

```bash
supabase link --project-ref <ref>
supabase db push                       # applies supabase/migrations/*
psql "$(supabase db url)" -f supabase/seed.sql
```

## 3. Create the first user and make them admin

1. **Authentication → Users → Add user → Create new user.** Enter the email and a password and tick **Auto confirm user**.
2. Copy the new user's **UID** from the users list.
3. In the SQL Editor run (replace the UID):

```sql
insert into vat_claims.company_members (company_id, user_id, role)
values ('00000000-0000-0000-0000-000000000001', '<user-uid>', 'admin')
on conflict (company_id, user_id) do update set role = excluded.role;
```

You can do the same by email in one statement:

```sql
insert into vat_claims.company_members (company_id, user_id, role)
select '00000000-0000-0000-0000-000000000001', id, 'admin'
from auth.users where email = 'you@example.com'
on conflict (company_id, user_id) do update set role = excluded.role;
```

Roles: `viewer` (read only, edit controls hidden), `editor` (uploads, inline edits, return entry), `admin` (also manages members). The database enforces this through RLS; the UI only mirrors it.

After the first admin exists, further members are added from the app's **Members** tab. The person first needs a login: either they use **Create account** on the sign-in page, or you create it under **Authentication → Users**. Then an admin enters the same email and a role on the Members tab. A login on its own shows no companies and no data.

Self-registration needs **Authentication → Providers → Email → Allow new users to sign up** turned on (the default). With **Confirm email** on, new users get a confirmation link before they can sign in; turn it off for an internal app where you don't want that step. To stop strangers registering at all, turn sign-ups off and create logins in the dashboard instead.

## 4. Run locally

```bash
cp .env.example .env.local     # then fill in the two values from step 1
npm install
npm run dev                    # http://localhost:3000
```

Sign in with the user from step 3. Pick the company and the tax year **2026/27** to see the seed data.

Other scripts:

```bash
npm test          # unit tests (parsers, dates, formatting) and the SPEC.md acceptance checks against seed.sql
npm run typecheck # tsc --noEmit
npm run build     # production build
```

## 5. Deploy to Vercel

1. Push this directory to a Git repository (GitHub, GitLab or Bitbucket).
2. In <https://vercel.com/new> import the repository. Framework preset: **Next.js**. Leave the build settings as detected.
3. Under **Environment Variables** add, for Production and Preview:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | the Project URL from step 1 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon public key from step 1 |

4. Click **Deploy**.
5. Back in Supabase, open **Authentication → URL Configuration** and set **Site URL** to your Vercel URL (for example `https://vat-claims.vercel.app`). Add the same URL under **Redirect URLs**.

Or from the command line:

```bash
npm i -g vercel
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel --prod
```

## Uploads

- **Ledger invoice list**: sheet named "Invoice Listing" (or the first sheet). Columns are matched by heading text anywhere in the first 15 rows: Invoice No. (or Document No.), Posting Date, Vendor Name, External Document No., Description, Amount (LCY), Source Currency Amount. Only rows posted in the chosen month are kept; duplicate invoice numbers are summed. Saving replaces that month's rows but keeps original-invoice marks and claimed-month overrides by invoice number.
- **IRD input schedule**: sheet whose name contains "Input" (or the first sheet). Columns: Month, Serial No, Invoice Date, Tax Invoice No, Supplier's TIN, Name of the Supplier, Description, Value of purchase, VAT Amount. If the Month column holds several months, only the chosen month's rows are kept. A blank VAT Amount is taken as 18% of the value.
- Dates may be Excel serials or `dd.mm.yyyy`, `dd/mm/yyyy`, `yyyy-mm-dd` text. `.xlsx`, `.xls` and `.csv` are accepted. CSV cells are read as written, so `01/05/2026` is 1 May.

## Security notes

- Every route except `/login` is protected by `middleware.ts`, which refreshes the Supabase session cookie and redirects signed-out visitors.
- All reads and writes go through the signed-in user's session, so the RLS policies in the migration decide what each user can see and change. The derived views use `security_invoker`, so they obey the same policies.
- The service-role key is never used.
