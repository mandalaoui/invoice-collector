const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixturesDir = path.join(__dirname, 'fixtures');
const expected = JSON.parse(
  fs.readFileSync(path.join(fixturesDir, 'expected.json'), 'utf8')
);

const FIELD_KEYS = [
  'vendor_name',
  'vendor_id',
  'doc_type',
  'doc_number',
  'doc_date',
  'amount_before_vat',
  'vat_amount',
  'total',
  'currency',
  'allocation_number',
  'buyer_name_ok'
];

test('expected.json is the answer key for eight fictional fixtures', () => {
  assert.equal(expected.month, '2026-11');
  assert.equal(expected.documents.length, 8);
  assert.match(expected.buyer.vendor_id, /^\d{9}$/);
  const files = expected.documents.map((doc) => doc.file);
  assert.equal(new Set(files).size, files.length);

  const kinds = expected.documents.map((doc) => doc.kind).sort();
  assert.deepEqual(kinds, [
    'html',
    'image',
    'pdf_scan',
    'pdf_text',
    'pdf_text',
    'pdf_text',
    'pdf_text',
    'pdf_text'
  ]);

  for (const doc of expected.documents) {
    assert.ok(fs.existsSync(path.join(fixturesDir, doc.file)), doc.file);
    assert.ok(doc.email.subject);
    assert.ok(doc.email.reply_to.endsWith('.example'));
    for (const key of FIELD_KEYS) {
      assert.ok(Object.prototype.hasOwnProperty.call(doc.fields, key), key);
    }
    const fields = doc.fields;
    if (fields.vendor_id !== null) {
      assert.match(fields.vendor_id, /^\d{9}$/);
      assert.notEqual(fields.vendor_id, expected.buyer.vendor_id);
    }
    if (fields.amount_before_vat !== null && fields.vat_amount !== null) {
      assert.equal(fields.amount_before_vat + fields.vat_amount, fields.total);
    }
    if (Math.abs(fields.total) > 5000) {
      assert.ok(fields.allocation_number);
    }
  }

  const byFile = Object.fromEntries(expected.documents.map((doc) => [doc.file, doc]));
  assert.equal(byFile['01-tax-invoice-receipt-he.pdf'].fields.doc_type, 'tax_invoice_receipt');
  assert.equal(byFile['02-saas-invoice-en.pdf'].fields.currency, 'USD');
  assert.equal(byFile['02-saas-invoice-en.pdf'].fields.total, 49);
  assert.equal(byFile['03-tax-invoice-allocation-he.pdf'].fields.total, 10030);
  assert.equal(byFile['04-scanned-receipt-he.pdf'].kind, 'pdf_scan');
  assert.equal(byFile['04-scanned-receipt-he.pdf'].fields.amount_before_vat, null);
  assert.equal(byFile['05-photo-receipt.jpg'].kind, 'image');
  assert.equal(byFile['06-email-body-invoice.html'].kind, 'html');
  assert.equal(byFile['07-credit-note-he.pdf'].fields.doc_type, 'credit_note');
  assert.equal(byFile['07-credit-note-he.pdf'].fields.total, -295);
  assert.equal(byFile['08-quote-not-invoice-he.pdf'].fields.doc_type, 'not_invoice');
});
