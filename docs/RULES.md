# RULES.md — extraction rules (later moved to Settings sheet)

## Normalization (before any match)
- Remove RTL/LTR marks (U+200E, U+200F, U+202A–U+202E).
- Unify quotes: ״ " ” “ → `"`; ׳ ' → `'`. So `סה״כ` = `סה"כ`.
- Collapse whitespace; unify digits; remove thousands separators when parsing (`1,234.50` → 1234.50).
- OCR may reverse Hebrew word order — match keywords in both orders where cheap.

## Document type
| Type | Keywords |
|---|---|
| tax_invoice_receipt | חשבונית מס קבלה, חשבונית מס/קבלה, tax invoice receipt |
| tax_invoice | חשבונית מס, tax invoice |
| receipt | קבלה, receipt |
| credit_note | חשבונית זיכוי, זיכוי, credit note |
| not_invoice | הצעת מחיר, quote, newsletter, promotion, "הזמנה התקבלה" without amounts |
Check longest match first.

## Total
- Keywords (priority order): `סה"כ לתשלום`, `סכום לתשלום`, `סה"כ כולל מע"מ`, `סה"כ`, `Total due`, `Amount due`, `Total`.
- Take the number on the same line or the next line. If several, prefer the largest near the keyword.

## Before VAT / VAT
- Before: `סה"כ לפני מע"מ`, `סכום לפני מע"מ`, `Subtotal`.
- VAT: `מע"מ`, `VAT` (+ optional `18%`).
- Check: total ≈ before × 1.18 (±1 ₪). If only total exists → before = total / 1.18 (mark as estimated).

## Date
- Patterns: `DD/MM/YYYY`, `DD.MM.YYYY`, `DD-MM-YY`, `YYYY-MM-DD`. Israeli order = day first.
- Prefer near `תאריך`, `תאריך הפקה`, `Date`, `Invoice date`. Must fall in or near the target month.

## Document number
- Near `מס' חשבונית`, `חשבונית מס מספר`, `מספר מסמך`, `Invoice #`, `Invoice No`.

## Vendor ID
- `ח.פ`, `ע.מ`, `עוסק מורשה`, `ח"פ` followed by 9 digits. Exclude the company's own ID (from Settings).

## Allocation number
- Near `מספר הקצאה`, `מס' הקצאה`. Threshold from Settings (confirm with accountant).

## Vendor name
1. Vendor whitelist by sender email/domain (Settings).
2. Else first strong line at top of doc.
3. Else sender display name.

## Confidence (simple scoring)
+0.25 total found, +0.2 date in month, +0.15 doc_number, +0.15 vendor_id, +0.15 VAT check passes, +0.1 known vendor.
< 0.7 → REVIEW.

## Vendor-specific rules
Add per vendor when a pattern repeats (e.g. specific layout, fixed keyword). Format:
| vendor | sender | rule | example |
|---|---|---|---|
