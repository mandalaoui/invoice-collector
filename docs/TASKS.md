# TASKS.md — do one task per session, mark ✅ when done

## Phase 0 — Setup
- [x] 0.1 Create repo structure (`src/`, `tests/fixtures/`, `worker/`), `clasp` project bound to a test Google account. Done when: `clasp push` works. ✅
- [x] 0.2 Create the Sheet with tabs `Invoices, RunLog, Comparison, AnswerKey, Settings` + `config.js` that reads Settings. Done when: `getConfig()` returns all keys. ✅
- [x] 0.3 Test data: 8 fictional fixtures in `tests/fixtures/` plus `expected.json`. Regenerate with `python scripts/generate_fixtures.py`. On the test account, `npm run push:dev` then run `sendTestFixtures`. ✅

## Phase 1 — Pipeline skeleton (no extraction yet)
- [x] 1.1 `gmail.js`: search by month + queries, skip processed. Done when: lists test messages. ✅
- [x] 1.2 `drive.js`: save originals to `Invoices/YYYY-MM/` with naming rule; email body → PDF. Done when: all test files appear, unchanged. ✅
- [x] 1.3 Labels + idempotency. Done when: second run creates 0 new files. ✅
- [x] 1.4 `RunLog` + batching for the 6-minute limit. Done when: run logs counts and resumes. ✅

## Phase 2 — Text + extraction
- [x] 2.1 `ocr.js`: text layer first, Drive OCR fallback (Hebrew). Done when: text returned for all fixture types. ✅
- [x] 2.2 `extract.js` (pure): total, date, doc_number, vendor_id, VAT, doc_type, allocation_number + confidence. Done when: unit tests pass on fixtures. ✅
- [x] 2.3 Validation rules + statuses. Done when: bad samples get REVIEW with a reason. ✅
- [x] 2.4 Write rows to `Invoices`. Done when: sheet filled for test month. ✅

## Phase 3 — Real month (tuning)
- [ ] 3.1 Fill `AnswerKey` manually for last month.
- [x] 3.2 Accuracy report: compare `Invoices` vs `AnswerKey` per field. Done when: % per field shown. ✅
- [ ] 3.3 Improve rules in `RULES.md`/Settings until MVP criteria met.

## Phase 4 — Output
- [x] 4.1 Monthly summary + merged PDF (copies only). ✅
- [x] 4.2 Gmail draft to accountant (never send). ✅
- [x] 4.3 Monthly time trigger + error email to owner only. ✅

## Phase 5 — Local AI mode (optional)
- [ ] 5.1 Export REVIEW docs to `queue/`.
- [ ] 5.2 `worker/` Python: pull queue, Tesseract/Ollama Qwen3-VL extract JSON, write back + tokens.
- [ ] 5.3 `compare` mode + `Comparison` sheet (accuracy, time, tokens, manual work).

## Phase 6 — First install
- [x] 6.1 `install()`: sheet tabs, Settings defaults, Gmail labels, Drive folder. Idempotent. Asks only for owner and accountant emails. ✅
- [x] 6.2 Sheet menu: Install / Run this month / Test run (draft to me) / trigger on / off. Test run is a limited batch and never sends. ✅
- [x] 6.3 `docs/INSTALL.md` for a Workspace user, including admin checks and the Advanced Drive service. ✅
- [x] 6.4 Production `clasp push` excludes `src/dev`. `testPhase6` covers the menu, a second install, and a self-addressed draft. ✅
