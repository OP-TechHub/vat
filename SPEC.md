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
| `export_sales` | Export sales report lines with customs details, per sales-report month (migration 0004) |
| `return_documents` | Filed return, IRD acknowledgement and credit voucher documents per period, stored in the `vat-claims` bucket (migrations 0005, 0007) |
| `customs_entries`, `import_purchases` | Customs declaration (CusDec) lines for both directions, one per item (migration 0011), the import ones being the Import Register; import purchase rows (migration 0008, no longer shown) |
| `replace_customs_entries`, `apply_customs`, `replace_import_month` (RPC) | Store customs entries and fill the matching reconciliation rows; replace a month of import purchases |
| `ird_status` | Credit voucher status, date and value per period (migration 0007) |
| `replace_ledger_month`, `replace_schedule_month`, `replace_export_month` (RPC) | Atomic replace of one month on upload |

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
   - Two manual columns per line, editable inline by editors and admins: "Ledger availability" (None by default until someone sets it, Available in ledger, Not available in ledger) and "Ledger reference" (free text). Stored on `schedule_lines`, included in the Excel export, and preserved on re-upload by tax invoice number.
   - Upload a month (same preview-then-confirm flow) and Download template. If the file has a Month column with several months, keep only the chosen month's rows. If VAT Amount is blank, use 18% of the value.
4a. **Export reconciliation** (table `export_sales`, one row per export invoice per sales-report month)
   - Column groups as in the Excel sheet. Details in sales report: Invoice No, Month, Amount FC (FOB) USD / EUR, Ex.rate, Net Sales (A). As per customs: Cusdec No, Date, Month, Currency Type (USD / EUR), Ex. Rate Custom LKR, Invoice Value as Per USD / EUR, Custom Value. Differences: Exchange Difference (1) = Custom Value − Net Sales (derived, never stored), Short Shipment (3), Sales Reversed in the Month (4), Updated in Custom Report.
   - Upload a sales-report month (same preview-then-confirm flow, Download template). Only the sales-report columns are required; customs and difference columns are taken if present. Re-upload keeps customs details already entered by invoice number where the file is blank.
   - Editors fill in or correct the customs and difference columns inline. Custom Value is recalculated as invoice value × customs rate whenever either changes.
   - View from / to month selectors show any range within the tax year, with a subtotal row per month (amount FC, net sales, customs value, exchange difference, short shipment, sales reversed) and a grand total when more than one month is shown.
   - Included in the Excel export as the "Export Reconciliation" sheet.
   - Upload CusDec PDFs (editors): ASYCUDA goods declaration printouts are read in the browser (`lib/pdfText.ts`, `lib/cusdec.ts`); fields are located by box label (customs reference and date, box 22 currency / amount, box 23 rate, consignee or exporter, invoice number always from box 44: its "INV NO:" line if there is one, else the reference under A.D.; blank, with a warning, when the box is empty or unreadable; nothing is taken from elsewhere on the form), then one line per item from page 1 and every continuation sheet: box 32 item no, box 33 HS code, description, box 41 UOM and quantity, box 46 statistical value and the item's tax table (CID, PAL, SSL, VTD / VAT: base, amount, MP code); the "Summary of Taxes" block is skipped. Lines are reviewed, the invoice number may be corrected, and they are saved as customs entries (re-uploading a CusDec replaces its lines); each PDF is kept in the `vat-claims` bucket and referenced from the entry (`doc_path`, migration 0010). A trailing "CusDec" column on both reconciliation tables, in the icon format of the Return filing page, opens the file and lets editors upload / replace / remove it per entry. Scanned bundles (invoice, packing list, CusDec... in one PDF, with a scanner’s word-level text layer or none) are handled by `lib/cusdecRead.ts`: the CusDec pages are located by heading (`cusdecPageGroups`), each declaration (main page plus continuation sheets) is parsed on its own, and those pages are OCR-read in two Tesseract modes (3 and 11) whose fields are merged; a file without text gets a shrunken quick OCR pass to find the pages. Tax amounts are checked against base × rate and replaced when OCR garbled them (noted on the row); an unreadable box 46 falls back to the CID tax base; landscape page images are rotated to whichever turn reads as words; headings match with one-letter OCR slips. The review table’s boxes are all editable for PDF rows. Scanned PDFs (no text layer) go through OCR (`lib/ocr.ts`: page image extracted with pdf.js, read with Tesseract, words grouped into positioned runs) and the same parser with looser tolerances; such rows are marked, and invoice value × rate is cross-checked against the statistical value.
   - Upload export customs entries (editors): CusDec lines stored in `customs_entries` (direction export, keyed by CusDec and invoice number). On save, and again whenever a month's sales report is uploaded, the "As per customs" columns of the sales row with the same invoice number (compared like document numbers) are filled from the latest entry: CusDec no, date, month, currency, customs rate, invoice value, customs value.
4b. **Import Register** (table `customs_entries`, direction import; migrations 0008–0011): a register of the import CusDecs themselves, with no purchase-ledger columns. One row per CusDec item (HS code line) under the month of its CusDec date, for any range of months in the tax year (entries whose date cannot be read are listed last). Column groups: Declaration (Cusdec No, Date, Month, Invoice No, repeated on every item line of a multi-item CusDec), Item (item no, HS code, description, supplier, UOM, quantity), Values (currency, customs rate, invoice value, customs value = the item's box 46 statistical value), Taxes as per customs (CID, PAL, SSCL amounts each with its MP code; Value for VAT = the VAT line's tax base, CIF plus duties; VAT amount, type VTD / VAT and code), and the CusDec document column (Open / Upload / Replace / Remove, shared by the lines of one declaration). Month subtotals and a grand total of customs value, CID, PAL, SSCL, value for VAT and VAT. Entries are added by uploading CusDec PDFs (text or scanned) or a spreadsheet of entries, as on the export tab. Included in the Excel export as "Import Register". The `import_purchases` table and its upload remain in the database and code but are not shown.
5. **VAT reconciliation**
   - "Upload VAT return data" panel (editors): the VAT Return_Upload workbook, every period in the file upserted into `vat_returns` (see Upload formats).
   - Left panel, per month: submission date; the VAT return and return acknowledgement documents (Uploaded / Not uploaded, Open, Upload / Replace / Remove); then every entered cage of the return in return order (A, 0, B/2, C/2A, 3, D, D1, E, E1; H, 4, 5, I, 6, J, K, J2, 8, 8A, 10; 11, 12, 15, 16, Q, R2, 17, 18) and the three ledger figures. Inputs show thousands separators.
   - Right panel, months as columns, numbers right aligned in whole rupees: the entered cages with calculated 7 (4+5+6), 9 (7−8), available (9+10), 13 (11+12), 14 (9+10−13); arithmetic checks cage 15 less (13−3−8A) and cage 18 less (16−17−15); exempt ratio test: 7 × E ÷ (D+E), cage 8 less computed, K × E ÷ (D+E), cage 8A less computed, implied rate K ÷ J; then return vs ledger for exports, local sales, imports; schedule VAT total vs local purchases tax; claimed from ledger invoices; then return vs the uploaded reconciliations: zero rated goods (D) less Export reconciliation net sales, imports value (H) less the Import Register total for the month (value for VAT per customs where read, else customs value), local purchases value (I) less IRD input schedule value of purchases, each shown with the reconciliation total. Differences under 1 rupee count as agreed; larger ones are highlighted.
5a. **Return filing** (register of every taxable period from Jan 2020 to the current month, newest first, not limited to the tax-year selector)
   - Columns: Period code (IRD YYQM, e.g. Aug 2026 = 2632), Taxable period, Submitted on (per IRD acknowledgement), Data uploaded (Yes/No), Return uploaded (Yes/No), Acknowledgement uploaded (Yes/No). Filter: all periods, or only those with something missing.
   - Data uploaded is Yes when a `vat_returns` row exists for the period (loaded from the workbook or entered on the VAT reconciliation tab).
   - Return uploaded / Acknowledgement uploaded are Yes when a document is held for the period in the private `vat-claims` storage bucket (table `return_documents`). Members can open a document through a signed link; editors upload, replace and remove. Storage policies mirror the company roles.
5b. **IRD status** (every taxable period from Jan 2020, newest first, same range and show filters as Return filing)
   - Columns: Period code, Taxable period, Deferred import VAT (cage 4 of the period's return), Refund due (cage 15), Net refund (cage 18 negated: refund due less credits and tax payable, highlighted when tax is payable), Status, Date of credit voucher, Value of credit voucher, Credit voucher attachment. Totals row for the amounts.
   - Status is one of Credit voucher received, Credit voucher pending, Information under submission, or not set; held in `ird_status` with the voucher date and value. Date, value and attachment are editable once the status is received. The voucher is a `return_documents` row of kind `credit_voucher` in the `vat-claims` bucket, with Open / Attach / Replace / Remove.
6. **Export to Excel**: Invoice Listing (with status and claim month), IRD Submitted Input, VAT Returns.
7. **Members** (admin only): invite by email, set role, remove.
8. **Column filters** on the row tables (Invoice listing, IRD input schedule, Export reconciliation, Import Register, Return filing, IRD status): a filter box under every column heading (`components/ColumnFilters.tsx`); contains-match on text, comparisons and ranges on numbers, `blank` for empty cells, yes / no for Yes / No columns; boxes combine; totals follow the filtered rows; Clear button while any is set.

## Upload formats (`templates/`)
- Ledger: sheet "Invoice Listing"; Invoice No. (or Document No.), Posting Date, Vendor Name, External Document No., Description, Amount (LCY), Source Currency Amount.
- Schedule: Month, Serial No, Invoice Date, Tax Invoice No, Supplier's TIN, Name of the Supplier, Description, Value of purchase, VAT Amount.
- Export sales report: Invoice No, Month, Amount FC (FOB) USD / EUR, Ex.rate, Net Sales (A), then optionally Cusdec No, Date, Month, Currency Type, Ex. Rate Custom LKR, Invoice Value as Per USD / EUR, Custom Value, Short Shipment (3), Sales Reversed in the Month (4), Updated in Custom Report. A group-heading row above the column headings and month subtotal rows are ignored.
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
