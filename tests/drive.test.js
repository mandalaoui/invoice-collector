const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const drive = require('../src/drive.js');
const fixtures = require('../src/dev/sendTestFixtures.js');

const subjects = fixtures.TEST_FIXTURE_MESSAGES.map((message) => message.subject);

function listed(indexes, extra) {
  const messages = indexes.map((index, nth) => ({
    id: 'm' + index,
    subject: subjects[index],
    date: '2026-11-' + String(index + 1).padStart(2, '0'),
    from: 'me'
  }));
  return extra ? messages.concat(extra) : messages;
}

test('file names follow YYYY-MM-DD_vendor_originalname', () => {
  assert.equal(
    drive.buildInvoiceFileName('2026-11-03', 'Northwind Ledger', '02-saas-invoice-en.pdf'),
    '2026-11-03_Northwind_Ledger_02-saas-invoice-en.pdf'
  );
  assert.equal(
    drive.buildInvoiceFileName('2026-11-02', 'קפה הכרמל', '01-tax-invoice-receipt-he.pdf'),
    '2026-11-02_קפה_הכרמל_01-tax-invoice-receipt-he.pdf'
  );
  assert.equal(
    drive.buildInvoiceFileName('2026-11-01', 'נט/גדר', '06-email-body-invoice.pdf'),
    '2026-11-01_נט_גדר_06-email-body-invoice.pdf'
  );
  assert.throws(() => drive.buildInvoiceFileName('02/11/2026', 'Cafe', 'a.pdf'), /YYYY-MM-DD/);
});

test('a client message with three pdfs is saved without a fixture subject list', () => {
  const message = {
    id: 'm-hi',
    threadId: 't-hi',
    subject: 'היי',
    from: 'Accounts <accounts@vendor.example>',
    dateYmd: '2026-11-16',
    attachments: [
      { index: 0, name: 'one.pdf', mime: 'application/pdf' },
      { index: 1, name: 'two.pdf', mime: 'application/pdf' },
      { index: 2, name: 'three.pdf', mime: 'application/pdf' }
    ]
  };
  const plans = drive.planClientSaves([message]);
  assert.equal(plans.length, 3);
  assert.deepEqual(
    plans.map((plan) => plan.attachmentName),
    ['one.pdf', 'two.pdf', 'three.pdf']
  );
  assert.equal(plans[0].vendor, 'Accounts');
  assert.equal(plans[0].date, '2026-11-16');
  assert.equal(plans[0].subject, 'היי');
  const capped = drive.limitCollectPlans(plans, { documentLimit: 3 });
  assert.equal(capped.length, 3);
  assert.deepEqual(drive.clientThreadsToLabel(plans, capped), ['t-hi']);
  assert.deepEqual(drive.clientThreadsToLabel(plans, plans.slice(0, 2)), []);
});

test('plans copy the eight fixtures and render only the email body as PDF', () => {
  const plans = drive.planFixtureSaves(
    listed([7, 0, 5], { id: 'other', subject: 'Your bank statement', date: '2026-11-02' }),
    fixtures.TEST_FIXTURE_MESSAGES
  );
  assert.deepEqual(plans.map((plan) => plan.order), [0, 5, 7]);
  assert.equal(plans[0].source, 'attachment');
  assert.equal(plans[0].attachmentName, '01-tax-invoice-receipt-he.pdf');
  assert.equal(plans[1].source, 'body-pdf');
  assert.equal(plans[1].originalName, '06-email-body-invoice.pdf');
  assert.equal(plans[1].attachmentName, '');
  assert.equal(plans[1].vendor, 'נט-גדר שירותי ענן');
  assert.equal(plans.some((plan) => plan.subject === 'Your bank statement'), false);

  const again = drive.planFixtureSaves(
    listed([0]).concat(listed([0])),
    fixtures.TEST_FIXTURE_MESSAGES
  );
  assert.equal(again.length, 1);
  assert.throws(() => drive.planFixtureSaves([], fixtures.TEST_FIXTURE_MESSAGES.slice(0, 7)), /8 fixture/);
});

test('attachment bytes must match and a PDF is recognized', () => {
  const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d];
  const same = [0x25, 0x50, 0x44, 0x46, 0x2d];
  assert.equal(drive.bytesEqual(pdf, same), true);
  assert.equal(drive.bytesEqual(pdf, [0x25, 0x50, 0x44, 0x46]), false);
  assert.equal(drive.bytesEqual(pdf, [0x25, 0x50, 0x44, 0x46, 0x00]), false);
  assert.equal(drive.isPdfBytes(pdf), true);
  assert.equal(drive.isPdfBytes([0x3c, 0x21, 0x44, 0x4f, 0x43]), false);
  assert.equal(drive.bytesEqual([255], [-1]), true);
});

test('an existing identical file is kept and a different file is a conflict', () => {
  const bytes = [1, 2, 3, 4];
  assert.deepEqual(
    drive.decideFileWrite([{ name: 'a.pdf', id: 'f1', bytes: bytes }], 'a.pdf', { bytes: bytes }),
    { action: 'keep', id: 'f1' }
  );
  assert.equal(
    drive.decideFileWrite([{ name: 'a.pdf', id: 'f1', bytes: [9] }], 'a.pdf', { bytes: bytes }).action,
    'conflict'
  );
  assert.equal(
    drive.decideFileWrite([], 'a.pdf', { bytes: bytes }).action,
    'create'
  );
  const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d];
  assert.equal(
    drive.decideFileWrite([{ name: 'body.pdf', id: 'p1', bytes: pdf }], 'body.pdf', { mustBePdf: true }).action,
    'keep'
  );
  assert.equal(
    drive.decideFileWrite(
      [{ name: 'body.pdf', id: 'p1', bytes: [1, 2, 3, 4, 5] }],
      'body.pdf',
      { mustBePdf: true }
    ).action,
    'conflict'
  );
});

test('the month folder is Invoices/2026-11', () => {
  assert.deepEqual(drive.chooseSaveFolder(null, '2026-11'), {
    action: 'create',
    parentName: 'Invoices',
    monthName: '2026-11'
  });
  assert.deepEqual(drive.chooseSaveFolder({ id: 'abc', name: '2026-11' }, '2026-11'), {
    action: 'use',
    id: 'abc'
  });
  assert.equal(drive.chooseSaveFolder({ id: 'abc', name: 'Invoices' }, '2026-11').action, 'reject');
});

test('fixture file counts skip the merged pdf and the test-run pdf', () => {
  assert.equal(
    drive.countFixtureMonthFiles([
      '2026-11-02_קפה_הכרמל_01-tax-invoice-receipt-he.pdf',
      '2026-11_merged.pdf',
      '__test_run_2026-11.pdf',
      '2026-11-03_Northwind_Ledger_02-saas-invoice-en.pdf'
    ]),
    2
  );
});

test('copy mime keeps PDF and JPEG and does not invent a conversion', () => {
  assert.equal(drive.copyMime('application/pdf', '01-tax-invoice-receipt-he.pdf'), 'application/pdf');
  assert.equal(drive.copyMime('image/jpeg', '05-photo-receipt.jpg'), 'image/jpeg');
  assert.equal(drive.copyMime('application/octet-stream', '05-photo-receipt.jpg'), 'image/jpeg');
  assert.equal(drive.mimeForFileName('06-email-body-invoice.pdf'), 'application/pdf');
});

test('the dev save uses the fixture list and does not search the mailbox', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'dev', 'saveTestFixtures.js'), 'utf8');
  assert.match(source, /listTestFixtureMessages\(/);
  assert.equal(source.includes('GmailApp.search'), false);
  assert.equal(source.includes('has:attachment'), false);
  assert.match(source, /2026-11/);
});
