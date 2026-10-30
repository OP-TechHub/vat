# VAT Input Claims Register

Tracks which input VAT invoices in the ledger have been claimed on monthly VAT returns (Sri Lanka, tax year April to March). Replaces the Excel workbook. See [SPEC.md](SPEC.md) for the rules and screens.

Stack: Next.js (App Router, TypeScript), Tailwind CSS, Supabase (Postgres, Auth, row level security), SheetJS in the browser. Deploys to Vercel.

## Project layout

| Path | What it is |
|---|---|
| `supabase/migrations/0001_init.sql` | Schema, derived views, RLS policies, upload functions |
| `supabase/migrations/0002_members.sql` | Email lookup functions for the Members screen |
| `supabase/migrations/0003_schedule_ledger_fields.sql` | Manual ledger availability / ledger reference columns on schedule lines |
| `supabase/migrations/0004_export_sales.sql` | `export_sales` table and upload function for the Export reconciliation tab |
| `supabase/migrations/0005_return_filing.sql` | Submission date, `return_documents` table and the `vat-claims` storage bucket for the Return filing tab |
| `supabase/migrations/0006_return_cages.sql` | All entered cages of the return on `vat_returns`, as in the VAT Return_Upload workbook |
| `supabase/migrations/0007_ird_status.sql` | `ird_status` table (credit voucher status, date, value) and the credit voucher document kind |
| `supabase/migrations/0008_customs_entries.sql` | `customs_entries` (the Import Register and the export customs details) and `import_purchases` tables; customs entries fill the export reconciliation rows |
| `supabase/migrations/0011_cusdec_items.sql` | One customs entry line per CusDec item: item number, HS code, unit and quantity, CID / PAL / SSCL / VAT amounts and MP codes; replaces a CusDec's lines on re-upload |
| `supabase/migrations/0012_customs_documents.sql` | Three document slots per customs declaration: CusDec, other documents, all documents; kept on re-upload |
| `supabase/migrations/0014_tab_permissions.sql` | Per-tab permissions (view, upload, edit, delete) for members; admin / member roles; upload functions that check them |
| `lib/permissions.ts` | Tabs, permission types and helpers shared by the app shell, the screens and the Members tab |
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
3. Paste the whole of `supabase/migrations/0003_schedule_ledger_fields.sql` and click **Run**. It adds the manual "Ledger availability" and "Ledger reference" columns to the IRD input schedule, rebuilds the `schedule_line_match` view and makes schedule re-uploads keep those two fields. Run it on existing projects too.
4. Paste the whole of `supabase/migrations/0004_export_sales.sql` and click **Run**. It adds the `export_sales` table and upload function behind the Export reconciliation tab. Run it on existing projects too.
5. Paste the whole of `supabase/migrations/0005_return_filing.sql` and click **Run**. It adds the submission date to returns, the `return_documents` table and the private `vat-claims` storage bucket with its policies, for the Return filing tab. Run it on existing projects too.
6. Paste the whole of `supabase/migrations/0006_return_cages.sql` and click **Run**. It adds the remaining entered cages of the return (A, 0, B/2, C/2A, 3, D1, E1, J, K, J2, 8A, 11, 12, 15, 16, Q, R2, 17, 18) to `vat_returns`. Run it on existing projects too.
7. Paste the whole of `supabase/migrations/0007_ird_status.sql` and click **Run**. It adds the `ird_status` table for the IRD status tab and lets the document table hold credit vouchers. Run it on existing projects too.
8. Paste the whole of `supabase/migrations/0008_customs_entries.sql` and click **Run**, then `supabase/migrations/0009_vat_base.sql` (adds the "Value for VAT (customs)" column for imports) and `supabase/migrations/0010_cusdec_documents.sql` (keeps the CusDec file with its customs entry), then `supabase/migrations/0011_cusdec_items.sql` (one line per CusDec item with HS code, quantity and the CID / PAL / SSCL / VAT lines; required for the Import Register), then `supabase/migrations/0012_customs_documents.sql` (the other documents and all documents slots beside the CusDec file). It adds the `customs_entries` and `import_purchases` tables and the functions that fill the "As per customs" columns from uploaded customs entries, for the Export reconciliation and Import Register tabs. Run it on existing projects too.
9. Paste the whole of `supabase/migrations/0013_customs_file_name.sql` and click **Run**, then `supabase/migrations/0014_tab_permissions.sql`. 0014 replaces the viewer / editor roles with per-tab permissions: existing viewers get view on every tab and existing editors everything, so nobody's access changes. Run it on existing projects too, and deploy the matching app version at the same time (the older app calls upload functions that 0014 locks down).
10. Paste the whole of `supabase/seed.sql` and click **Run**.
11. Optional: paste the whole of `supabase/seed_returns.sql` and click **Run**. It loads the 65 VAT return periods from Jan 2020 to Aug 2026 (every entered cage and the submission date) for the seeded company. The same data can instead be uploaded from the VAT reconciliation tab. It inserts the company `Oceanpick (Pvt) Ltd` with id `00000000-0000-0000-0000-000000000001` and its 2026/27 data.
12. **Expose the schema to the API.** Open **Project Settings → API → Exposed schemas** (under "Data API"), add `vat_claims` to the list next to `public`, and save. Without this the app gets "relation not found" errors for every query. The app is hard-wired to this schema name in `lib/supabase/schema.ts`.

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

Roles: `admin` (everything on every tab, and manages members) or `member`. A member's access is set per tab on the Members tab:

- **No access**: the tab is hidden and its data cannot be read. The Summary and VAT reconciliation then show blanks for that data.
- **View**: read only.
- **Upload**: upload a month's file, or a document into an empty slot.
- **Edit**: inline edits, rows added by hand, return figures, IRD status, and "Edit uploaded data" on Export reconciliation and Import Register.
- **Delete**: delete rows; replace or remove documents; re-upload a month (or CusDec, or return period) that already holds data.

Summary is view only; Return filing has no edit. The database enforces all of this through RLS and the `upload_*` functions; the UI only mirrors it.

After the first admin exists, further members are added from the app's **Members** tab. The person first needs a login: either they use **Create account** on the sign-in page, or you create it under **Authentication → Users**. Then an admin enters the same email, a role and the member's tab permissions on the Members tab. A login on its own shows no companies and no data.

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
- **IRD input schedule**: sheet whose name contains "Input" (or the first sheet). Columns: Month, Serial No, Invoice Date, Tax Invoice No, Supplier's TIN, Name of the Supplier, Description, Value of purchase, VAT Amount. If the Month column holds several months, only the chosen month's rows are kept. A blank VAT Amount is taken as 18% of the value. Each saved line has two hand-entered columns, **Ledger availability** (None by default, Available in ledger, Not available in ledger) and **Ledger reference** (free text); re-uploading a month keeps both for lines with the same tax invoice number.
- **Export sales report** (Export reconciliation tab): sheet whose name contains "Export" (or the first sheet). Required columns: Invoice No, Amount FC (FOB) USD / EUR, Ex.rate, Net Sales (A); a Month column is used to keep only the chosen month when the file holds several. Optional customs and difference columns: Cusdec No, Date, Month (customs), Currency Type, Ex. Rate Custom LKR, Invoice Value as Per USD / EUR, Custom Value, Short Shipment (3), Sales Reversed in the Month (4), Updated in Custom Report. A blank Net Sales is Amount × Ex.rate; a blank Custom Value is invoice value × customs rate. Subtotal rows (a month label in the Invoice No column) are ignored. Saving replaces the month but keeps customs details already entered for the same invoice number where the file leaves them blank. Editors can then fill in or correct the customs and difference columns on the table; Exchange Difference (1) is always customs value less net sales. The tab shows any range of months in the tax year with a subtotal per month.
- **CusDec PDFs** (Export reconciliation and Import Register tabs, "Upload export / import customs entries", CusDec PDFs chooser): select the ASYCUDA goods declaration printouts, several at once. The app reads each PDF's text in the browser (pdf.js; the worker is `public/pdf.worker.min.mjs`, copied from `node_modules/pdfjs-dist/build/`) and finds the fields by their box labels: customs reference number and date, box 22 currency and amount, box 23 exchange rate, the consignee (exports) or exporter (imports), and the invoice number from box 44 (Documents produced): the "INV NO:" note under A.D. on an export, the bare reference on an import. Nothing else is taken for the invoice number: an empty or unreadable box 44 leaves the field blank, for entry if there is one. Then every item of the declaration is read, from page 1 and from each continuation sheet (up to three item blocks per sheet, the "Summary of Taxes" block being skipped): box 32 item number, box 33 HS code, the description, box 41 unit and quantity, box 46 statistical value, and the item's tax table (CID, PAL, SSL / SSCL and VTD or VAT lines: tax base, amount and MP code). One entry line is made per item, with the reference, date, rate, invoice and party repeated on each. The lines are shown for review with the invoice number editable, then saved like a spreadsheet upload; the PDF itself is kept in the `vat-claims` bucket under `<company id>/customs/<export|import>/<cusdec no>/<filename>` and linked to the entry. The last column of the Export reconciliation and Import Register tables, "CusDec", opens it (Open) and lets editors upload, replace or remove the file for any row that has a customs entry, including entries that came from a spreadsheet. The PDF may be the ASYCUDA printout itself or a scanned bundle in which the CusDec sits among the commercial invoice, packing list, bill of lading and other papers (several CusDecs in one file are fine): the CusDec pages are picked out by their headings and the rest of the file is ignored. A scanner’s own text layer (word-by-word, with rough positions) is not trusted for the figures; those pages are read again by OCR, and a file with no text layer at all gets a quick low-resolution pass to find the CusDec pages first. Every CusDec page is OCR-read twice (automatic layout for the labels, sparse-text mode for the figures and the tax table) and the two readings are merged. The reading is also checked against itself: a tax amount that disagrees with its tax base and rate (separators dropped or shifted by OCR) is replaced by base × rate, an unreadable box 46 is taken from the CID tax base (the same CIF value on an import), a sideways-scanned page is turned upright before reading, and one wrong letter in a heading such as “GOODS FECLARATION” still identifies the page. Every box in the review table can be corrected before saving, which matters for scans: expect to check the reference number, invoice number, rate and the tax lines on a poor scan. A scanned CusDec is read by OCR as follows: the scan image is taken from each page and read with Tesseract in the browser (`tesseract.js`, which fetches its engine and English model from its CDN on first use, so the browser needs internet access), then the same box rules apply with a wider tolerance. OCR takes a few seconds per page; rows read that way are marked for checking, and a figure that fails the invoice value × rate = statistical value cross-check is flagged. Upright, sharp scans at 200 dpi or better read well; faint or skewed ones may not.
- **Customs entries** (Export reconciliation and Import Register tabs, "Upload export / import customs entries"): a sheet of CusDec lines with columns Cusdec No, Date, Invoice No, Item No, HS Code, Description, UOM, Quantity, Currency, Ex. Rate, Invoice Value (FC), Customs Value (LKR), and for imports CID / PAL / SSCL Amount and Code, VAT Base, VAT Amount, VAT Code, then Consignee / Supplier; headings are matched by name and only Cusdec No and Invoice No are required (Item No defaults to 1). Entries are stored keyed by CusDec, invoice number and item; uploading a CusDec and invoice again replaces all its lines and keeps the CusDec file already held. On the export side the "As per customs" columns of the sales row with the same invoice number are filled in (CusDec no, date, month, currency, customs rate, invoice value and customs value), and a month's sales report uploaded later is filled from the stored entries too. On the import side the entries are the Import Register itself: one row per CusDec item under the month of its date, with HS code, description, supplier, unit and quantity, customs value, the CID, PAL and SSCL amounts and codes, value for VAT, VAT and its type (VTD deferred / VAT upfront) and code, plus month subtotals; a declaration with several items repeats its reference, date, rate and invoice on each line. Blank Customs Value is invoice value × rate; the month is taken from the date.
- **Return data** (VAT reconciliation tab, "Upload VAT return data"): the "VAT Return_Upload" workbook, one column per taxable period. The "Taxable period" row holds each period's first day, "Date of submission (per IRD acknowledgement)" the submission date, and column B the cage codes. Every entered cage (A, 0, B/2, C/2A, 3, D, D1, E, E1, H, 4, 5, I, 6, J, K, J2, 8, 8A, 10, 11, 12, 15, 16, Q, R2, 17, 18) is saved to `vat_returns` for every period in the file, whatever tax year is selected; cages 7, 9, 13, 14 and the checks are recalculated. Ledger figures already entered are kept. Periods with no figures are ignored. The reconciliation table on the right ends with a section comparing each month's return with what has been uploaded elsewhere in the app: zero rated goods (D) less net sales on the Export reconciliation tab, imports value (H) less the Import Register total for the month (the value for VAT per customs where read, else the customs value), and local purchases value (I) less the value of purchases on the IRD input schedule. Each pair shows the uploaded total and the difference, highlighted when it is a rupee or more; a difference equal to the cage means that month has not been uploaded yet.
- **Folder of returns and acknowledgements** (Return filing tab, "Upload a folder"): select every file in the folder at once, including its index sheet if there is one. The index needs a file-name column and may have period (period code, month text or date) and type columns. Files not in the index are matched from their names (a month like "Aug 2026", "2026-08" or "202608", or the IRD period code; "ack" marks an acknowledgement). The matches are shown for correction before anything is uploaded; a file for a period that already holds that document replaces it.
- **Return and acknowledgement documents** (left panel of the VAT reconciliation tab for the selected month, and the Return filing tab for any period): PDF, JPG or PNG up to 25 MB per period, stored in the private `vat-claims` bucket under `<company id>/<YYYY-MM>/<return|acknowledgement>/<filename>`. Members open them through short-lived signed links; editors upload, replace and remove.
- Dates may be Excel serials or `dd.mm.yyyy`, `dd/mm/yyyy`, `yyyy-mm-dd` text. `.xlsx`, `.xls` and `.csv` are accepted. CSV cells are read as written, so `01/05/2026` is 1 May.

## Column filters

The Invoice listing, IRD input schedule, Export reconciliation, Import Register, Return filing and IRD status tables have a row of filter boxes under the column headings. Typing in a box keeps only the rows whose cell contains that text (case does not matter, and commas in numbers are ignored, so `1313863` finds 1,313,863). Number columns also take `>1000`, `>=`, `<`, `<=`, `=` and a range such as `100..200`; `blank` keeps rows where the cell is empty, and yes / no columns take `yes` or `no`. Boxes combine, totals and counts follow the filtered rows, and a Clear button appears above the table while any box is set.

## Security notes

- Every route except `/login` is protected by `middleware.ts`, which refreshes the Supabase session cookie and redirects signed-out visitors.
- All reads and writes go through the signed-in user's session, so the RLS policies in the migration decide what each user can see and change. The derived views use `security_invoker`, so they obey the same policies.
- The service-role key is never used.
