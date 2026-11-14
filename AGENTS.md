# AGENTS.md — Invoice Collector

## What this project is
Monthly job that collects invoices/receipts from a company's business Gmail, saves the original files to Drive, extracts key fields into a Google Sheet, and prepares (never sends) a Gmail draft for the accountant.
Runs inside the client's own Google Workspace. No paid AI. Optional local (offline) OCR/model fallback.

Read `docs/SPEC.md` for behavior, `docs/TASKS.md` for the current task, and `docs/RULES.md` for extraction rules.

## Stack
- Google Apps Script (V8), developed locally and pushed with `clasp`.
- Google Drive API (Advanced Service) for built-in OCR (Hebrew).
- Google Sheets as the database + settings + reports.
- Optional local worker: Python 3.11+, Tesseract (`heb`+`eng`) and/or Ollama (`qwen3-vl:8b`). Runs on an office PC only.

## Iron rules (never break)
1. **No client data leaves Google Workspace or the local office PC.** No external APIs, no cloud AI, no logging of content to third-party services.
2. **Never modify, delete or strip pages from original files.** Copy originals as-is; summaries are separate.
3. **Never send email.** Only create Gmail drafts. A human sends.
4. **No secrets in code.** IDs and settings live in the Settings sheet / Script Properties.
5. **Idempotent runs.** Running twice on the same month must not create duplicates (use Gmail labels + message IDs).

## Code conventions
- Small modules, one responsibility each: `gmail.js`, `drive.js`, `ocr.js`, `extract.js`, `sheet.js`, `report.js`, `draft.js`, `config.js`, `main.js`.
- Pure functions for extraction (input text → fields + confidence) so they are testable without Google services.
- All rules/keywords/vendors read from `Settings` sheet, not hard-coded.
- Every run writes a row to `RunLog` (start, end, counts, errors, mode).
- Handle Apps Script 6-minute limit: process in batches, resume via saved cursor.
- Hebrew text: normalize (RTL marks, quotes ״ ", geresh, spaces) before matching.

## Workflow for each task
1. Read the task in `docs/TASKS.md`. Do only that task.
2. Explain the plan in 3–5 lines before coding.
3. Write code + a test (pure-function tests with sample text fixtures in `tests/fixtures/`).
4. Run tests. Report what passed and what to check manually.
5. Mark the task ✅ in `docs/TASKS.md`. Keep changes small.
6. Add a dev-only Apps Script function `test<TaskName>()` in `src/dev/`. It runs the full manual verification in one run, logs each step, restores any settings it changed, and ends with PASS or FAIL plus details.
7. After the task, commit and git push.

## Do not
- Add dependencies or services without asking.
- Use real client data in fixtures; use anonymized samples.
- Refactor unrelated code.
- Never run `clasp push`. The developer runs `npm run push:dev`.
