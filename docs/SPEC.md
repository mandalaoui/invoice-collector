# SPEC.md — Invoice Collector

## Goal
Once a month, collect all expense invoices/receipts (20–100) from the business Gmail, keep the originals, and produce:
1. A monthly Drive folder with all original files.
2. A Google Sheet summary for the accountant.
3. One merged PDF (optional, generated from originals, originals untouched).
4. A Gmail draft to the accountant with links (human sends).

## Inputs
- Gmail messages in the target month matching search queries from Settings (e.g. `has:attachment (חשבונית OR קבלה OR invoice OR receipt)`), plus a whitelist of known vendor senders.
- Document types: PDF attachments (most), image attachments (JPG/PNG), invoice in email body (HTML).
- Out of scope v1: invoices behind a login link (flag them as `NEEDS_MANUAL` with the link).

## Flow
1. **Collect**: search Gmail for the month → skip messages already labeled `invoices/processed`.
2. **Save**: copy each attachment as-is to `Invoices/YYYY-MM/`. Email-body invoices → save body as PDF. Filename: `YYYY-MM-DD_vendor_originalname`.
3. **OCR**: PDFs with a text layer → read text directly. Images/scanned PDFs → Drive OCR (Hebrew).
4. **Extract** (deterministic, rules from Settings): fields below + confidence score 0–1.
5. **Classify**: tax invoice / receipt / tax invoice-receipt / credit note / not an invoice (ads, notifications).
6. **Write** a row per document to `Invoices` sheet. Low confidence (< threshold) → status `REVIEW`.
7. **Label** Gmail message `invoices/processed` (or `invoices/review`).
8. **Report**: monthly totals; list of REVIEW / NEEDS_MANUAL items.
9. **Draft**: Gmail draft to accountant with folder link + sheet link. Never sent automatically.

## Fields to extract
| Field | Notes |
|---|---|
| vendor_name | from sender / document header |
| vendor_id | ח.פ / ע.מ (9 digits) |
| doc_type | חשבונית מס / קבלה / חשבונית מס קבלה / זיכוי |
| doc_number | |
| doc_date | DD/MM/YYYY etc. |
| amount_before_vat | |
| vat_amount | VAT is 18% (check: vat ≈ 0.18 × before) |
| total | "סה"כ לתשלום" / "Total" |
| currency | ILS default |
| allocation_number | מספר הקצאה; required for invoices above the legal threshold (confirm with accountant) |
| buyer_name_ok | does the invoice show the company's name/ID |
| source | gmail message id + link |
| file_link | Drive link of the original |
| confidence | 0–1 |
| status | OK / REVIEW / NEEDS_MANUAL / NOT_INVOICE / DUPLICATE |

## Modes (switch in Settings: `mode = deterministic | local_ai | compare`)
- **deterministic** (default): OCR + rules only. Cost 0.
- **local_ai**: low-confidence docs are exported to a `queue/` Drive folder; a local Python worker (Ollama, Qwen3-VL 8B or Tesseract) extracts fields and writes back to the sheet. No cloud.
- **compare**: run both on the same month → `Comparison` sheet: per field accuracy vs answer key, time, tokens (Ollama `prompt_eval_count` + `eval_count`), docs needing manual review.

## Sheets (tabs)
- `Invoices` — one row per document (fields above).
- `RunLog` — one row per run.
- `Comparison` — mode vs mode vs answer key.
- `AnswerKey` — manually labeled real month (ground truth).
- `Settings` — key/value: month, search queries, vendor whitelist, keywords, thresholds, folder IDs, accountant email, mode.

## Validation rules
- total ≈ before + vat (±1 ₪).
- vat ≈ 18% of before (flag otherwise; may be exempt vendor).
- Duplicate = same vendor_id + doc_number.
- Receipt without tax invoice → flag "not valid for VAT deduction alone".
- Above allocation threshold without allocation_number → flag.

## Success criteria
- MVP: ≥ 90% of documents saved correctly, ≥ 80% with correct total + date + vendor, every failure clearly flagged (no silent errors), full run < 10 minutes for 100 docs.
- Final: ≥ 95% correct fields on the answer-key month; accountant accepts the output without rework.

## Security
Private by default: everything inside the client's Workspace; local fallback runs on an office machine. No external API calls with client data.
