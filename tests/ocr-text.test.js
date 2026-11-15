const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const extract = require('../src/extract.js');
const config = require('../src/config.js');

const fixturesDir = path.join(__dirname, 'fixtures');
const ocrDir = path.join(fixturesDir, 'ocr-text');
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

test('saved Drive OCR texts match expected.json', () => {
  if (!fs.existsSync(ocrDir)) return;
  const files = fs.readdirSync(ocrDir).filter((name) => name.endsWith('.txt'));
  if (!files.length) return;
  const settings = config.getConfig([]);
  settings.month = expected.month;
  settings.company_name = expected.buyer.name_he + '\n' + expected.buyer.name_en;
  settings.company_id = expected.buyer.vendor_id;
  const byFile = {};
  for (const doc of expected.documents) byFile[doc.file] = doc;
  for (const name of files) {
    const fixture = name.replace(/\.txt$/, '');
    const doc = byFile[fixture];
    assert.ok(doc, name);
    const text = fs.readFileSync(path.join(ocrDir, name), 'utf8');
    const fields = extract.extractInvoice(text, settings, {
      senderEmail: doc.email.reply_to,
      senderName: doc.email.from_name
    });
    for (const key of FIELD_KEYS) {
      assert.equal(fields[key], doc.fields[key], fixture + ' ' + key);
    }
  }
});
