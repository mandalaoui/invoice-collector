const test = require('node:test');
const assert = require('node:assert/strict');
const phase = require('../src/dev/testInvoices.js');

test('a failed file is REVIEW and the other files are still read', () => {
  const rows = phase.readFixtureFiles(
    [{ fixture: 'a.pdf' }, { fixture: 'b.pdf' }, { fixture: 'c.pdf' }],
    (file) => {
      if (file.fixture === 'b.pdf') throw new Error('OCR is not supported for files of type application/vnd.google-apps.document');
      return { file: file.fixture, status: 'OK' };
    }
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].status, 'OK');
  assert.equal(rows[1].status, 'REVIEW');
  assert.deepEqual(rows[1].reasons, [
    'OCR is not supported for files of type application/vnd.google-apps.document'
  ]);
  assert.equal(rows[2].status, 'OK');
  assert.equal(rows[2].file, 'c.pdf');
});

test('each fixture is listed with its Drive name and mime type', () => {
  const maps = phase.mapFixturesToDriveFiles(
    [
      { file: '06-email-body-invoice.html' },
      { file: '05-photo-receipt.jpg' },
      { file: '01-tax-invoice-receipt-he.pdf' }
    ],
    [
      { name: 'invoice-collector-text', mimeType: 'application/vnd.google-apps.document' },
      { name: '2026-11-01_vendor_06-email-body-invoice.pdf', mimeType: 'application/pdf' },
      {
        name: '2026-11-01_vendor_06-email-body-invoice',
        mimeType: 'application/vnd.google-apps.document'
      },
      { name: '2026-11-08_vendor_05-photo-receipt.jpg', mimeType: 'image/jpeg' },
      { name: '2026-11-02_vendor_01-tax-invoice-receipt-he.pdf', mimeType: 'application/pdf' }
    ]
  );
  assert.deepEqual(maps, [
    {
      fixture: '06-email-body-invoice.html',
      name: '2026-11-01_vendor_06-email-body-invoice.pdf',
      mimeType: 'application/pdf'
    },
    {
      fixture: '05-photo-receipt.jpg',
      name: '2026-11-08_vendor_05-photo-receipt.jpg',
      mimeType: 'image/jpeg'
    },
    {
      fixture: '01-tax-invoice-receipt-he.pdf',
      name: '2026-11-02_vendor_01-tax-invoice-receipt-he.pdf',
      mimeType: 'application/pdf'
    }
  ]);
  assert.equal(
    phase.formatFixtureDriveFile_(maps[0]),
    '06-email-body-invoice.html\t2026-11-01_vendor_06-email-body-invoice.pdf\tapplication/pdf'
  );
});

test('testPhase2 clears only the eight fixture rows', () => {
  const values = [
    ['vendor_name', 'source'],
    ['real vendor', 'live-msg 99-client-invoice'],
    ['photo', 'm5 05-photo-receipt'],
    ['quote', 'm8 08-quote-not-invoice-he'],
    ['tax', 'm1 01-tax-invoice-receipt-he']
  ];
  assert.deepEqual(
    phase.fixtureSheetRowsToClear_(values, 1, [
      { file: '05-photo-receipt.jpg' },
      { file: '08-quote-not-invoice-he.pdf' },
      { file: '01-tax-invoice-receipt-he.pdf' },
      { file: '02-saas-invoice-en.pdf' }
    ]),
    [5, 4, 3]
  );
});

test('phase 2 passes at 80% only when every miss is REVIEW', () => {
  assert.equal(phase.phase2Passes_(71, 88, ['REVIEW', 'REVIEW', 'REVIEW']), true);
  assert.equal(phase.phase2Passes_(88, 88, []), true);
  assert.equal(phase.phase2Passes_(70, 88, ['REVIEW']), false);
  assert.equal(phase.phase2Passes_(80, 88, ['OK']), false);
  assert.equal(phase.phase2Passes_(80, 88, ['NOT_INVOICE']), false);
});
