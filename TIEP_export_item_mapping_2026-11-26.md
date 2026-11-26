# TIEP export item mapping (Confirm export mapping page)

Exported 2026-11-26T06:18:57.577Z from the TIEP Import Register database (collections `skumap` and `invoices`). Read only: nothing was changed.

## How the page works

- **One row per item no.** (normalised: lower case, non-alphanumerics to single spaces). Built from every invoice line with an item no. in the Exports Register, excluding local sales, local MUD groups (`kind: "group"`), void invoices and logbook placeholder rows (`rec`).
- **TIEP item** = `tiep` of the first `skumap` row with the same item no. that has one. No row with a TIEP item = not fish, left out of consumption.
- **Yield per standard** = the yield of the TIEP item in that standard. If the standard does not list the product, a substitute product is stored per standard in `skumap.alt[<standardId>]` and its yield is used.
- **Amend (drop-down)** updates every `skumap` row with that item no.: `tiep`, `status` ("confident", or "none" when left out), drops substitutes no longer needed, sets `confirmed: false`, then recalculates every invoice using the item no. whose status is `calculated` (no MUD saved). Invoices with a saved MUD keep their mapping.
- **Confirm (tick)** sets `confirmed: true`, `confirmedAt`, `confirmedBy` on every `skumap` row with that item no. Allowed only when the item has a TIEP item and a substitute for every standard that needs one. It changes no calculation; it only removes the NOT CONFIRMED marking on MUD forms.
- Sorted by latest invoice date (newest first), then kg exported.

## Summary

| | Count | Kg exported |
|---|---:|---:|
| Export item nos. | 75 | 582,939 |
| Fish, confirmed | 5 | 163,635 |
| Fish, not confirmed | 66 | 409,285 |
| No TIEP item (left out) | 4 | 10,019 |

## Conversion standards (yields used)

### TIEP Approval 2024/25 (`STD-TIEP2425`): no start to 31 Aug 2025

| TIEP product | Yield |
|---|---:|
| Uncleaned Fish (Whole round) | 100% |
| Gilled and Gutted | 90% |
| Gilled, Gutted and Scaled | 88% |
| Boat Cut 400-500g | 70% |
| Butterfly Cut | 60% |
| Skin On Fillets | 46% |
| Skinless Fillets 200/300 | 40% |
| Skin On D-Trimmed Fillets 10oz+ | 40% |
| Skinless Fillets | 40% |
| Skinless Fillets 100/200 | 39% |
| CC + Portion Bags | 38% |
| Skin on CC Portions 170-190 | 32% |
| Skin On CC Portions 8oz | 32% |

### TIEP Approval 2025/26 (`STD-WORKING`): 01 Sep 2025 to no end

| TIEP product | Yield |
|---|---:|
| Uncleaned Fish (Whole round) | 100% |
| Gilled and Gutted | 90% |
| Gilled, Gutted and Scaled | 88% |
| Skin On Fillets | 48% |
| Skin On D-Trimmed Fillets 10oz+ | 45% |
| Skinless Fillets | 41% |
| Skin on CC Portions 170-190 | 32% |
| Barramundi portions: 3-4Oz | 42% |
| Barramundi portions: 6-8Oz | 32% |
| Barramundi Skin on fillets 8-9oz | 48% |

## Item mapping

| Status | Latest invoice | Item no. | Main description | TIEP item | Yield TIEP 2024/25 | Yield TIEP 2025/26 | Kg exported | Invoices (open) |
|---|---|---|---|---|---:|---:|---:|---:|
| Confirmed | 2026-11-03 EXP-1890 | EXPORT090 | SPEC 01 - Barramundi S/L Ptn (Deep Skinned) 04 - 05 Oz | Skinless Fillets | 40% | 41% | 4.54 | 1 (1) |
| Not confirmed | 2026-11-03 EXP-1890 | EXPORT091 | SPEC 02 - Barramundi S/L Ptn (Deep Skinned 98%) 04 - 05 Oz | Skinless Fillets | 40% | 41% | 4.54 | 1 (1) |
| No TIEP item (left out) | 2026-10-31 EXP-1889 | EXPORT085 | Fish Maw | — | – | – | 0.25 | 1 (1) |
| No TIEP item (left out) | 2026-10-28 EXP-1887 | EXPORT026 | Barramundi Swimming Bladders - Uncleaned | — | – | – | 8,600.00 | 2 (2) |
| Not confirmed | 2026-10-28 EXP-1888 | EXPORT058 | Skin on fillets - NMI sampling | Skin On Fillets | 46% | 48% | 40.00 | 3 (3) |
| No TIEP item (left out) | 2026-10-28 EXP-1887 | 105872 | Temporary Freight Charges | — | – | – | 4.00 | 4 (4) |
| Not confirmed | 2026-10-16 EXP-1886 | EXPORT006 | Barramundi Portions skin on 80G-120G Ocean Chef 6x1kg ctn - 7372 | Barramundi portions: 3-4Oz | 32% (as Skin on CC Portions 170-190) | 42% | 150,151.16 | 42 (42) |
| Not confirmed | 2026-10-16 EXP-1886 | EXPORT055 | Barramundi S/On Ptn 80-120g -6x2Kg Ctn - 7390 | Barramundi portions: 3-4Oz | 32% (as Skin on CC Portions 170-190) | 42% | 69,782.00 | 10 (10) |
| Not confirmed | 2026-10-16 EXP-1886 | EXPORT044 | ASC Barramundi Skin on Lemon & Herb 2Pk 7x300g ctn – 8998 | Skin On Fillets | 46% | 48% | 19,985.10 | 13 (13) |
| Not confirmed | 2026-10-16 EXP-1886 | EXPORT011 | Barramundi Fillets with smoked S&P glaze, skin-on 350 g ASC-C-43724 (Skipper&Co) - 8979 | Skin On Fillets | 46% | 48% | 17,796.10 | 6 (6) |
| Not confirmed | 2026-10-16 EXP-1886 | EXPORT086 | Skinless fillet 06 - 08 oz (samples) | Skinless Fillets | 40% | 41% | 2.00 | 1 (1) |
| Not confirmed | 2026-10-16 EXP-1886 | EXPORT087 | Skinless fillet 08 - 10 oz (samples) | Skinless Fillets | 40% | 41% | 2.00 | 1 (1) |
| Not confirmed | 2026-10-16 EXP-1886 | EXPORT088 | Skin-on fillet 06 - 08 oz (samples) | Skin On Fillets | 46% | 48% | 2.00 | 1 (1) |
| Not confirmed | 2026-10-16 EXP-1886 | EXPORT089 | Skin-on fillet 08 - 10 oz (samples) | Skin On Fillets | 46% | 48% | 2.00 | 1 (1) |
| Not confirmed | 2026-10-05 EXP-1884 | EXPORT082 | Convenience Range - Barra BBQ-Marinated Butterfly Cuts (01 ptn) 375g box | Gilled, Gutted and Scaled | 88% | 88% | 2.26 | 2 (2) |
| Not confirmed | 2026-10-05 EXP-1884 | EXPORT079 | Convenience Range - Barra Kofta (08 pcs) 320g box | Skinless Fillets | 40% | 41% | 1.92 | 2 (2) |
| Not confirmed | 2026-10-05 EXP-1884 | EXPORT083 | Convenience Range - Barra Bits 320g box | Skinless Fillets | 40% | 41% | 1.92 | 2 (2) |
| Not confirmed | 2026-10-05 EXP-1884 | EXPORT073 | Instant gourmet marinated Fillets - Asian Tropical flavour 300g box | Skin On Fillets | 46% | 48% | 1.80 | 2 (2) |
| Not confirmed | 2026-10-05 EXP-1884 | EXPORT074 | Instant gourmet marinated Fillets - Japanese Classic flavour 300g box | Skin On Fillets | 46% | 48% | 1.80 | 2 (2) |
| Not confirmed | 2026-10-05 EXP-1884 | EXPORT075 | Instant gourmet marinated Fillets - Exotic Delight flavour 300g box | Skin On Fillets | 46% | 48% | 1.80 | 2 (2) |
| Not confirmed | 2026-10-05 EXP-1884 | EXPORT076 | Instant gourmet marinated Fillets - Black Bean Glow flavour 300g box | Skin On Fillets | 46% | 48% | 1.80 | 2 (2) |
| Not confirmed | 2026-10-05 EXP-1884 | EXPORT077 | Convenience Range - Barra Battered Fillets 300g box | Skinless Fillets | 40% | 41% | 1.80 | 2 (2) |
| Not confirmed | 2026-10-05 EXP-1884 | EXPORT078 | Convenience Range - Barra Spring Rolls 300g box | Skinless Fillets | 40% | 41% | 1.80 | 2 (2) |
| Not confirmed | 2026-10-05 EXP-1884 | EXPORT080 | Convenience Range - Barra Battered Goujons 300g box | Skinless Fillets | 40% | 41% | 1.80 | 2 (2) |
| Not confirmed | 2026-10-05 EXP-1884 | EXPORT081 | Convenience Range - Barra Burger Patties (05 pcs) 300g box | Skinless Fillets | 40% | 41% | 1.80 | 2 (2) |
| Not confirmed | 2026-10-05 EXP-1884 | EXPORT084 | Convenience Range - Barra Battered Belly Strips 300g box | Skinless Fillets | 40% | 41% | 1.80 | 2 (2) |
| Not confirmed | 2026-10-01 EXP-1876 | EXPORT068 | SAMPLE BOXES - CHIPPIES DIRECT (Barra S/L Fillets 170g-200g) | Skinless Fillets | 40% | 41% | 12.00 | 1 (1) |
| Not confirmed | 2026-09-29 EXP-1844 | EXPORT008 | Barramundi CC Portions, Skin On 180g -5Kg Ctn - 7374 | Skin on CC Portions 170-190 | 32% | 32% | 46,805.00 | 27 (27) |
| Not confirmed | 2026-09-15 EXP-1879 | EXPORT071 | 01kg – Ocean Raised Frozen Barramundi Portions (Skin On) 115-135g - 08 Ptns/Bag | Barramundi portions: 3-4Oz | 32% (as Skin on CC Portions 170-190) | 42% | 2.00 | 1 (1) |
| Not confirmed | 2026-09-15 EXP-1879 | EXPORT072 | 02kg Box – Ocean Raised Frozen Barramundi Fillets (Skinless) 200-300g | Skinless Fillets | 40% | 41% | 2.00 | 1 (1) |
| Not confirmed | 2026-09-04 EXP-1875 | EXPORT066 | ASC Certified Barramundi Portions 110g | Barramundi portions: 3-4Oz | 32% (as Skin on CC Portions 170-190) | 42% | 6.00 | 3 (3) |
| Not confirmed | 2026-09-04 EXP-1875 | EXPORT067 | ASC Certified Barramundi Portions 140g-170g | Barramundi portions: 6-8Oz | 32% (as Skin on CC Portions 170-190) | 32% | 6.00 | 3 (3) |
| Not confirmed | 2026-08-21 EXP-1877 | EXPORT064 | Frozen skin on fillets 250g-500g 15% GLZ | Skin On Fillets | 46% | 48% | 500.00 | 2 (2) |
| Not confirmed | 2026-07-31 EXP-1805* | EXPORT001 | Barramundi Skinless Fillets 100-200g - 5kg ctn - 7364 | Skinless Fillets | 40% | 41% | 3,240.00 | 4 (4) |
| Not confirmed | 2026-07-13 EXP-1859 | EXPORT017 | Barramundi Fillet Asc S/O Pbo 20% 170-230 Gr - 5kg Carton | Skin On Fillets | 46% | 48% | 8,170.00 | 2 (2) |
| Not confirmed | 2026-07-13 EXP-1859 | EXPORT016 | Barramundi Fillet Asc S/O Pbo 20% 170-230 Gr - 1kg Bag / 8kg Carton | Skin On Fillets | 46% | 48% | 6,504.00 | 2 (2) |
| Confirmed | 2026-05-08 EXP-1803* | EXPORT005 | Barramundi Fillets skinless Ocean Chef 3kg ctn - 7370 | Skinless Fillets | 40% | 41% | 153,417.00 | 28 (28) |
| Not confirmed | 2026-03-13 EXP-1804* | EXPORT037 | Barramundi Portions skin on 80G-120G Ocean Chef 6x1kg ctn - 7372 (CC) | Barramundi portions: 3-4Oz | 32% (as Skin on CC Portions 170-190) | 42% | 23,298.30 | 11 (11) |
| No TIEP item (left out) | 2026-02-03 1683/EXP/OP | SE0031 | Freight Charges | — | – | – | 1,414.58 | 69 (69) |
| Not confirmed | 2026-01-19 IE-00106 | LOC58 | IE - Whole Round Barramundi | Uncleaned Fish (Whole round) | 100% | 100% | 3,073.22 | 5 (5) |
| Not confirmed | 2025-12-16 1697/EXP/OP | EXPORT036 | Barramundi Whole Round Gill Bled (1 kg to 1.5 kg) 10kg | Uncleaned Fish (Whole round) | 100% | 100% | 8,000.00 | 2 (2) |
| Not confirmed | 2025-12-16 1697/EXP/OP | EXPORT056 | Barramundi Whole Round Gill Bled (1.5kg+) 20kg | Uncleaned Fish (Whole round) | 100% | 100% | 3,160.00 | 1 (1) |
| Not confirmed | 2025-12-16 1697/EXP/OP | EXPORT057 | Barramundi Whole Round Gill Bled (1kg-1.5kg) 20kg | Uncleaned Fish (Whole round) | 100% | 100% | 2,000.00 | 1 (1) |
| Not confirmed | 2025-12-11 EXP-1836 | EXPORT047 | Fresh Barramundi Whole Gilled & Gutted 1200g+ | Gilled and Gutted | 90% | 90% | 1,182.33 | 20 (20) |
| Confirmed | 2025-12-11 EXP-1836 | EXPORT025 | Fresh Barramundi Whole Gilled & Gutted 900g+ | Gilled and Gutted | 90% | 90% | 343.65 | 21 (21) |
| Not confirmed | 2025-11-17 EXP-1830 | EXPORT023 | Ocean Reared Farm Raised Barramundi , fresh fillets 10-14oz Skin-on Scaled 10K Film 1x10lb | Skin On D-Trimmed Fillets 10oz+ | 40% | 45% | 8,135.09 | 19 (19) |
| Not confirmed | 2025-11-05 EXP-1824 | EXPORT050 | ASC Barramundi Skin-on Fillets 150g - 200g | Skin On Fillets | 46% | 48% | 2,128.78 | 24 (24) |
| Not confirmed | 2025-11-05 EXP-1824 | EXPORT040 | ASC Barramundi Skin-on Fillets 200g - 250g | Skin On Fillets | 46% | 48% | 1,340.68 | 24 (24) |
| Not confirmed | 2025-10-27 1654/EXP/OP | EXPORT018 | Barramundi Fillet Asc S/O Pbo 20% 300-500 Gr - 5kg Carton | Skin On Fillets | 46% | 48% | 3,500.00 | 1 (1) |
| Not confirmed | 2025-10-27 1654/EXP/OP | EXPORT015 | Barramundi Fillet Asc S/L Pbo 20% 200-300 Gr - 5kg Carton | Skinless Fillets | 40% | 41% | 2,500.00 | 1 (1) |
| Not confirmed | 2025-10-27 1654/EXP/OP | EXPORT020 | Barramundi Fillet Asc S/O Pbo 20% 200-300 Gr 5kg Bulk | Skin On Fillets | 46% | 48% | 1,000.00 | 1 (1) |
| Not confirmed | 2025-10-18 1673/EXP/OP | EXPORT007 | Barramundi Skinless Fillets Pieces 20g Up 5kg ctn - 7373 | Skinless Fillets | 40% | 41% | 300.00 | 1 (1) |
| Not confirmed | 2025-10-11 1690/EXP/OP | EXPORT046 | Barramundi Skinless Fillet 7 to 9 oz | Skinless Fillets | 40% | 41% | 3,414.08 | 1 (1) |
| Not confirmed | 2025-10-11 1690/EXP/OP | EXPORT045 | Barramundi Skinless Fillet 5 to 7 oz | Skinless Fillets | 40% | 41% | 3,395.92 | 1 (1) |
| Not confirmed | 2025-10-07 EXP-1789 | EXPORT051 | ASC Barramundi Skin-on Fillets 250g - 300g | Skin On Fillets | 46% | 48% | 424.03 | 7 (7) |
| Not confirmed | 2025-09-16 PSI/EXP/000043 | EXPORT042 | ASC Barramundi Skin-on Fillets 100g - 150g | Skin On Fillets | 46% | 48% | 483.67 | 10 (10) |
| Not confirmed | 2025-09-15 IE-00047 | LOC09 | ROUNDISLAND BARRAMUNDI-SKIN OFF BELLY TRIMMED | Skinless Fillets | 40% | 41% | 630.00 | 9 (9) |
| Not confirmed | 2025-09-10 PSI/EXP/000048 | EXPORT030 | Frozen Barramundi skin on belly on fillet 250g-500g | Skin On Fillets | 46% | 48% | 605.00 | 2 (2) |
| Not confirmed | 2025-09-10 PSI/EXP/000048 | EXPORT032 | Frozen Barramundi skinless belly on fillet 250g-500g | Skinless Fillets | 40% | 41% | 500.00 | 1 (1) |
| Not confirmed | 2025-09-10 PSI/EXP/000048 | EXPORT033 | Frozen Barramundi Skin on Center Cut Portion 170g-200g | Skin on CC Portions 170-190 | 32% | 32% | 200.00 | 2 (2) |
| Not confirmed | 2025-08-29 PSI/EXP/000037 | EXPORT002 | Barramundi Skinless Fillets 200-300g - 5kg ctn - 7365 | Skinless Fillets | 40% | 41% | 8,320.00 | 4 (4) |
| Confirmed | 2025-08-29 PSI/EXP/000037 | EXPORT010 | Barramundi Skin On Fillets 300-400g - 5kg ctn - 7377 | Skin On Fillets | 46% | 48% | 7,840.00 | 4 (4) |
| Not confirmed | 2025-08-29 PSI/EXP/000037 | EXPORT009 | Barramundi Skin On Fillets 200-300g - 5kg ctn - 7376 | Skin On Fillets | 46% | 48% | 6,400.00 | 3 (3) |
| Not confirmed | 2025-08-29 PSI/EXP/000037 | EXPORT003 | Barramundi Skinless Fillets 300-400g - 5kg ctn - 7366 | Skinless Fillets | 40% | 41% | 1,900.00 | 3 (3) |
| Not confirmed | 2025-07-23 PSI/EXP/000015 | EXPORT028 | Barramundi Fillets Skin on (NMI SAMPLE) | Skin On Fillets | 46% | 48% | 27.70 | 1 (1) |
| Not confirmed | 2025-07-12 PSI/EXP/000012 | LOC41 | Barramundi Skin On Protions 400g 6 Kg - Local New | Skin On Fillets | 46% | 48% | 1.60 | 1 (1) |
| Not confirmed | 2025-07-02 PSI/EXP/000013 | EXPORT048 | ASC Certified Barramundi Fillets Skin on 300 - 500g | Skin On Fillets | 46% | 48% | 201.32 | 1 (1) |
| Not confirmed | 2025-07-02 PSI/EXP/000014 | EXPORT052 | ASC Barramundi Whole Round Head on Gutted (1kg – 1.2kg) A&Z | Gilled and Gutted | 90% | 90% | 3.19 | 1 (1) |
| Confirmed | 2025-06-29 E21373 | Export 070 | Ocean Reared Farm Raised Barramundi , fresh fillets 10-14oz Skin-on Scaled 10K Film 1x10lb (Lates Calcarifer) | Skin On D-Trimmed Fillets 10oz+ | 40% | 45% | 2,029.83 | 5 (5) |
| Not confirmed | 2025-06-27 IE91 | B to B 056 | ASC Skin on Barramundi Center Cut Portion 170-190g | Skin on CC Portions 170-190 | 32% | 32% | 59.30 | 4 (4) |
| Not confirmed | 2025-06-27 IE91 | Export 186 | Barramundi skin on loins-OP11 | Skin on CC Portions 170-190 | 32% | 32% | 28.00 | 4 (4) |
| Not confirmed | 2025-06-27 IE91 | Export 185 | Barramundi Boatcut filet-OP10 | Gilled, Gutted and Scaled | 88% | 88% | 22.10 | 3 (3) |
| Not confirmed | 2025-06-07 IE83 | B to B 055 | ASC Barramundi Fillet D-Trim Skin on 2-300g | Skin On D-Trimmed Fillets 10oz+ | 40% | 45% | 12.60 | 2 (2) |
| Not confirmed | 2025-06-07 IE83 | Export 184 | Barramudni Butterfliedfilet-OP07 | Gilled, Gutted and Scaled | 88% | 88% | 1.20 | 1 (1) |
| Not confirmed | 2025-06-07 IE83 | Export 187 | Barramundi skinless loins-OP11-1 | Skin on CC Portions 170-190 | 32% | 32% | 0.50 | 1 (1) |

## Detail per item no.

### EXPORT090: Confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 4.54 on 1 invoice(s), 1 open; first 2026-11-03, latest 2026-11-03 (EXP-1890)
- Invoice descriptions: "SPEC 01 - Barramundi S/L Ptn (Deep Skinned) 04 - 05 Oz" ×1
- Item master rows: `SKU-0253` "SPEC 01 - Barramundi S/L Ptn (Deep Skinned) 04 - 05 Oz" → Skinless Fillets [status review, confirmed 2026-11-25] — Added from Export_Sales.xlsx (20 Nov 2026). Skinless portions 4-5 oz
- Invoices: EXP-1890 2026-11-03 (calculated)

### EXPORT091: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 4.54 on 1 invoice(s), 1 open; first 2026-11-03, latest 2026-11-03 (EXP-1890)
- Invoice descriptions: "SPEC 02 - Barramundi S/L Ptn (Deep Skinned 98%) 04 - 05 Oz" ×1
- Item master rows: `SKU-0254` "SPEC 02 - Barramundi S/L Ptn (Deep Skinned 98%) 04 - 05 Oz" → Skinless Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Skinless portions 4-5 oz
- Invoices: EXP-1890 2026-11-03 (calculated)

### EXPORT085: No TIEP item (left out)

- TIEP item: none (left out)
- Kg exported: 0.25 on 1 invoice(s), 1 open; first 2026-10-31, latest 2026-10-31 (EXP-1889)
- Invoice descriptions: "Fish Maw" ×1
- Item master rows: `SKU-0252` "Fish Maw" → none [status none] — Added from Export_Sales.xlsx (20 Nov 2026). By-product (fish maw): left out of consumption
- Invoices: EXP-1889 2026-10-31 (calculated)

### EXPORT026: No TIEP item (left out)

- TIEP item: none (left out)
- Kg exported: 8,600.00 on 2 invoice(s), 2 open; first 2026-01-05, latest 2026-10-28 (EXP-1887)
- Invoice descriptions: "Barramundi Swimming Bladders - Uncleaned" ×1; "Barramundi Swimming Bladders - Uncleaned (Lates Calcarifer)" ×1
- Item master rows: `SKU-0066` "Barramundi Swimming Bladders - Uncleaned" → none [status none]; `SKU-0251` "Barramundi Swimming Bladders - Uncleaned (Lates Calcarifer)" → none [status none] — Added from Export_Sales.xlsx (20 Nov 2026). By-product (swim bladder): left out of consumption
- Invoices: EXP-1887 2026-10-28 (calculated), EXP-1817* 2026-01-05 (calculated)

### EXPORT058: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 40.00 on 3 invoice(s), 3 open; first 2026-02-25, latest 2026-10-28 (EXP-1888)
- Invoice descriptions: "Skin on fillets - NMI sampling" ×3
- Item master rows: `SKU-0221` "Skin on fillets - NMI sampling" → Skin On Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1888 2026-10-28 (calculated), EXP-1868 2026-07-20 (calculated), EXP-1856 2026-02-25 (calculated)

### 105872: No TIEP item (left out)

- TIEP item: none (left out)
- Kg exported: 4.00 on 4 invoice(s), 4 open; first 2026-08-18, latest 2026-10-28 (EXP-1887)
- Invoice descriptions: "Temporary Freight Charges" ×4
- Item master rows: `SKU-0226` "Temporary Freight Charges" → none [status none] — Added from Export_Sales.xlsx (20 Nov 2026). Charge, not fish
- Invoices: EXP-1887 2026-10-28 (calculated), EXP-1875 2026-09-04 (calculated), EXP-1873 2026-08-25 (calculated), EXP-1872 2026-08-18 (calculated)

### EXPORT006: Not confirmed

- TIEP item: Barramundi portions: 3-4Oz
- Under TIEP Approval 2024/25: Skin on CC Portions 170-190 at 32% (substitute: TIEP item not listed in this standard)
- Under TIEP Approval 2025/26: Barramundi portions: 3-4Oz at 42%
- Kg exported: 150,151.16 on 42 invoice(s), 42 open; first 2025-06-08, latest 2026-10-16 (EXP-1886)
- Invoice descriptions: "Barramundi Portions skin on 80G-120G Ocean Chef 6x1kg ctn - 7372" ×39; "ASC Barramundi Portions skin on 80G-120G Ocean Chef 6x1kg ctn - 7372" ×2; "Barramundi Portions skin on 80G-120G Ocean Chef 1kg" ×1
- Item master rows: `SKU-0043` "Barramundi Portions skin on 80G-120G Ocean Chef 6x1kg ctn - 7372" → Barramundi portions: 3-4Oz [status confident] alt {"STD-TIEP2425":"Skin on CC Portions 170-190"} — Under TIEP 2024/25 claimed as Skin on CC Portions (32%), as on the customs-accepted MUD for invoice 1511/EXP/OP (E 6950).; `SKU-0204` "ASC Barramundi Portions skin on 80G-120G Ocean Chef 6x1kg ctn - 7372" → Barramundi portions: 3-4Oz [status review] alt {"STD-TIEP2425":"Skin on CC Portions 170-190"} — Added from Export_Sales.xlsx (20 Nov 2026). Same treatment as item 7372; `SKU-0247` "Barramundi Portions skin on 80G-120G Ocean Chef 1kg" → Barramundi portions: 3-4Oz [status review] alt {"STD-TIEP2425":"Skin on CC Portions 170-190"} — Added from Export_Sales.xlsx (20 Nov 2026). Same treatment as item 7372
- Invoices: EXP-1886 2026-10-16 (calculated), EXP-1844 2026-09-29 (calculated), EXP-1841* 2026-08-31 (calculated), EXP-1842 2026-08-31 (calculated), EXP-1805* 2026-07-31 (calculated), EXP-1837 2026-07-31 (calculated), EXP-1843 2026-07-31 (calculated), EXP-1858 2026-06-28 (calculated), EXP-1834 2026-06-21 (calculated), EXP-1801* 2026-06-14 (calculated), EXP-1840 2026-05-23 (calculated), EXP-1803* 2026-05-08 (calculated), EXP-1800* 2026-04-23 (calculated), EXP-1804* 2026-03-13 (calculated), EXP-1802* 2026-02-24 (calculated), 1683/EXP/OP 2026-02-03 (calculated), 1684/EXP/OP 2026-01-28 (calculated), 1685/EXP/OP 2026-01-21 (calculated), 1682/EXP/OP 2026-01-09 (calculated), 1681/EXP/OP 2025-12-30 (calculated), EXP-1831 2025-12-19 (calculated), 1677/EXP/OP 2025-12-02 (calculated), EXP-1832 2025-12-02 (calculated), 1674/EXP/OP 2025-11-16 (calculated), 1676/EXP/OP 2025-11-16 (calculated), 1678/EXP/OP 2025-11-16 (calculated), 1675/EXP/OP 2025-11-11 (calculated), 1671/EXP/OP 2025-10-18 (calculated), 1673/EXP/OP 2025-10-18 (calculated), EXP-1786 2025-09-30 (calculated), EXP-1795 2025-09-29 (calculated), PSI/EXP/000037 2025-08-29 (calculated), PSI/EXP/000050 2025-08-26 (calculated), PSI/EXP/000049 2025-08-20 (calculated), PSI/EXP/000027 2025-07-31 (calculated), PSI/EXP/000016 2025-07-28 (calculated), PSI/EXP/000017 2025-07-23 (calculated), PSI/EXP/000008 2025-07-07 (calculated), E21374 2025-06-29 (calculated), E21371 2025-06-22 (calculated), E21367 2025-06-09 (calculated), E21366 2025-06-08 (calculated)

### EXPORT055: Not confirmed

- TIEP item: Barramundi portions: 3-4Oz
- Under TIEP Approval 2024/25: Skin on CC Portions 170-190 at 32% (substitute: TIEP item not listed in this standard)
- Under TIEP Approval 2025/26: Barramundi portions: 3-4Oz at 42%
- Kg exported: 69,782.00 on 10 invoice(s), 10 open; first 2026-03-21, latest 2026-10-16 (EXP-1886)
- Invoice descriptions: "Barramundi S/On Ptn 80-120g -6x2Kg Ctn - 7390" ×8; "Costco - skin on portions - 7390" ×1; "Barramundi S/On Ptn 80-120g -2Kg - 7390" ×1
- Item master rows: `SKU-0171` "Barramundi S/On Ptn 80-120g -6x2Kg Ctn - 7390" → Barramundi portions: 3-4Oz [status confident] alt {"STD-TIEP2425":"Skin on CC Portions 170-190"} — New item on invoice EXP-1845: skin-on portions 80-120g, mapped like 7372. Confirm.; `SKU-0227` "Costco - skin on portions - 7390" → Barramundi portions: 3-4Oz [status review] alt {"STD-TIEP2425":"Skin on CC Portions 170-190"} — Added from Export_Sales.xlsx (20 Nov 2026). Same treatment as item 7390; `SKU-0248` "Barramundi S/On Ptn 80-120g -2Kg - 7390" → Barramundi portions: 3-4Oz [status review] alt {"STD-TIEP2425":"Skin on CC Portions 170-190"} — Added from Export_Sales.xlsx (20 Nov 2026). Same treatment as item 7390
- Invoices: EXP-1886 2026-10-16 (calculated), EXP-1844 2026-09-29 (calculated), EXP-1841* 2026-08-31 (calculated), EXP-1805* 2026-07-31 (calculated), EXP-1837 2026-07-31 (calculated), EXP-1858 2026-06-28 (calculated), EXP-1801* 2026-06-14 (calculated), EXP-1803* 2026-05-08 (calculated), EXP-1800* 2026-04-23 (calculated), EXP-1839 2026-03-21 (calculated)

### EXPORT044: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 19,985.10 on 13 invoice(s), 13 open; first 2025-07-23, latest 2026-10-16 (EXP-1886)
- Invoice descriptions: "ASC Barramundi Skin on Lemon & Herb 2Pk 7x300g ctn – 8998" ×11; "Barramundi Skin on Lemon & Herb 3x300g" ×1; "ASC Barramundi Skin on Lemon & Herb 2Pk 300g ctn – 8998 - Sample" ×1
- Item master rows: `SKU-0192` "ASC Barramundi Skin on Lemon & Herb 2Pk 7x300g ctn – 8998" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0194` "ASC Barramundi Skin on Lemon & Herb 2Pk 300g ctn – 8998 - Sample" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0249` "Barramundi Skin on Lemon & Herb 3x300g" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1886 2026-10-16 (calculated), EXP-1803* 2026-05-08 (calculated), 1683/EXP/OP 2026-02-03 (calculated), 1684/EXP/OP 2026-01-28 (calculated), 1685/EXP/OP 2026-01-21 (calculated), 1680/EXP/OP 2026-01-18 (calculated), 1682/EXP/OP 2026-01-09 (calculated), 1681/EXP/OP 2025-12-30 (calculated), PSI/EXP/000027 2025-07-31 (calculated), PSI/EXP/000028 2025-07-30 (calculated), PSI/EXP/000010 2025-07-28 (calculated), PSI/EXP/000016 2025-07-28 (calculated), PSI/EXP/000017 2025-07-23 (calculated)

### EXPORT011: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 17,796.10 on 6 invoice(s), 6 open; first 2025-07-28, latest 2026-10-16 (EXP-1886)
- Invoice descriptions: "Barramundi Fillets with smoked S&P glaze, skin-on 350 g ASC-C-43724 (Skipper&Co) - 8979" ×2; "ASC Barramundi Fillets with smoked S&P glaze, skin-on 350 g - 8979" ×1; "Barramundi Fillets with smoked S&P glaze, skin-on 3x350g" ×1; "Barramundi Fillets with smoked S&P glaze, skin-on 350 g ASC-C-43724 - Sample" ×1; "Barramundi Fillets with smoked S&P glaze, skin-on 350 g ASC-C-43724 - 8955" ×1
- Item master rows: `SKU-0193` "Barramundi Fillets with smoked S&P glaze, skin-on 350 g ASC-C-43724 - Sample" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0198` "Barramundi Fillets with smoked S&P glaze, skin-on 350 g ASC-C-43724 - 8955" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0220` "Barramundi Fillets with smoked S&P glaze, skin-on 350 g ASC-C-43724 (Skipper&Co) - 8979" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0223` "ASC Barramundi Fillets with smoked S&P glaze, skin-on 350 g - 8979" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0250` "Barramundi Fillets with smoked S&P glaze, skin-on 3x350g" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1886 2026-10-16 (calculated), EXP-1860 2026-07-31 (calculated), 1685/EXP/OP 2026-01-21 (calculated), EXP-1827 2026-01-18 (calculated), PSI/EXP/000029 2025-07-30 (calculated), PSI/EXP/000010 2025-07-28 (calculated)

### EXPORT086: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 2.00 on 1 invoice(s), 1 open; first 2026-10-16, latest 2026-10-16 (EXP-1886)
- Invoice descriptions: "Skinless fillet 06 - 08 oz (samples)" ×1
- Item master rows: `SKU-0243` "Skinless fillet 06 - 08 oz (samples)" → Skinless Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1886 2026-10-16 (calculated)

### EXPORT087: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 2.00 on 1 invoice(s), 1 open; first 2026-10-16, latest 2026-10-16 (EXP-1886)
- Invoice descriptions: "Skinless fillet 08 - 10 oz (samples)" ×1
- Item master rows: `SKU-0244` "Skinless fillet 08 - 10 oz (samples)" → Skinless Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1886 2026-10-16 (calculated)

### EXPORT088: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 2.00 on 1 invoice(s), 1 open; first 2026-10-16, latest 2026-10-16 (EXP-1886)
- Invoice descriptions: "Skin-on fillet 06 - 08 oz (samples)" ×1
- Item master rows: `SKU-0245` "Skin-on fillet 06 - 08 oz (samples)" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1886 2026-10-16 (calculated)

### EXPORT089: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 2.00 on 1 invoice(s), 1 open; first 2026-10-16, latest 2026-10-16 (EXP-1886)
- Invoice descriptions: "Skin-on fillet 08 - 10 oz (samples)" ×1
- Item master rows: `SKU-0246` "Skin-on fillet 08 - 10 oz (samples)" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1886 2026-10-16 (calculated)

### EXPORT082: Not confirmed

- TIEP item: Gilled, Gutted and Scaled
- Under TIEP Approval 2024/25: Gilled, Gutted and Scaled at 88%
- Under TIEP Approval 2025/26: Gilled, Gutted and Scaled at 88%
- Kg exported: 2.26 on 2 invoice(s), 2 open; first 2026-10-01, latest 2026-10-05 (EXP-1884)
- Invoice descriptions: "Convenience Range - Barra BBQ-Marinated Butterfly Cuts (01 ptn) 375g box" ×2
- Item master rows: `SKU-0240` "Convenience Range - Barra BBQ-Marinated Butterfly Cuts (01 ptn) 375g box" → Gilled, Gutted and Scaled [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Butterfly cut: same convention as the item master (GGS)
- Invoices: EXP-1884 2026-10-05 (calculated), EXP-1883 2026-10-01 (calculated)

### EXPORT079: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 1.92 on 2 invoice(s), 2 open; first 2026-10-01, latest 2026-10-05 (EXP-1884)
- Invoice descriptions: "Convenience Range - Barra Kofta (08 pcs) 320g box" ×2
- Item master rows: `SKU-0237` "Convenience Range - Barra Kofta (08 pcs) 320g box" → Skinless Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Value-added product (small quantities): confirm the TIEP item
- Invoices: EXP-1884 2026-10-05 (calculated), EXP-1883 2026-10-01 (calculated)

### EXPORT083: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 1.92 on 2 invoice(s), 2 open; first 2026-10-01, latest 2026-10-05 (EXP-1884)
- Invoice descriptions: "Convenience Range - Barra Bits 320g box" ×2
- Item master rows: `SKU-0241` "Convenience Range - Barra Bits 320g box" → Skinless Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Value-added product (small quantities): confirm the TIEP item
- Invoices: EXP-1884 2026-10-05 (calculated), EXP-1883 2026-10-01 (calculated)

### EXPORT073: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 1.80 on 2 invoice(s), 2 open; first 2026-10-01, latest 2026-10-05 (EXP-1884)
- Invoice descriptions: "Instant gourmet marinated Fillets - Asian Tropical flavour 300g box" ×2
- Item master rows: `SKU-0231` "Instant gourmet marinated Fillets - Asian Tropical flavour 300g box" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Value-added product (small quantities): confirm the TIEP item
- Invoices: EXP-1884 2026-10-05 (calculated), EXP-1883 2026-10-01 (calculated)

### EXPORT074: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 1.80 on 2 invoice(s), 2 open; first 2026-10-01, latest 2026-10-05 (EXP-1884)
- Invoice descriptions: "Instant gourmet marinated Fillets - Japanese Classic flavour 300g box" ×2
- Item master rows: `SKU-0232` "Instant gourmet marinated Fillets - Japanese Classic flavour 300g box" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Value-added product (small quantities): confirm the TIEP item
- Invoices: EXP-1884 2026-10-05 (calculated), EXP-1883 2026-10-01 (calculated)

### EXPORT075: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 1.80 on 2 invoice(s), 2 open; first 2026-10-01, latest 2026-10-05 (EXP-1884)
- Invoice descriptions: "Instant gourmet marinated Fillets - Exotic Delight flavour 300g box" ×2
- Item master rows: `SKU-0233` "Instant gourmet marinated Fillets - Exotic Delight flavour 300g box" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Value-added product (small quantities): confirm the TIEP item
- Invoices: EXP-1884 2026-10-05 (calculated), EXP-1883 2026-10-01 (calculated)

### EXPORT076: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 1.80 on 2 invoice(s), 2 open; first 2026-10-01, latest 2026-10-05 (EXP-1884)
- Invoice descriptions: "Instant gourmet marinated Fillets - Black Bean Glow flavour 300g box" ×2
- Item master rows: `SKU-0234` "Instant gourmet marinated Fillets - Black Bean Glow flavour 300g box" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Value-added product (small quantities): confirm the TIEP item
- Invoices: EXP-1884 2026-10-05 (calculated), EXP-1883 2026-10-01 (calculated)

### EXPORT077: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 1.80 on 2 invoice(s), 2 open; first 2026-10-01, latest 2026-10-05 (EXP-1884)
- Invoice descriptions: "Convenience Range - Barra Battered Fillets 300g box" ×2
- Item master rows: `SKU-0235` "Convenience Range - Barra Battered Fillets 300g box" → Skinless Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Value-added product (small quantities): confirm the TIEP item
- Invoices: EXP-1884 2026-10-05 (calculated), EXP-1883 2026-10-01 (calculated)

### EXPORT078: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 1.80 on 2 invoice(s), 2 open; first 2026-10-01, latest 2026-10-05 (EXP-1884)
- Invoice descriptions: "Convenience Range - Barra Spring Rolls 300g box" ×2
- Item master rows: `SKU-0236` "Convenience Range - Barra Spring Rolls 300g box" → Skinless Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Value-added product (small quantities): confirm the TIEP item
- Invoices: EXP-1884 2026-10-05 (calculated), EXP-1883 2026-10-01 (calculated)

### EXPORT080: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 1.80 on 2 invoice(s), 2 open; first 2026-10-01, latest 2026-10-05 (EXP-1884)
- Invoice descriptions: "Convenience Range - Barra Battered Goujons 300g box" ×2
- Item master rows: `SKU-0238` "Convenience Range - Barra Battered Goujons 300g box" → Skinless Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Value-added product (small quantities): confirm the TIEP item
- Invoices: EXP-1884 2026-10-05 (calculated), EXP-1883 2026-10-01 (calculated)

### EXPORT081: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 1.80 on 2 invoice(s), 2 open; first 2026-10-01, latest 2026-10-05 (EXP-1884)
- Invoice descriptions: "Convenience Range - Barra Burger Patties (05 pcs) 300g box" ×2
- Item master rows: `SKU-0239` "Convenience Range - Barra Burger Patties (05 pcs) 300g box" → Skinless Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Value-added product (small quantities): confirm the TIEP item
- Invoices: EXP-1884 2026-10-05 (calculated), EXP-1883 2026-10-01 (calculated)

### EXPORT084: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 1.80 on 2 invoice(s), 2 open; first 2026-10-01, latest 2026-10-05 (EXP-1884)
- Invoice descriptions: "Convenience Range - Barra Battered Belly Strips 300g box" ×2
- Item master rows: `SKU-0242` "Convenience Range - Barra Battered Belly Strips 300g box" → Skinless Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Value-added product (small quantities): confirm the TIEP item
- Invoices: EXP-1884 2026-10-05 (calculated), EXP-1883 2026-10-01 (calculated)

### EXPORT068: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 12.00 on 1 invoice(s), 1 open; first 2026-10-01, latest 2026-10-01 (EXP-1876)
- Invoice descriptions: "SAMPLE BOXES - CHIPPIES DIRECT (Barra S/L Fillets 170g-200g)" ×1
- Item master rows: `SKU-0230` "SAMPLE BOXES - CHIPPIES DIRECT (Barra S/L Fillets 170g-200g)" → Skinless Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Skinless sample fillets
- Invoices: EXP-1876 2026-10-01 (calculated)

### EXPORT008: Not confirmed

- TIEP item: Skin on CC Portions 170-190
- Under TIEP Approval 2024/25: Skin on CC Portions 170-190 at 32%
- Under TIEP Approval 2025/26: Skin on CC Portions 170-190 at 32%
- Kg exported: 46,805.00 on 27 invoice(s), 27 open; first 2025-07-23, latest 2026-09-29 (EXP-1844)
- Invoice descriptions: "Barramundi CC Portions, Skin On 180g -5Kg Ctn - 7374" ×18; "ASC Barramundi CC Portions, Skin On 180g -5Kg Ctn - 7374" ×9
- Item master rows: `SKU-0007` "Barramundi CC Portions, Skin On 180g -5Kg Ctn - 7374" → Skin on CC Portions 170-190 [status confident]; `SKU-0172` "ASC Barramundi CC Portions, Skin On 180g -5Kg Ctn - 7374" → Skin on CC Portions 170-190 [status confident] — ASC-labelled name of item 7374 on invoice EXP-1845
- Invoices: EXP-1844 2026-09-29 (calculated), EXP-1841* 2026-08-31 (calculated), EXP-1860 2026-07-31 (calculated), EXP-1803* 2026-05-08 (calculated), EXP-1804* 2026-03-13 (calculated), EXP-1802* 2026-02-24 (calculated), 1685/EXP/OP 2026-01-21 (calculated), 1680/EXP/OP 2026-01-18 (calculated), 1682/EXP/OP 2026-01-09 (calculated), 1681/EXP/OP 2025-12-30 (calculated), EXP-1831 2025-12-19 (calculated), 1677/EXP/OP 2025-12-02 (calculated), EXP-1832 2025-12-02 (calculated), 1674/EXP/OP 2025-11-16 (calculated), 1676/EXP/OP 2025-11-16 (calculated), 1675/EXP/OP 2025-11-11 (calculated), 1671/EXP/OP 2025-10-18 (calculated), 1673/EXP/OP 2025-10-18 (calculated), EXP-1786 2025-09-30 (calculated), EXP-1795 2025-09-29 (calculated), PSI/EXP/000037 2025-08-29 (calculated), PSI/EXP/000050 2025-08-26 (calculated), PSI/EXP/000049 2025-08-20 (calculated), PSI/EXP/000027 2025-07-31 (calculated), PSI/EXP/000028 2025-07-30 (calculated), PSI/EXP/000016 2025-07-28 (calculated), PSI/EXP/000017 2025-07-23 (calculated)

### EXPORT071: Not confirmed

- TIEP item: Barramundi portions: 3-4Oz
- Under TIEP Approval 2024/25: Skin on CC Portions 170-190 at 32% (substitute: TIEP item not listed in this standard)
- Under TIEP Approval 2025/26: Barramundi portions: 3-4Oz at 42%
- Kg exported: 2.00 on 1 invoice(s), 1 open; first 2026-09-15, latest 2026-09-15 (EXP-1879)
- Invoice descriptions: "01kg – Ocean Raised Frozen Barramundi Portions (Skin On) 115-135g - 08 Ptns/Bag" ×1
- Item master rows: `SKU-0228` "01kg – Ocean Raised Frozen Barramundi Portions (Skin On) 115-135g - 08 Ptns/Bag" → Barramundi portions: 3-4Oz [status review] alt {"STD-TIEP2425":"Skin on CC Portions 170-190"} — Added from Export_Sales.xlsx (20 Nov 2026). 115-135 g skin-on portions
- Invoices: EXP-1879 2026-09-15 (calculated)

### EXPORT072: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 2.00 on 1 invoice(s), 1 open; first 2026-09-15, latest 2026-09-15 (EXP-1879)
- Invoice descriptions: "02kg Box – Ocean Raised Frozen Barramundi Fillets (Skinless) 200-300g" ×1
- Item master rows: `SKU-0229` "02kg Box – Ocean Raised Frozen Barramundi Fillets (Skinless) 200-300g" → Skinless Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1879 2026-09-15 (calculated)

### EXPORT066: Not confirmed

- TIEP item: Barramundi portions: 3-4Oz
- Under TIEP Approval 2024/25: Skin on CC Portions 170-190 at 32% (substitute: TIEP item not listed in this standard)
- Under TIEP Approval 2025/26: Barramundi portions: 3-4Oz at 42%
- Kg exported: 6.00 on 3 invoice(s), 3 open; first 2026-08-18, latest 2026-09-04 (EXP-1875)
- Invoice descriptions: "ASC Certified Barramundi Portions 110g" ×3
- Item master rows: `SKU-0224` "ASC Certified Barramundi Portions 110g" → Barramundi portions: 3-4Oz [status review] alt {"STD-TIEP2425":"Skin on CC Portions 170-190"} — Added from Export_Sales.xlsx (20 Nov 2026). Same treatment as item 7372
- Invoices: EXP-1875 2026-09-04 (calculated), EXP-1873 2026-08-25 (calculated), EXP-1872 2026-08-18 (calculated)

### EXPORT067: Not confirmed

- TIEP item: Barramundi portions: 6-8Oz
- Under TIEP Approval 2024/25: Skin on CC Portions 170-190 at 32% (substitute: TIEP item not listed in this standard)
- Under TIEP Approval 2025/26: Barramundi portions: 6-8Oz at 32%
- Kg exported: 6.00 on 3 invoice(s), 3 open; first 2026-08-18, latest 2026-09-04 (EXP-1875)
- Invoice descriptions: "ASC Certified Barramundi Portions 140g-170g" ×3
- Item master rows: `SKU-0225` "ASC Certified Barramundi Portions 140g-170g" → Barramundi portions: 6-8Oz [status review] alt {"STD-TIEP2425":"Skin on CC Portions 170-190"} — Added from Export_Sales.xlsx (20 Nov 2026). 140-170g portions
- Invoices: EXP-1875 2026-09-04 (calculated), EXP-1873 2026-08-25 (calculated), EXP-1872 2026-08-18 (calculated)

### EXPORT064: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 500.00 on 2 invoice(s), 2 open; first 2026-05-23, latest 2026-08-21 (EXP-1877)
- Invoice descriptions: "Frozen skin on fillets 250g-500g 15% GLZ" ×2
- Item master rows: `SKU-0222` "Frozen skin on fillets 250g-500g 15% GLZ" → Skin On Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1877 2026-08-21 (calculated), EXP-1862 2026-05-23 (calculated)

### EXPORT001: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 3,240.00 on 4 invoice(s), 4 open; first 2025-07-30, latest 2026-07-31 (EXP-1805*)
- Invoice descriptions: "Barramundi Skinless Fillets 100-200g - 5kg ctn - 7364" ×3; "ASC Barramundi Skinless Fillets 100-200g - 5kg ctn - 7364" ×1
- Item master rows: `SKU-0051` "Barramundi Skinless Fillets 100-200g - 5kg ctn - 7364" → Skinless Fillets [status confident]; `SKU-0196` "ASC Barramundi Skinless Fillets 100-200g - 5kg ctn - 7364" → Skinless Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1805* 2026-07-31 (calculated), EXP-1837 2026-07-31 (calculated), PSI/EXP/000027 2025-07-31 (calculated), PSI/EXP/000028 2025-07-30 (calculated)

### EXPORT017: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 8,170.00 on 2 invoice(s), 2 open; first 2025-10-27, latest 2026-07-13 (EXP-1859)
- Invoice descriptions: "Barramundi Fillet Asc S/O Pbo 20% 170-230 Gr - 5kg Carton" ×2
- Item master rows: `SKU-0012` "BARRAMUNDI FILLET ASC S/O PBO 20% 170-230 GR - 5KG CARTON" → Skin On Fillets [status confident]
- Invoices: EXP-1859 2026-07-13 (calculated), 1654/EXP/OP 2025-10-27 (calculated)

### EXPORT016: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 6,504.00 on 2 invoice(s), 2 open; first 2025-10-27, latest 2026-07-13 (EXP-1859)
- Invoice descriptions: "Barramundi Fillet Asc S/O Pbo 20% 170-230 Gr - 1kg Bag / 8kg Carton" ×2
- Item master rows: `SKU-0011` "BARRAMUNDI FILLET ASC S/O PBO 20% 170-230 GR - 1KG BAG / 8KG CARTON" → Skin On Fillets [status confident]
- Invoices: EXP-1859 2026-07-13 (calculated), 1654/EXP/OP 2025-10-27 (calculated)

### EXPORT005: Confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 153,417.00 on 28 invoice(s), 28 open; first 2025-06-22, latest 2026-05-08 (EXP-1803*)
- Invoice descriptions: "Barramundi Fillets skinless Ocean Chef 3kg ctn - 7370" ×25; "ASC Barramundi Fillets skinless Ocean Chef 3kg ctn - 7370" ×3
- Item master rows: `SKU-0023` "Barramundi Fillets skinless Ocean Chef 3kg ctn - 7370" → Skinless Fillets [status confident, confirmed 2026-11-21]; `SKU-0195` "ASC Barramundi Fillets skinless Ocean Chef 3kg ctn - 7370" → Skinless Fillets [status confident, confirmed 2026-11-21] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1803* 2026-05-08 (calculated), EXP-1839 2026-03-21 (calculated), 1683/EXP/OP 2026-02-03 (calculated), 1684/EXP/OP 2026-01-28 (calculated), 1685/EXP/OP 2026-01-21 (calculated), 1680/EXP/OP 2026-01-18 (calculated), EXP-1827 2026-01-18 (calculated), 1682/EXP/OP 2026-01-09 (calculated), 1681/EXP/OP 2025-12-30 (calculated), EXP-1831 2025-12-19 (calculated), 1677/EXP/OP 2025-12-02 (calculated), EXP-1832 2025-12-02 (calculated), 1674/EXP/OP 2025-11-16 (calculated), 1676/EXP/OP 2025-11-16 (calculated), 1678/EXP/OP 2025-11-16 (calculated), 1675/EXP/OP 2025-11-11 (calculated), 1671/EXP/OP 2025-10-18 (calculated), 1673/EXP/OP 2025-10-18 (calculated), EXP-1786 2025-09-30 (calculated), EXP-1795 2025-09-29 (calculated), PSI/EXP/000050 2025-08-26 (calculated), PSI/EXP/000049 2025-08-20 (calculated), PSI/EXP/000027 2025-07-31 (calculated), PSI/EXP/000028 2025-07-30 (calculated), PSI/EXP/000016 2025-07-28 (calculated), PSI/EXP/000017 2025-07-23 (calculated), E21374 2025-06-29 (calculated), E21371 2025-06-22 (calculated)

### EXPORT037: Not confirmed

- TIEP item: Barramundi portions: 3-4Oz
- Under TIEP Approval 2024/25: Skin on CC Portions 170-190 at 32% (substitute: TIEP item not listed in this standard)
- Under TIEP Approval 2025/26: Barramundi portions: 3-4Oz at 42%
- Kg exported: 23,298.30 on 11 invoice(s), 11 open; first 2025-07-23, latest 2026-03-13 (EXP-1804*)
- Invoice descriptions: "Barramundi Portions skin on 80G-120G Ocean Chef 6x1kg ctn - 7372 (CC)" ×7; "Barramundi Portions skin on 80G-120G Ocean Chef 6x1kg ctn - 7373(CC)" ×4
- Item master rows: `SKU-0190` "Barramundi Portions skin on 80G-120G Ocean Chef 6x1kg ctn - 7373(CC)" → Barramundi portions: 3-4Oz [status review] alt {"STD-TIEP2425":"Skin on CC Portions 170-190"} — Added from Export_Sales.xlsx (20 Nov 2026). Same treatment as item 7372; `SKU-0203` "Barramundi Portions skin on 80G-120G Ocean Chef 6x1kg ctn - 7372 (CC)" → Barramundi portions: 3-4Oz [status review] alt {"STD-TIEP2425":"Skin on CC Portions 170-190"} — Added from Export_Sales.xlsx (20 Nov 2026). Same treatment as item 7372
- Invoices: EXP-1804* 2026-03-13 (calculated), EXP-1802* 2026-02-24 (calculated), 1680/EXP/OP 2026-01-18 (calculated), 1671/EXP/OP 2025-10-18 (calculated), EXP-1795 2025-09-29 (calculated), PSI/EXP/000037 2025-08-29 (calculated), PSI/EXP/000050 2025-08-26 (calculated), PSI/EXP/000049 2025-08-20 (calculated), PSI/EXP/000027 2025-07-31 (calculated), PSI/EXP/000016 2025-07-28 (calculated), PSI/EXP/000017 2025-07-23 (calculated)

### SE0031: No TIEP item (left out)

- TIEP item: none (left out)
- Kg exported: 1,414.58 on 69 invoice(s), 69 open; first 2025-06-22, latest 2026-02-03 (1683/EXP/OP)
- Invoice descriptions: "Freight Charges" ×67; "Freight Charges-PW" ×2
- Item master rows: `SKU-0081` "Freight Charges" → none [status none]; `SKU-0084` "Freight Charges-PW" → none [status none]
- Invoices: 1683/EXP/OP 2026-02-03 (calculated), 1684/EXP/OP 2026-01-28 (calculated), 1685/EXP/OP 2026-01-21 (calculated), 1680/EXP/OP 2026-01-18 (calculated), 1682/EXP/OP 2026-01-09 (calculated), 1681/EXP/OP 2025-12-30 (calculated), EXP-1831 2025-12-19 (calculated), EXP-1836 2025-12-11 (calculated), 1677/EXP/OP 2025-12-02 (calculated), EXP-1832 2025-12-02 (calculated), EXP-1835 2025-11-27 (calculated), EXP-1833 2025-11-20 (calculated), EXP-1830 2025-11-17 (calculated), 1674/EXP/OP 2025-11-16 (calculated), 1676/EXP/OP 2025-11-16 (calculated), 1678/EXP/OP 2025-11-16 (calculated), EXP-1828 2025-11-13 (calculated), 1675/EXP/OP 2025-11-11 (calculated), EXP-1826 2025-11-10 (calculated), EXP-1823 2025-11-06 (calculated), EXP-1822 2025-11-03 (calculated), EXP-1806 2025-10-30 (calculated), 1654/EXP/OP 2025-10-27 (calculated), EXP-1805 2025-10-27 (calculated), EXP-1798 2025-10-23 (calculated), EXP-1804 2025-10-20 (calculated), 1671/EXP/OP 2025-10-18 (calculated), 1673/EXP/OP 2025-10-18 (calculated), EXP-1801 2025-10-16 (calculated), EXP-1802 2025-10-10 (calculated), EXP-1803 2025-10-09 (calculated), EXP-1793 2025-10-06 (calculated), EXP-1792 2025-10-02 (calculated), EXP-1786 2025-09-30 (calculated), EXP-1795 2025-09-29 (calculated), EXP-1783 2025-09-24 (calculated), EXP-1785 2025-09-20 (calculated), EXP-1780 2025-09-18 (calculated), PSI/EXP/000044 2025-09-16 (calculated), PSI/EXP/000040 2025-09-07 (calculated), PSI/EXP/000038 2025-08-31 (calculated), PSI/EXP/000037 2025-08-29 (calculated), PSI/EXP/000050 2025-08-26 (calculated), PSI/EXP/000035 2025-08-24 (calculated), PSI/EXP/000026 2025-08-21 (calculated), PSI/EXP/000049 2025-08-20 (calculated), PSI/EXP/000025 2025-08-18 (calculated), PSI/EXP/000024 2025-08-14 (calculated), PSI/EXP/000030 2025-08-07 (calculated), PSI/EXP/000022 2025-08-06 (calculated), PSI/EXP/000023 2025-08-04 (calculated), PSI/EXP/000021 2025-07-31 (calculated), PSI/EXP/000027 2025-07-31 (calculated), PSI/EXP/000028 2025-07-30 (calculated), PSI/EXP/000029 2025-07-30 (calculated), PSI/EXP/000016 2025-07-28 (calculated), PSI/EXP/000007 2025-07-24 (calculated), PSI/EXP/000006 2025-07-23 (calculated), PSI/EXP/000017 2025-07-23 (calculated), PSI/EXP/000001 2025-07-16 (calculated), PSI/EXP/000005 2025-07-16 (calculated), PSI/EXP/000011 2025-07-16 (calculated), PSI/EXP/000009 2025-07-15 (calculated), PSI/EXP/000004 2025-07-11 (calculated), PSI/EXP/000003 2025-07-07 (calculated), PSI/EXP/000002 2025-07-04 (calculated), 1538/EXP/OP 2025-07-02 (calculated), E21374 2025-06-29 (calculated), E21371 2025-06-22 (calculated)

### LOC58: Not confirmed

- TIEP item: Uncleaned Fish (Whole round)
- Under TIEP Approval 2024/25: Uncleaned Fish (Whole round) at 100%
- Under TIEP Approval 2025/26: Uncleaned Fish (Whole round) at 100%
- Kg exported: 3,073.22 on 5 invoice(s), 5 open; first 2025-10-24, latest 2026-01-19 (IE-00106)
- Invoice descriptions: "IE - Whole Round Barramundi" ×7
- Item master rows: `SKU-0216` "IE - Whole Round Barramundi" → Uncleaned Fish (Whole round) [status review] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: IE-00106 2026-01-19 (calculated), IE-00084 2025-11-19 (calculated), IE-00078 2025-11-09 (calculated), IE-00076 2025-11-02 (calculated), IE-00064 2025-10-24 (calculated)

### EXPORT036: Not confirmed

- TIEP item: Uncleaned Fish (Whole round)
- Under TIEP Approval 2024/25: Uncleaned Fish (Whole round) at 100%
- Under TIEP Approval 2025/26: Uncleaned Fish (Whole round) at 100%
- Kg exported: 8,000.00 on 2 invoice(s), 2 open; first 2025-09-23, latest 2025-12-16 (1697/EXP/OP)
- Invoice descriptions: "Barramundi Whole Round Gill Bled (1 kg to 1.5 kg) 10kg" ×1; "Barramundi Whole Round Gill Bled (1.5 kg to 2 kg)" ×1; "Barramundi Whole Round Gill Bled (1 kg to 1.5 kg)" ×1
- Item master rows: `SKU-0212` "Barramundi Whole Round Gill Bled (1.5 kg to 2 kg)" → Uncleaned Fish (Whole round) [status review] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0213` "Barramundi Whole Round Gill Bled (1 kg to 1.5 kg)" → Uncleaned Fish (Whole round) [status review] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0219` "Barramundi Whole Round Gill Bled (1 kg to 1.5 kg) 10kg" → Uncleaned Fish (Whole round) [status review] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: 1697/EXP/OP 2025-12-16 (calculated), EXP-1794 2025-09-23 (calculated)

### EXPORT056: Not confirmed

- TIEP item: Uncleaned Fish (Whole round)
- Under TIEP Approval 2024/25: Uncleaned Fish (Whole round) at 100%
- Under TIEP Approval 2025/26: Uncleaned Fish (Whole round) at 100%
- Kg exported: 3,160.00 on 1 invoice(s), 1 open; first 2025-12-16, latest 2025-12-16 (1697/EXP/OP)
- Invoice descriptions: "Barramundi Whole Round Gill Bled (1.5kg+) 20kg" ×1
- Item master rows: `SKU-0217` "Barramundi Whole Round Gill Bled (1.5kg+) 20kg" → Uncleaned Fish (Whole round) [status review] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: 1697/EXP/OP 2025-12-16 (calculated)

### EXPORT057: Not confirmed

- TIEP item: Uncleaned Fish (Whole round)
- Under TIEP Approval 2024/25: Uncleaned Fish (Whole round) at 100%
- Under TIEP Approval 2025/26: Uncleaned Fish (Whole round) at 100%
- Kg exported: 2,000.00 on 1 invoice(s), 1 open; first 2025-12-16, latest 2025-12-16 (1697/EXP/OP)
- Invoice descriptions: "Barramundi Whole Round Gill Bled (1kg-1.5kg) 20kg" ×1
- Item master rows: `SKU-0218` "Barramundi Whole Round Gill Bled (1kg-1.5kg) 20kg" → Uncleaned Fish (Whole round) [status review] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: 1697/EXP/OP 2025-12-16 (calculated)

### EXPORT047: Not confirmed

- TIEP item: Gilled and Gutted
- Under TIEP Approval 2024/25: Gilled and Gutted at 90%
- Under TIEP Approval 2025/26: Gilled and Gutted at 90%
- Kg exported: 1,182.33 on 20 invoice(s), 20 open; first 2025-07-04, latest 2025-12-11 (EXP-1836)
- Invoice descriptions: "Fresh Barramundi Whole Gilled & Gutted 1200g+" ×20
- Item master rows: `SKU-0181` "Fresh Barramundi Whole Gilled & Gutted 1200g+" → Gilled and Gutted [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1836 2025-12-11 (calculated), EXP-1835 2025-11-27 (calculated), EXP-1833 2025-11-20 (calculated), EXP-1828 2025-11-13 (calculated), EXP-1823 2025-11-06 (calculated), EXP-1806 2025-10-30 (calculated), EXP-1798 2025-10-23 (calculated), EXP-1801 2025-10-16 (calculated), EXP-1803 2025-10-09 (calculated), EXP-1792 2025-10-02 (calculated), EXP-1785 2025-09-20 (calculated), PSI/EXP/000044 2025-09-16 (calculated), PSI/EXP/000026 2025-08-21 (calculated), PSI/EXP/000024 2025-08-14 (calculated), PSI/EXP/000030 2025-08-07 (calculated), PSI/EXP/000021 2025-07-31 (calculated), PSI/EXP/000007 2025-07-24 (calculated), PSI/EXP/000005 2025-07-16 (calculated), PSI/EXP/000004 2025-07-11 (calculated), PSI/EXP/000002 2025-07-04 (calculated)

### EXPORT025: Confirmed

- TIEP item: Gilled and Gutted
- Under TIEP Approval 2024/25: Gilled and Gutted at 90%
- Under TIEP Approval 2025/26: Gilled and Gutted at 90%
- Kg exported: 343.65 on 21 invoice(s), 21 open; first 2025-06-12, latest 2025-12-11 (EXP-1836)
- Invoice descriptions: "Fresh Barramundi Whole Gilled & Gutted 900g+" ×18; "Fresh Barramundi Whole Gilled & Gutted ( 900g+ to 1200g+)" ×4
- Item master rows: `SKU-0097` "Fresh Barramundi Whole Gilled & Gutted ( 900g+ to 1200g+)" → Gilled and Gutted [status confident, confirmed 2026-11-21]; `SKU-0184` "Fresh Barramundi Whole Gilled & Gutted 900g+" → Gilled and Gutted [status confident, confirmed 2026-11-21] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1836 2025-12-11 (calculated), EXP-1835 2025-11-27 (calculated), EXP-1833 2025-11-20 (calculated), EXP-1828 2025-11-13 (calculated), EXP-1823 2025-11-06 (calculated), EXP-1806 2025-10-30 (calculated), EXP-1798 2025-10-23 (calculated), EXP-1801 2025-10-16 (calculated), EXP-1803 2025-10-09 (calculated), EXP-1792 2025-10-02 (calculated), EXP-1785 2025-09-20 (calculated), PSI/EXP/000044 2025-09-16 (calculated), PSI/EXP/000026 2025-08-21 (calculated), PSI/EXP/000024 2025-08-14 (calculated), PSI/EXP/000030 2025-08-07 (calculated), PSI/EXP/000021 2025-07-31 (calculated), PSI/EXP/000007 2025-07-24 (calculated), PSI/EXP/000005 2025-07-16 (calculated), 1538/EXP/OP 2025-07-02 (calculated), E21372 2025-06-26 (calculated), E21368 2025-06-12 (calculated)

### EXPORT023: Not confirmed

- TIEP item: Skin On D-Trimmed Fillets 10oz+
- Under TIEP Approval 2024/25: Skin On D-Trimmed Fillets 10oz+ at 40%
- Under TIEP Approval 2025/26: Skin On D-Trimmed Fillets 10oz+ at 45%
- Kg exported: 8,135.09 on 19 invoice(s), 19 open; first 2025-07-07, latest 2025-11-17 (EXP-1830)
- Invoice descriptions: "Ocean Reared Farm Raised Barramundi , fresh fillets 10-14oz Skin-on Scaled 10K Film 1x10lb" ×19
- Item master rows: `SKU-0182` "Ocean Reared Farm Raised Barramundi , fresh fillets 10-14oz Skin-on Scaled 10K Film 1x10lb" → Skin On D-Trimmed Fillets 10oz+ [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Fresh skin-on scaled fillets 10-14oz
- Invoices: EXP-1830 2025-11-17 (calculated), EXP-1826 2025-11-10 (calculated), EXP-1822 2025-11-03 (calculated), EXP-1805 2025-10-27 (calculated), EXP-1804 2025-10-20 (calculated), EXP-1802 2025-10-10 (calculated), EXP-1793 2025-10-06 (calculated), EXP-1783 2025-09-24 (calculated), EXP-1780 2025-09-18 (calculated), PSI/EXP/000040 2025-09-07 (calculated), PSI/EXP/000038 2025-08-31 (calculated), PSI/EXP/000035 2025-08-24 (calculated), PSI/EXP/000025 2025-08-18 (calculated), PSI/EXP/000022 2025-08-06 (calculated), PSI/EXP/000023 2025-08-04 (calculated), PSI/EXP/000006 2025-07-23 (calculated), PSI/EXP/000001 2025-07-16 (calculated), PSI/EXP/000009 2025-07-15 (calculated), PSI/EXP/000003 2025-07-07 (calculated)

### EXPORT050: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 2,128.78 on 24 invoice(s), 24 open; first 2025-07-16, latest 2025-11-05 (EXP-1824)
- Invoice descriptions: "ASC Barramundi Skin-on Fillets 150g - 200g" ×24; "ASC Barramundi Skin-on Fillets 150g - 200g (Absorbent paper)" ×1; "ASC Barramundi Skin-on Fillets 150g - 200g (OTR Bag)" ×1
- Item master rows: `SKU-0186` "ASC Barramundi Skin-on Fillets 150g - 200g" → Skin On Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0207` "ASC Barramundi Skin-on Fillets 150g - 200g (Absorbent paper)" → Skin On Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0208` "ASC Barramundi Skin-on Fillets 150g - 200g (OTR Bag)" → Skin On Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1824 2025-11-05 (calculated), EXP-1820 2025-11-01 (calculated), EXP-1800 2025-10-29 (calculated), EXP-1799 2025-10-25 (calculated), EXP-1797 2025-10-21 (calculated), EXP-1796 2025-10-17 (calculated), EXP-1791 2025-10-14 (calculated), EXP-1790 2025-10-10 (calculated), EXP-1796-B1 2025-10-10 (calculated), EXP-1789 2025-10-07 (calculated), EXP-1788 2025-10-03 (calculated), EXP-1787 2025-09-30 (calculated), EXP-1784 2025-09-25 (calculated), EXP-1782 2025-09-23 (calculated), EXP-1781 2025-09-20 (calculated), PSI/EXP/000043 2025-09-16 (calculated), PSI/EXP/000042 2025-09-13 (calculated), PSI/EXP/000041 2025-09-09 (calculated), PSI/EXP/000039 2025-08-26 (calculated), PSI/EXP/000034 2025-08-20 (calculated), PSI/EXP/000033 2025-08-12 (calculated), PSI/EXP/000032 2025-08-09 (calculated), PSI/EXP/000031 2025-08-02 (calculated), PSI/EXP/000011 2025-07-16 (calculated)

### EXPORT040: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 1,340.68 on 24 invoice(s), 24 open; first 2025-07-02, latest 2025-11-05 (EXP-1824)
- Invoice descriptions: "ASC Barramundi Skin-on Fillets 200g - 250g" ×23; "ASC Barramundi Skin-on Fillets 200g - 300g" ×3; "ASC Barramundi Skin-on Fillets 200g - 250g (Absorbent paper)" ×1; "ASC Barramundi Skin-on Fillets 200g - 250g (OTR Bag)" ×1
- Item master rows: `SKU-0180` "ASC Barramundi Skin-on Fillets 200g - 300g" → Skin On Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0187` "ASC Barramundi Skin-on Fillets 200g - 250g" → Skin On Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0209` "ASC Barramundi Skin-on Fillets 200g - 250g (Absorbent paper)" → Skin On Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0210` "ASC Barramundi Skin-on Fillets 200g - 250g (OTR Bag)" → Skin On Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1824 2025-11-05 (calculated), EXP-1820 2025-11-01 (calculated), EXP-1800 2025-10-29 (calculated), EXP-1799 2025-10-25 (calculated), EXP-1797 2025-10-21 (calculated), EXP-1796 2025-10-17 (calculated), EXP-1790 2025-10-10 (calculated), EXP-1796-B1 2025-10-10 (calculated), EXP-1789 2025-10-07 (calculated), EXP-1788 2025-10-03 (calculated), EXP-1787 2025-09-30 (calculated), EXP-1784 2025-09-25 (calculated), EXP-1782 2025-09-23 (calculated), EXP-1781 2025-09-20 (calculated), PSI/EXP/000043 2025-09-16 (calculated), PSI/EXP/000042 2025-09-13 (calculated), PSI/EXP/000041 2025-09-09 (calculated), PSI/EXP/000039 2025-08-26 (calculated), PSI/EXP/000034 2025-08-20 (calculated), PSI/EXP/000033 2025-08-12 (calculated), PSI/EXP/000032 2025-08-09 (calculated), PSI/EXP/000031 2025-08-02 (calculated), PSI/EXP/000011 2025-07-16 (calculated), PSI/EXP/000014 2025-07-02 (calculated)

### EXPORT018: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 3,500.00 on 1 invoice(s), 1 open; first 2025-10-27, latest 2025-10-27 (1654/EXP/OP)
- Invoice descriptions: "Barramundi Fillet Asc S/O Pbo 20% 300-500 Gr - 5kg Carton" ×1
- Item master rows: `SKU-0014` "BARRAMUNDI FILLET ASC S/O PBO 20% 300-500 GR - 5KG CARTON" → Skin On Fillets [status confident]
- Invoices: 1654/EXP/OP 2025-10-27 (calculated)

### EXPORT015: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 2,500.00 on 1 invoice(s), 1 open; first 2025-10-27, latest 2025-10-27 (1654/EXP/OP)
- Invoice descriptions: "Barramundi Fillet Asc S/L Pbo 20% 200-300 Gr - 5kg Carton" ×1
- Item master rows: `SKU-0010` "BARRAMUNDI FILLET ASC S/L PBO 20% 200-300 GR - 5KG CARTON" → Skinless Fillets [status confident]
- Invoices: 1654/EXP/OP 2025-10-27 (calculated)

### EXPORT020: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 1,000.00 on 1 invoice(s), 1 open; first 2025-10-27, latest 2025-10-27 (1654/EXP/OP)
- Invoice descriptions: "Barramundi Fillet Asc S/O Pbo 20% 200-300 Gr 5kg Bulk" ×1
- Item master rows: `SKU-0013` "BARRAMUNDI FILLET ASC S/O PBO 20% 200-300 GR 5KG BULK" → Skin On Fillets [status confident]
- Invoices: 1654/EXP/OP 2025-10-27 (calculated)

### EXPORT007: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 300.00 on 1 invoice(s), 1 open; first 2025-10-18, latest 2025-10-18 (1673/EXP/OP)
- Invoice descriptions: "Barramundi Skinless Fillets Pieces 20g Up 5kg ctn - 7373" ×1
- Item master rows: `SKU-0054` "Barramundi Skinless Fillets Pieces 20g Up 5kg ctn - 7373" → Skinless Fillets [status confident]
- Invoices: 1673/EXP/OP 2025-10-18 (calculated)

### EXPORT046: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 3,414.08 on 1 invoice(s), 1 open; first 2025-10-11, latest 2025-10-11 (1690/EXP/OP)
- Invoice descriptions: "Barramundi Skinless Fillet 7 to 9 oz" ×1
- Item master rows: `SKU-0215` "Barramundi Skinless Fillet 7 to 9 oz" → Skinless Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: 1690/EXP/OP 2025-10-11 (calculated)

### EXPORT045: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 3,395.92 on 1 invoice(s), 1 open; first 2025-10-11, latest 2025-10-11 (1690/EXP/OP)
- Invoice descriptions: "Barramundi Skinless Fillet 5 to 7 oz" ×1
- Item master rows: `SKU-0214` "Barramundi Skinless Fillet 5 to 7 oz" → Skinless Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: 1690/EXP/OP 2025-10-11 (calculated)

### EXPORT051: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 424.03 on 7 invoice(s), 7 open; first 2025-07-16, latest 2025-10-07 (EXP-1789)
- Invoice descriptions: "ASC Barramundi Skin-on Fillets 250g - 300g" ×7
- Item master rows: `SKU-0188` "ASC Barramundi Skin-on Fillets 250g - 300g" → Skin On Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: EXP-1789 2025-10-07 (calculated), PSI/EXP/000039 2025-08-26 (calculated), PSI/EXP/000034 2025-08-20 (calculated), PSI/EXP/000033 2025-08-12 (calculated), PSI/EXP/000032 2025-08-09 (calculated), PSI/EXP/000031 2025-08-02 (calculated), PSI/EXP/000011 2025-07-16 (calculated)

### EXPORT042: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 483.67 on 10 invoice(s), 10 open; first 2025-07-02, latest 2025-09-16 (PSI/EXP/000043)
- Invoice descriptions: "ASC Barramundi Skin-on Fillets 100g - 150g" ×8; "ASC Barramundi Skin-on Fillets 100g - 200g" ×3; "ASC Barramundi Skin-on Fillets 100g - 150g (Absorbent paper)" ×1; "ASC Barramundi Skin-on Fillets 100g - 150g (OTR Bag)" ×1
- Item master rows: `SKU-0179` "ASC Barramundi Skin-on Fillets 100g - 200g" → Skin On Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0185` "ASC Barramundi Skin-on Fillets 100g - 150g" → Skin On Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0205` "ASC Barramundi Skin-on Fillets 100g - 150g (Absorbent paper)" → Skin On Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0206` "ASC Barramundi Skin-on Fillets 100g - 150g (OTR Bag)" → Skin On Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: PSI/EXP/000043 2025-09-16 (calculated), PSI/EXP/000042 2025-09-13 (calculated), PSI/EXP/000041 2025-09-09 (calculated), PSI/EXP/000039 2025-08-26 (calculated), PSI/EXP/000034 2025-08-20 (calculated), PSI/EXP/000033 2025-08-12 (calculated), PSI/EXP/000032 2025-08-09 (calculated), PSI/EXP/000031 2025-08-02 (calculated), PSI/EXP/000011 2025-07-16 (calculated), PSI/EXP/000014 2025-07-02 (calculated)

### LOC09: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 630.00 on 9 invoice(s), 9 open; first 2025-08-01, latest 2025-09-15 (IE-00047)
- Invoice descriptions: "ROUNDISLAND BARRAMUNDI-SKIN OFF BELLY TRIMMED" ×9
- Item master rows: `SKU-0202` "ROUNDISLAND BARRAMUNDI-SKIN OFF BELLY TRIMMED" → Skinless Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Belly trim, skin off
- Invoices: IE-00047 2025-09-15 (calculated), IE-00034 2025-09-04 (calculated), IE-00032 2025-09-01 (calculated), IE-00024 2025-08-29 (calculated), IE-00019 2025-08-22 (calculated), IE-00023 2025-08-15 (calculated), IE-00022 2025-08-07 (calculated), IE-00021 2025-08-04 (calculated), IE-00020 2025-08-01 (calculated)

### EXPORT030: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 605.00 on 2 invoice(s), 2 open; first 2025-07-12, latest 2025-09-10 (PSI/EXP/000048)
- Invoice descriptions: "Frozen Barramundi skin on belly on fillet 250g-500g" ×2; "Frozen Barramundi skin on belly on fillet 250g-500g - Sample" ×1
- Item master rows: `SKU-0105` "Frozen Barramundi skin on belly on fillet 250g-500g" → Skin On Fillets [status confident]; `SKU-0211` "Frozen Barramundi skin on belly on fillet 250g-500g - Sample" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: PSI/EXP/000048 2025-09-10 (calculated), PSI/EXP/000012 2025-07-12 (calculated)

### EXPORT032: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 500.00 on 1 invoice(s), 1 open; first 2025-09-10, latest 2025-09-10 (PSI/EXP/000048)
- Invoice descriptions: "Frozen Barramundi skinless belly on fillet 250g-500g" ×1
- Item master rows: `SKU-0108` "Frozen Barramundi skinless belly on fillet 250g-500g" → Skinless Fillets [status confident]
- Invoices: PSI/EXP/000048 2025-09-10 (calculated)

### EXPORT033: Not confirmed

- TIEP item: Skin on CC Portions 170-190
- Under TIEP Approval 2024/25: Skin on CC Portions 170-190 at 32%
- Under TIEP Approval 2025/26: Skin on CC Portions 170-190 at 32%
- Kg exported: 200.00 on 2 invoice(s), 2 open; first 2025-07-12, latest 2025-09-10 (PSI/EXP/000048)
- Invoice descriptions: "Frozen Barramundi Skin on Center Cut Portion 170g-200g" ×2
- Item master rows: `SKU-0106` "Frozen Barramundi Skin on Center Cut Portion 170g-200g" → Skin on CC Portions 170-190 [status confident]
- Invoices: PSI/EXP/000048 2025-09-10 (calculated), PSI/EXP/000012 2025-07-12 (calculated)

### EXPORT002: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 8,320.00 on 4 invoice(s), 4 open; first 2025-07-23, latest 2025-08-29 (PSI/EXP/000037)
- Invoice descriptions: "Barramundi Skinless Fillets 200-300g - 5kg ctn - 7365" ×3; "ASC Barramundi Skinless Fillets 200-300g - 5kg ctn - 7365" ×1
- Item master rows: `SKU-0052` "Barramundi Skinless Fillets 200-300g - 5kg ctn - 7365" → Skinless Fillets [status confident]; `SKU-0191` "ASC Barramundi Skinless Fillets 200-300g - 5kg ctn - 7365" → Skinless Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: PSI/EXP/000037 2025-08-29 (calculated), PSI/EXP/000027 2025-07-31 (calculated), PSI/EXP/000016 2025-07-28 (calculated), PSI/EXP/000017 2025-07-23 (calculated)

### EXPORT010: Confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 7,840.00 on 4 invoice(s), 4 open; first 2025-06-22, latest 2025-08-29 (PSI/EXP/000037)
- Invoice descriptions: "Barramundi Skin On Fillets 300-400g - 5kg ctn - 7377" ×2; "ASC Barramundi Skin On Fillets 300-400g - 5kg ctn - 7377" ×2
- Item master rows: `SKU-0050` "Barramundi Skin On Fillets 300-400g - 5kg ctn - 7377" → Skin On Fillets [status confident, confirmed 2026-11-21]; `SKU-0201` "ASC Barramundi Skin On Fillets 300-400g - 5kg ctn - 7377" → Skin On Fillets [status confident, confirmed 2026-11-21] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: PSI/EXP/000037 2025-08-29 (calculated), PSI/EXP/000050 2025-08-26 (calculated), PSI/EXP/000027 2025-07-31 (calculated), E21371 2025-06-22 (calculated)

### EXPORT009: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 6,400.00 on 3 invoice(s), 3 open; first 2025-07-28, latest 2025-08-29 (PSI/EXP/000037)
- Invoice descriptions: "Barramundi Skin On Fillets 200-300g - 5kg ctn - 7376" ×2; "ASC Barramundi Skin On Fillets 200-300g - 5kg ctn - 7376" ×1
- Item master rows: `SKU-0049` "Barramundi Skin On Fillets 200-300g - 5kg ctn - 7376" → Skin On Fillets [status confident]; `SKU-0200` "ASC Barramundi Skin On Fillets 200-300g - 5kg ctn - 7376" → Skin On Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: PSI/EXP/000037 2025-08-29 (calculated), PSI/EXP/000027 2025-07-31 (calculated), PSI/EXP/000016 2025-07-28 (calculated)

### EXPORT003: Not confirmed

- TIEP item: Skinless Fillets
- Under TIEP Approval 2024/25: Skinless Fillets at 40%
- Under TIEP Approval 2025/26: Skinless Fillets at 41%
- Kg exported: 1,900.00 on 3 invoice(s), 3 open; first 2025-07-30, latest 2025-08-29 (PSI/EXP/000037)
- Invoice descriptions: "Barramundi Skinless Fillets 300-400g - 5kg ctn - 7366" ×2; "ASC Barramundi Skinless Fillets 300-400g - 5kg ctn - 7366" ×1
- Item master rows: `SKU-0197` "ASC Barramundi Skinless Fillets 300-400g - 5kg ctn - 7366" → Skinless Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026); `SKU-0199` "Barramundi Skinless Fillets 300-400g - 5kg ctn - 7366" → Skinless Fillets [status confident] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: PSI/EXP/000037 2025-08-29 (calculated), PSI/EXP/000027 2025-07-31 (calculated), PSI/EXP/000028 2025-07-30 (calculated)

### EXPORT028: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 27.70 on 1 invoice(s), 1 open; first 2025-07-23, latest 2025-07-23 (PSI/EXP/000015)
- Invoice descriptions: "Barramundi Fillets Skin on (NMI SAMPLE)" ×1
- Item master rows: `SKU-0189` "Barramundi Fillets Skin on (NMI SAMPLE)" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: PSI/EXP/000015 2025-07-23 (calculated)

### LOC41: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 1.60 on 1 invoice(s), 1 open; first 2025-07-12, latest 2025-07-12 (PSI/EXP/000012)
- Invoice descriptions: "Barramundi Skin On Protions 400g 6 Kg - Local New" ×1
- Item master rows: `SKU-0183` "Barramundi Skin On Protions 400g 6 Kg - Local New" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026). 400 g skin-on portions
- Invoices: PSI/EXP/000012 2025-07-12 (calculated)

### EXPORT048: Not confirmed

- TIEP item: Skin On Fillets
- Under TIEP Approval 2024/25: Skin On Fillets at 46%
- Under TIEP Approval 2025/26: Skin On Fillets at 48%
- Kg exported: 201.32 on 1 invoice(s), 1 open; first 2025-07-02, latest 2025-07-02 (PSI/EXP/000013)
- Invoice descriptions: "ASC Certified Barramundi Fillets Skin on 300 - 500g" ×1
- Item master rows: `SKU-0177` "ASC Certified Barramundi Fillets Skin on 300 - 500g" → Skin On Fillets [status review] — Added from Export_Sales.xlsx (20 Nov 2026)
- Invoices: PSI/EXP/000013 2025-07-02 (calculated)

### EXPORT052: Not confirmed

- TIEP item: Gilled and Gutted
- Under TIEP Approval 2024/25: Gilled and Gutted at 90%
- Under TIEP Approval 2025/26: Gilled and Gutted at 90%
- Kg exported: 3.19 on 1 invoice(s), 1 open; first 2025-07-02, latest 2025-07-02 (PSI/EXP/000014)
- Invoice descriptions: "ASC Barramundi Whole Round Head on Gutted (1kg – 1.2kg) A&Z" ×3
- Item master rows: `SKU-0178` "ASC Barramundi Whole Round Head on Gutted (1kg – 1.2kg) A&Z" → Gilled and Gutted [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Whole round head-on gutted: treated as gilled and gutted
- Invoices: PSI/EXP/000014 2025-07-02 (calculated)

### Export 070: Confirmed

- TIEP item: Skin On D-Trimmed Fillets 10oz+
- Under TIEP Approval 2024/25: Skin On D-Trimmed Fillets 10oz+ at 40%
- Under TIEP Approval 2025/26: Skin On D-Trimmed Fillets 10oz+ at 45%
- Kg exported: 2,029.83 on 5 invoice(s), 5 open; first 2025-06-01, latest 2025-06-29 (E21373)
- Invoice descriptions: "Ocean Reared Farm Raised Barramundi , fresh fillets 10-14oz Skin-on Scaled 10K Film 1x10lb (Lates Calcarifer)" ×9
- Item master rows: `SKU-0123` "Ocean Reared Farm Raised Barramundi , fresh fillets 10-14oz Skin-on Scaled 10K Film 1x10lb (Lates Calcarifer)" → Skin On D-Trimmed Fillets 10oz+ [status confident, confirmed 2026-11-21]
- Invoices: E21373 2025-06-29 (calculated), E21370 2025-06-22 (calculated), E21369 2025-06-16 (calculated), E21365 2025-06-08 (calculated), E21363 2025-06-01 (calculated)

### B to B 056: Not confirmed

- TIEP item: Skin on CC Portions 170-190
- Under TIEP Approval 2024/25: Skin on CC Portions 170-190 at 32%
- Under TIEP Approval 2025/26: Skin on CC Portions 170-190 at 32%
- Kg exported: 59.30 on 4 invoice(s), 4 open; first 2025-05-30, latest 2025-06-27 (IE91)
- Invoice descriptions: "ASC Skin on Barramundi Center Cut Portion 170-190g" ×7
- Item master rows: `SKU-0002` "ASC Skin on Barramundi Center Cut Portion 170-190g" → Skin on CC Portions 170-190 [status confident]
- Invoices: IE91 2025-06-27 (calculated), IE86 2025-06-20 (calculated), IE83 2025-06-07 (calculated), IE77 2025-05-30 (calculated)

### Export 186: Not confirmed

- TIEP item: Skin on CC Portions 170-190
- Under TIEP Approval 2024/25: Skin on CC Portions 170-190 at 32%
- Under TIEP Approval 2025/26: Skin on CC Portions 170-190 at 32%
- Kg exported: 28.00 on 4 invoice(s), 4 open; first 2025-05-30, latest 2025-06-27 (IE91)
- Invoice descriptions: "Barramundi skin on loins-OP11" ×5
- Item master rows: `SKU-0173` "Barramundi skin on loins-OP11" → Skin on CC Portions 170-190 [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Loins treated as centre-cut portions
- Invoices: IE91 2025-06-27 (calculated), IE86 2025-06-20 (calculated), IE83 2025-06-07 (calculated), IE77 2025-05-30 (calculated)

### Export 185: Not confirmed

- TIEP item: Gilled, Gutted and Scaled
- Under TIEP Approval 2024/25: Gilled, Gutted and Scaled at 88%
- Under TIEP Approval 2025/26: Gilled, Gutted and Scaled at 88%
- Kg exported: 22.10 on 3 invoice(s), 3 open; first 2025-06-07, latest 2025-06-27 (IE91)
- Invoice descriptions: "Barramundi Boatcut filet-OP10" ×4
- Item master rows: `SKU-0175` "Barramundi Boatcut filet-OP10" → Gilled, Gutted and Scaled [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Boat cut: same convention as the item master (GGS)
- Invoices: IE91 2025-06-27 (calculated), IE86 2025-06-20 (calculated), IE83 2025-06-07 (calculated)

### B to B 055: Not confirmed

- TIEP item: Skin On D-Trimmed Fillets 10oz+
- Under TIEP Approval 2024/25: Skin On D-Trimmed Fillets 10oz+ at 40%
- Under TIEP Approval 2025/26: Skin On D-Trimmed Fillets 10oz+ at 45%
- Kg exported: 12.60 on 2 invoice(s), 2 open; first 2025-05-30, latest 2025-06-07 (IE83)
- Invoice descriptions: "ASC Barramundi Fillet D-Trim Skin on 2-300g" ×2
- Item master rows: `SKU-0001` "ASC Barramundi fillet D-Trim Skin on 2-300g" → Skin On D-Trimmed Fillets 10oz+ [status confident]
- Invoices: IE83 2025-06-07 (calculated), IE77 2025-05-30 (calculated)

### Export 184: Not confirmed

- TIEP item: Gilled, Gutted and Scaled
- Under TIEP Approval 2024/25: Gilled, Gutted and Scaled at 88%
- Under TIEP Approval 2025/26: Gilled, Gutted and Scaled at 88%
- Kg exported: 1.20 on 1 invoice(s), 1 open; first 2025-06-07, latest 2025-06-07 (IE83)
- Invoice descriptions: "Barramudni Butterfliedfilet-OP07" ×1
- Item master rows: `SKU-0174` "Barramudni Butterfliedfilet-OP07" → Gilled, Gutted and Scaled [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Butterfly cut: same convention as the item master (GGS)
- Invoices: IE83 2025-06-07 (calculated)

### Export 187: Not confirmed

- TIEP item: Skin on CC Portions 170-190
- Under TIEP Approval 2024/25: Skin on CC Portions 170-190 at 32%
- Under TIEP Approval 2025/26: Skin on CC Portions 170-190 at 32%
- Kg exported: 0.50 on 1 invoice(s), 1 open; first 2025-06-07, latest 2025-06-07 (IE83)
- Invoice descriptions: "Barramundi skinless loins-OP11-1" ×1
- Item master rows: `SKU-0176` "Barramundi skinless loins-OP11-1" → Skin on CC Portions 170-190 [status review] — Added from Export_Sales.xlsx (20 Nov 2026). Skinless loins treated as centre-cut portions
- Invoices: IE83 2025-06-07 (calculated)
