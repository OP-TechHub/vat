# VAT Input Claims Register — specification

A web app for tracking which input VAT invoices in the ledger have been claimed on monthly VAT returns (Sri Lanka, tax year April to March). It replaces an Excel workbook. `reference/prototype.html` is a working single-page prototype: its parsing, matching and report logic is the source of truth for behaviour.

## Stack
- Next.js (App Router, TypeScript), deployed on Vercel
- Supabase: Postgres, Auth (email + password), row level security
- Tailwind CSS; SheetJS (`xlsx`) for reading uploads and writing exports/templates in the browser

## Data (see `supabase/migrations/0001_init.sql`)
| Table / view | Purpose |
|---|---|
| `companies`, `company_members` | Each client company; users get a role per company: viewer, editor, admin |
| `ledger_invoices` | Input invoices as per the ledger VAT control account |
| `schedule_lines` | Local input schedule submitted to IRD, per return month |
| `vat_returns` | One row of return figures per month |
| `invoice_claim_status` (view) | Ledger invoices with derived `claim_status`, `claim_month`, `auto_claim_month` |
| `schedule_line_match` (view) | Schedule lines with the matching ledger invoice number, if any |
| `replace_ledger_month`, `replace_schedule_month` (RPC) | Atomic replace of one month on upload |

`supabase/seed.sql` loads Oceanpick's 2026/27 data: 608 ledger invoices (Apr–Aug 2026), 244 schedule lines, the April return.

## Core rule: claim status
- An invoice is **Claimed** when its External Document No. equals a Tax Invoice No on any month's schedule, compared after trimming, upper-casing and removing whitespace. The claimed month is that schedule's return month (earliest if several).
- Manual override per invoice: a specific claimed month, or force "Not claimed". Auto applies when neither is set.
- Status is always derived (the view), never stored.

## Screens
1. **Sign in**, then a company switcher (only companies the user belongs to) and a tax-year selector (e.g. 2026/27 = Apr 2026 to Mar 2027).
2. **Summary**
   - Tiles: ledger input VAT, claimed, not claimed, unclaimed with original invoice held (amount and count each).
   - Month-wise by posting date: invoices, total, claimed count/amount, unclaimed count/amount, originals held.
   - VAT return against ledger, per return month: schedule lines, schedule VAT total, local purchases tax per return, ledger balance posted, claimed from ledger, schedule VAT not in ledger.
   - Matrix: posting month by claimed month, with Not claimed and Total columns.
3. **Invoice listing**
   - Table: invoice no., posting date, vendor, external doc. no., description, amount, original VAT invoice (Yes / No / not marked, editable inline), status pill, claimed month (Auto / manual month / manual not claimed, editable inline).
   - Filters: posting month, status, original invoice, text search. Count and total of the filtered rows.
   - Upload a month: pick month + file, show a preview (rows found, total, rows skipped, rows that will be replaced), then confirm. Only rows posted in the chosen month are taken. Duplicate invoice numbers in a file are summed. Original-invoice marks and overrides survive a re-upload.
   - Download template button beside the file chooser.
4. **IRD input schedule**
   - Month selector; table of lines with a "Ledger invoice" column (matched invoice no. or "Not in ledger list"); totals.
   - Upload a month (same preview-then-confirm flow) and Download template. If the file has a Month column with several months, keep only the chosen month's rows. If VAT Amount is blank, use 18% of the value.
5. **VAT reconciliation**
   - Form per month for the `vat_returns` fields.
   - Table with months as columns: entered lines; total input tax (4+5+6); disallowable by exempt ratio = total × E ÷ (D+E); allowable (7−8); available (9+10); differences return vs ledger for exports, local sales, imports; schedule VAT total vs local purchases tax; claimed from ledger invoices. Differences under 1 rupee count as agreed; larger ones are highlighted.
6. **Export to Excel**: Invoice Listing (with status and claim month), IRD Submitted Input, VAT Returns.
7. **Members** (admin only): invite by email, set role, remove.

## Upload formats (`templates/`)
- Ledger: sheet "Invoice Listing"; Invoice No. (or Document No.), Posting Date, Vendor Name, External Document No., Description, Amount (LCY), Source Currency Amount.
- Schedule: Month, Serial No, Invoice Date, Tax Invoice No, Supplier's TIN, Name of the Supplier, Description, Value of purchase, VAT Amount.
- Find the header row within the first 15 rows; match columns by heading text, not position. Accept Excel serial dates and dd.mm.yyyy / dd/mm/yyyy / yyyy-mm-dd text. Accept .xlsx, .xls, .csv.

## Permissions
- viewer: read only; all edit controls hidden. editor: uploads, inline edits, return entry. admin: also manages members.
- Enforced by RLS in the database; the UI only mirrors it. Never use the service-role key in the browser.

## Acceptance checks (with the seed data, tax year 2026/27)
- 608 invoices, ledger input VAT 20,652,662.26.
- 12 claimed: claimed in May 560,883.98; claimed in Aug 32,717.81. Not claimed 20,059,060.47.
- Posted by month: Apr 3,594,516.46 · May 3,965,119.01 · Jun 3,324,637.59 · Jul 4,118,258.73 · Aug 5,650,130.47.
- Schedule VAT: Apr 1,386,008.84 · May 4,762,259.49 · Jun 245,070.14 · Jul 2,231,489.30 · Aug 1,845,599.70.
- April return: total input tax 7,906,168; allowable 6,664,675; all ledger differences nil.

## Out of scope for v1
Output tax and cages 11–16 (refund / payable), SSCL, import (CusDec) schedules, audit history beyond `updated_by` / `updated_at`.
