const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ocr = require('../src/ocr.js');
const extract = require('../src/extract.js');
const config = require('../src/config.js');

const fixturesDir = path.join(__dirname, 'fixtures');
const expected = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'expected.json'), 'utf8'));

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

// Source text of the two fixtures that have no text layer (scan and photo).
const RECEIPT_TEXT = {
  '04-scanned-receipt-he.pdf': [
    'מאפיית הגפן',
    'קבלה',
    'עוסק מורשה',
    '990100034 ע.מ',
    '5521 :קבלה מספר',
    '06/11/2026 :תאריך',
    'ש"ח186.00 :סה"כ'
  ].join('\n'),
  '05-photo-receipt.jpg': [
    'חנות כלי הבית דני',
    'קבלה',
    'עוסק מורשה',
    '990100042 ע.מ',
    '3188 :קבלה מספר',
    '08/11/2026 :תאריך',
    '100.00 :סה"כ לפני מע"מ',
    '18.00 :18% מע"מ',
    'ש"ח118.00 :סה"כ לתשלום'
  ].join('\n')
};

function fixtureConfig() {
  const settings = config.getConfig([]);
  settings.month = expected.month;
  settings.company_name = expected.buyer.name_he + '\n' + expected.buyer.name_en;
  settings.company_id = expected.buyer.vendor_id;
  return settings;
}

function textFor(doc) {
  if (RECEIPT_TEXT[doc.file]) return RECEIPT_TEXT[doc.file];
  const bytes = fs.readFileSync(path.join(fixturesDir, doc.file));
  if (doc.kind === 'html') return ocr.htmlToText(bytes.toString('utf8'));
  return ocr.extractPdfTextLayer(bytes);
}

test('extractInvoice matches expected.json on all eight fixtures', () => {
  const settings = fixtureConfig();
  assert.equal(expected.documents.length, 8);
  for (const doc of expected.documents) {
    const fields = extract.extractInvoice(textFor(doc), settings, {
      senderEmail: doc.email.reply_to,
      senderName: doc.email.from_name
    });
    for (const key of FIELD_KEYS) {
      assert.equal(fields[key], doc.fields[key], doc.file + ' ' + key);
    }
    assert.equal(typeof fields.confidence, 'number', doc.file);
    assert.ok(fields.confidence >= 0 && fields.confidence <= 1, doc.file);
  }
});

test('Hebrew quotes and מס׳ normalize before matching', () => {
  assert.equal(extract.normalizeExtractText('מס׳ 10482'), 'מספר 10482');
  assert.equal(extract.normalizeExtractText('סה״כ'), 'סה"כ');
});
