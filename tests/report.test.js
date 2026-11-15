const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const extract = require('../src/extract.js');
const config = require('../src/config.js');
const report = require('../src/report.js');

const fixturesDir = path.join(__dirname, 'fixtures');
const ocrDir = path.join(fixturesDir, 'ocr-text');
const expected = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'expected.json'), 'utf8'));

function settings() {
  const parsed = config.getConfig([]);
  parsed.month = expected.month;
  parsed.company_name = expected.buyer.name_he + '\n' + expected.buyer.name_en;
  parsed.company_id = expected.buyer.vendor_id;
  return parsed;
}

function stem(file) {
  return file.replace(/\.[^.]+$/, '');
}

function invoiceRows() {
  const parsed = settings();
  return expected.documents.map((doc) => {
    const text = fs.readFileSync(path.join(ocrDir, doc.file + '.txt'), 'utf8');
    const fields = extract.extractInvoice(text, parsed, {
      senderEmail: doc.email.reply_to,
      senderName: doc.email.from_name
    });
    fields.source = 'msg-' + stem(doc.file) + ' ' + stem(doc.file);
    fields.file_link = '';
    fields.status = 'OK';
    return fields;
  });
}

function answerRows() {
  return expected.documents.map((doc) => {
    const row = {
      file: doc.file,
      source: stem(doc.file),
      status: ''
    };
    for (const key of report.ACCURACY_FIELDS) {
      row[key] = doc.fields[key] == null ? '' : doc.fields[key];
    }
    return row;
  });
}

test('ocr text versus expected.json is 100% on every field', () => {
  const reportRows = report.compareInvoicesToAnswerKey(invoiceRows(), answerRows());
  assert.equal(reportRows.pairs, 8);
  assert.equal(reportRows.unmatched, 0);
  assert.equal(reportRows.rows.length, report.ACCURACY_FIELDS.length);
  for (const row of reportRows.rows) {
    assert.equal(row.answer_key_count, 8, row.field);
    assert.equal(row.deterministic_matches, 8, row.field);
    assert.equal(row.match_percent, '100%', row.field);
    assert.equal(row.local_ai_matches, '');
    assert.equal(row.manual_count, 0);
  }
  const grid = report.comparisonGrid(reportRows.rows);
  assert.equal(grid[0][grid[0].length - 1], 'match_percent');
  assert.equal(grid.length, 12);
  assert.equal(grid[1][0], 'vendor_name');
  assert.equal(grid[1][7], '100%');
});

test('one wrong total drops only that field to 87.5%', () => {
  const invoices = invoiceRows();
  invoices[0].total = 1;
  invoices[2].status = 'REVIEW';
  const scored = report.compareInvoicesToAnswerKey(invoices, answerRows());
  const byField = {};
  for (const row of scored.rows) byField[row.field] = row;
  assert.equal(byField.total.deterministic_matches, 7);
  assert.equal(byField.total.match_percent, '87.5%');
  assert.equal(byField.vendor_name.match_percent, '100%');
  assert.equal(byField.total.manual_count, 1);
});

test('a missing invoice is a miss on every field', () => {
  const invoices = invoiceRows().slice(1);
  const scored = report.compareInvoicesToAnswerKey(invoices, answerRows());
  assert.equal(scored.unmatched, 1);
  assert.equal(scored.rows[0].deterministic_matches, 7);
  assert.equal(scored.rows[0].match_percent, '87.5%');
});

test('vendor id and document number pair rows that have no file stem', () => {
  const invoices = [{
    vendor_id: '990100018',
    doc_number: '10482',
    total: 1003,
    doc_date: '2026-11-02',
    source: 'only-a-message-id'
  }];
  const answers = [{
    vendor_id: '990100018',
    doc_number: '10482',
    total: '1,003.00',
    doc_date: '02/11/2026'
  }];
  const scored = report.compareInvoicesToAnswerKey(invoices, answers);
  const byField = {};
  for (const row of scored.rows) byField[row.field] = row;
  assert.equal(scored.unmatched, 0);
  assert.equal(byField.total.match_percent, '100%');
  assert.equal(byField.doc_date.match_percent, '100%');
});

test('an empty answer key writes percents as blank', () => {
  const scored = report.compareInvoicesToAnswerKey(invoiceRows(), []);
  assert.equal(scored.pairs, 0);
  assert.equal(scored.rows[0].match_percent, '');
  assert.equal(scored.rows[0].deterministic_matches, 0);
});
