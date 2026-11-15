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

test('statuses flag bad samples and leave consistent tax invoices OK', () => {
  const settings = fixtureConfig();
  const byFile = {};
  for (const doc of expected.documents) {
    const fields = extract.extractInvoice(textFor(doc), settings, {
      senderEmail: doc.email.reply_to,
      senderName: doc.email.from_name
    });
    byFile[doc.file] = extract.classifyInvoice(fields, settings, []);
  }
  assert.equal(byFile['01-tax-invoice-receipt-he.pdf'].status, 'OK');
  assert.equal(byFile['03-tax-invoice-allocation-he.pdf'].status, 'OK');
  assert.equal(byFile['06-email-body-invoice.html'].status, 'OK');
  assert.equal(byFile['07-credit-note-he.pdf'].status, 'OK');
  assert.equal(byFile['08-quote-not-invoice-he.pdf'].status, 'NOT_INVOICE');
  for (const file of ['02-saas-invoice-en.pdf', '04-scanned-receipt-he.pdf', '05-photo-receipt.jpg']) {
    assert.equal(byFile[file].status, 'REVIEW', file);
    assert.ok(byFile[file].reasons.length > 0, file);
  }
  assert.ok(byFile['02-saas-invoice-en.pdf'].reasons.some((reason) => /rate/i.test(reason)));
  assert.ok(byFile['05-photo-receipt.jpg'].reasons.some((reason) => /VAT deduction/i.test(reason)));

  const coffee = extract.extractInvoice(textFor(expected.documents[0]), settings, {});
  const duplicate = extract.classifyInvoice(coffee, settings, [coffee]);
  assert.equal(duplicate.status, 'DUPLICATE');
  assert.match(duplicate.reasons[0], /vendor id/i);

  const broken = extract.classifyInvoice(
    {
      doc_type: 'tax_invoice',
      vendor_id: '990100018',
      doc_number: '1',
      doc_date: '02/11/2026',
      amount_before_vat: 100,
      vat_amount: 18,
      total: 200,
      confidence: 0.9,
      allocation_number: null
    },
    Object.assign({}, settings, { allocation_threshold: 50 }),
    []
  );
  assert.equal(broken.status, 'REVIEW');
  assert.ok(broken.reasons.some((reason) => /total does not equal/i.test(reason)));
  assert.ok(broken.reasons.some((reason) => /allocation/i.test(reason)));
});

test('a quote number of letters, digits, and a dash is kept', () => {
  const settings = fixtureConfig();
  const nearTitle = extract.extractInvoice(
    ['הצעת מחיר', 'ציוד דמה בע"מ', 'Q-17'].join('\n'),
    settings,
    {}
  );
  assert.equal(nearTitle.doc_number, 'Q-17');
  const sameLine = extract.extractInvoice('מספר: Q-17\nסה"כ לתשלום: 4,248.00', settings, {});
  assert.equal(sameLine.doc_number, 'Q-17');
  const quote = extract.extractInvoice('Quote Q-17\nTotal due: 100', settings, {});
  assert.equal(quote.doc_number, 'Q-17');

  const besideIds = extract.extractInvoice(
    [
      'הצעת מחיר',
      'ציוד דמה בע"מ',
      'ח.פ 990100067',
      'לכבוד',
      'סטודיו דמה לבדיקות בע"מ',
      'ח.פ 990100091',
      'Q-17'
    ].join('\n'),
    settings,
    {}
  );
  assert.equal(besideIds.doc_number, 'Q-17');
  assert.notEqual(besideIds.doc_number, '99010009');
});

test('Hebrew quotes and מס׳ normalize before matching', () => {
  assert.equal(extract.normalizeExtractText('מס׳ 10482'), 'מספר 10482');
  assert.equal(extract.normalizeExtractText('סה״כ'), 'סה"כ');
});
