-- VAT reconciliation: hold every entered cage of the return, as in the "VAT Return_Upload" workbook.
-- Cages 7, 9, 13 and 14 and the arithmetic checks are derived in the app and never stored.
set search_path = vat_claims, public;

alter table vat_returns
  -- Output tax and supplies
  add column if not exists taxable_value numeric(18,2) not null default 0,              -- A
  add column if not exists taxable_tax numeric(18,2) not null default 0,                -- 0
  add column if not exists wholesale_retail numeric(18,2) not null default 0,           -- B / 2
  add column if not exists suspended_supplies numeric(18,2) not null default 0,         -- C / 2A
  add column if not exists output_tax numeric(18,2) not null default 0,                 -- 3
  add column if not exists zero_rated_services numeric(18,2) not null default 0,        -- D1
  add column if not exists excluded_supplies numeric(18,2) not null default 0,          -- E1
  -- Input tax
  add column if not exists suspended_purchases_value numeric(18,2) not null default 0,  -- J
  add column if not exists suspended_purchases_tax numeric(18,2) not null default 0,    -- K
  add column if not exists imports_no_vat numeric(18,2) not null default 0,             -- J2
  add column if not exists disallowed_suspended numeric(18,2) not null default 0,       -- 8A
  -- Allowable input tax and tax payable / refundable
  add column if not exists allowable_zero_rated numeric(18,2) not null default 0,       -- 11
  add column if not exists not_group_a numeric(18,2) not null default 0,                -- 12
  add column if not exists gross_refund numeric(18,2) not null default 0,               -- 15
  add column if not exists tax_payable numeric(18,2) not null default 0,                -- 16
  add column if not exists monthly_payments numeric(18,2) not null default 0,           -- Q
  add column if not exists svat_credit numeric(18,2) not null default 0,                -- R2
  add column if not exists total_credits numeric(18,2) not null default 0,              -- 17
  add column if not exists net_refund_payable numeric(18,2) not null default 0;         -- 18

notify pgrst, 'reload schema';
