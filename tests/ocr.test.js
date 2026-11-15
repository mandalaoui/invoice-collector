const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ocr = require('../src/ocr.js');

const fixturesDir = path.join(__dirname, 'fixtures');
const expected = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'expected.json'), 'utf8'));

function readFixture(name) {
  return fs.readFileSync(path.join(fixturesDir, name));
}

function compactNumber(value) {
  return String(Math.abs(value)).replace(/\.0+$/, '');
}

test('text-layer PDFs and the html fixture return their own text', () => {
  for (const doc of expected.documents) {
    const bytes = readFixture(doc.file);
    const read = ocr.readDocumentText({
      name: doc.file,
      bytes: bytes,
      html: doc.kind === 'html' ? bytes.toString('utf8') : undefined
    });
    if (doc.kind === 'pdf_text' || doc.kind === 'html') {
      assert.equal(read.source, doc.kind === 'html' ? 'html' : 'text-layer', doc.file);
      assert.equal(ocr.textLayerIsUsable(read.text), true, doc.file);
      const compact = read.text.replace(/[,\s]/g, '');
      assert.ok(read.text.includes(doc.fields.doc_number), doc.file + ' number');
      assert.ok(compact.includes(compactNumber(doc.fields.total)), doc.file + ' total');
    }
  }
});

test('a scanned PDF and a photo have no text layer and use OCR', () => {
  const scan = ocr.readDocumentText({
    name: '04-scanned-receipt-he.pdf',
    bytes: readFixture('04-scanned-receipt-he.pdf')
  });
  assert.equal(scan.source, 'empty');
  assert.equal(ocr.textLayerIsUsable(scan.text), false);

  const photo = ocr.readDocumentText({
    name: '05-photo-receipt.jpg',
    mime: 'image/jpeg',
    bytes: readFixture('05-photo-receipt.jpg'),
    ocr: function () {
      return 'קבלה 3188 סה"כ 118.00';
    }
  });
  assert.equal(photo.source, 'ocr');
  assert.match(photo.text, /3188/);

  const scannedOcr = ocr.readDocumentText({
    name: '04-scanned-receipt-he.pdf',
    bytes: readFixture('04-scanned-receipt-he.pdf'),
    ocr: function () {
      return 'מאפיית הגפן קבלה 5521 סה"כ 186.00';
    }
  });
  assert.equal(scannedOcr.source, 'ocr');
  assert.match(scannedOcr.text, /186/);
});

test('a usable text layer is not sent to OCR', () => {
  let called = false;
  const read = ocr.readDocumentText({
    name: '02-saas-invoice-en.pdf',
    bytes: readFixture('02-saas-invoice-en.pdf'),
    ocr: function () {
      called = true;
      return 'should not run';
    }
  });
  assert.equal(called, false);
  assert.equal(read.source, 'text-layer');
  assert.match(read.text, /INV-44190/);
  assert.match(read.text, /Total due/);
});
