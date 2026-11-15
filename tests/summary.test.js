const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const report = require('../src/report.js');

const fixturesDir = path.join(__dirname, 'fixtures');
const expected = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'expected.json'), 'utf8'));

function rowsFromExpected() {
  return expected.documents.map((doc, index) => ({
    file: doc.file,
    doc_date: doc.fields.doc_date,
    total: doc.fields.total,
    vat_amount: doc.fields.vat_amount,
    currency: doc.fields.currency,
    status: doc.fields.doc_type === 'not_invoice' ? 'NOT_INVOICE' : 'OK',
    file_link: 'https://drive.google.com/file/d/file' + index + 'abcdefghij/view'
  }));
}

test('monthly totals skip NOT_INVOICE and keep status counts', () => {
  const rows = rowsFromExpected();
  rows.push({
    doc_date: '12/11/2026',
    total: 10,
    vat_amount: 1.8,
    currency: 'ILS',
    status: 'DUPLICATE',
    file_link: 'https://drive.google.com/file/d/duplicateabcdefghij/view'
  });
  rows.push({
    doc_date: '02/10/2026',
    total: 999,
    vat_amount: 0,
    currency: 'ILS',
    status: 'OK',
    file_link: 'https://drive.google.com/file/d/october0abcdefghij/view'
  });
  const monthRows = report.rowsForMonth(rows, '2026-11');
  assert.equal(monthRows.some((row) => row.total === 999), false);
  const summary = report.summarizeMonth(monthRows);
  assert.equal(summary.byCurrency.ILS.total, 12812);
  assert.equal(summary.byCurrency.ILS.vat, 1926);
  assert.equal(summary.byCurrency.USD.total, 49);
  assert.equal(summary.byCurrency.USD.vat, 0);
  assert.equal(summary.byStatus.NOT_INVOICE, 1);
  assert.equal(summary.byStatus.DUPLICATE, 1);
  assert.equal(summary.included.length, 7);
  assert.equal(summary.excluded.length, 2);
  const files = report.selectMergeFiles(monthRows);
  assert.equal(files.length, 7);
  assert.equal(files.some((file) => file.id === 'duplicateabcdefghij'), false);
  const quote = files.find((file) => file.id === 'file7abcdefghij');
  assert.equal(quote, undefined);
  const grid = report.summaryGrid(summary, '2026-11');
  assert.equal(grid[1][1], '2026-11');
  assert.ok(grid.some((row) => row[0] === 'total_ILS' && row[1] === 12812));
  assert.ok(grid.some((row) => row[0] === 'status_DUPLICATE' && row[1] === 1));
});

test('an undated row stays in the month and a second summary replaces the first', () => {
  const rows = report.rowsForMonth([
    { doc_date: '', total: 5, vat_amount: 0, currency: 'ILS', status: 'REVIEW' }
  ], '2026-11');
  assert.equal(rows.length, 1);
  const summary = report.summarizeMonth(rows);
  const once = report.withMonthlySummary([['field', 'match_percent'], ['total', '100%']], summary, '2026-11');
  const twice = report.withMonthlySummary(once, summary, '2026-11');
  const metrics = twice.filter((row) => row[0] === 'metric');
  assert.equal(metrics.length, 1);
  assert.equal(twice[0][0], 'field');
  assert.equal(report.mergedPdfName('2026-11'), '2026-11_merged.pdf');
});

test('merged pdf is built from copies of the fixture bytes', () => {
  const names = [
    '01-tax-invoice-receipt-he.pdf',
    '02-saas-invoice-en.pdf',
    '03-tax-invoice-allocation-he.pdf',
    '04-scanned-receipt-he.pdf',
    '07-credit-note-he.pdf',
    '08-quote-not-invoice-he.pdf'
  ];
  const originals = names.map((name) => fs.readFileSync(path.join(fixturesDir, name)));
  const before = originals.map((bytes) => Buffer.from(bytes));
  const jpeg = fs.readFileSync(path.join(fixturesDir, '05-photo-receipt.jpg'));
  const jpegPdf = Buffer.from(report.jpegToPdfBytes(jpeg));
  assert.equal(report.pdfPageCount(jpegPdf), 1);
  const merged = Buffer.from(report.mergePdfBytes(originals.concat([jpegPdf])));
  assert.equal(report.pdfPageCount(merged), names.length + 1);
  originals.forEach((bytes, index) => {
    assert.deepEqual(bytes, before[index]);
  });
  assert.equal(report.pdfPageCount(originals[0]), 1);
});
