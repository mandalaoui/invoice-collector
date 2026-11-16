const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const draft = require('../src/draft.js');

const summary = {
  documents: 8,
  included: [{}, {}, {}],
  byCurrency: { ILS: { total: 12812, vat: 1926 } },
  byStatus: { OK: 5, NOT_INVOICE: 1, REVIEW: 2 }
};

test('the draft carries folder, sheet, and pdf links and is never sent', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'draft.js'), 'utf8');
  assert.equal(source.indexOf('sendEmail'), -1);
  assert.equal(source.indexOf('MailApp'), -1);
  const built = draft.buildAccountantDraft({
    to: 'accountant@example.com',
    month: '2026-11',
    folderUrl: 'https://drive.google.com/drive/folders/folder123',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/sheet123',
    pdfUrl: 'https://drive.google.com/file/d/pdf123/view',
    summary: summary
  });
  assert.equal(built.to, 'accountant@example.com');
  assert.equal(built.subject, 'Invoices 2026-11');
  assert.ok(built.body.indexOf('https://drive.google.com/drive/folders/folder123') >= 0);
  assert.ok(built.body.indexOf('https://docs.google.com/spreadsheets/d/sheet123') >= 0);
  assert.ok(built.body.indexOf('https://drive.google.com/file/d/pdf123/view') >= 0);
  assert.ok(built.body.indexOf('total_ILS: 12812') >= 0);
  assert.ok(built.body.indexOf('status_NOT_INVOICE: 1') >= 0);
  assert.equal(built.body.indexOf('Coverage:'), -1);
  const covered = draft.buildAccountantDraft({
    to: 'accountant@example.com',
    month: '2026-11',
    summary: summary,
    coverage: { scanned: 40, documents: 12 }
  });
  assert.ok(covered.body.indexOf(draft.coverageDraftLine(40, 12)) >= 0);
  assert.throws(() => draft.buildAccountantDraft({ to: '', month: '2026-11' }), /accountant_email/);
});

test('a second run updates the draft instead of creating another', () => {
  const built = draft.buildAccountantDraft({
    to: 'accountant@example.com',
    month: '2026-11',
    folderUrl: 'https://drive.google.com/drive/folders/folder123',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/sheet123',
    pdfUrl: ''
  });
  const existing = [
    { to: 'Other <other@example.com>', subject: 'Invoices 2026-11' },
    { to: 'Accountant <accountant@example.com>', subject: 'Invoices 2026-11' }
  ];
  assert.equal(draft.chooseDraftAction(built, existing).action, 'update');
  assert.equal(draft.chooseDraftAction(built, existing).index, 1);
  assert.equal(draft.chooseDraftAction(built, []).action, 'create');
  const otherMonth = draft.buildAccountantDraft({ to: built.to, month: '2026-10' });
  assert.equal(draft.chooseDraftAction(otherMonth, existing).action, 'create');
});
