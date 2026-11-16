const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config.js');
const gmail = require('../src/gmail.js');
const drive = require('../src/drive.js');
const extract = require('../src/extract.js');
const sheet = require('../src/sheet.js');
const report = require('../src/report.js');

const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];

test('default searches add Hebrew forms and billing words inside the month window', () => {
  const lines = config.defaultSearchQueriesValue().split('\n');
  assert.equal(lines.length, 3);
  const terms = [
    'החשבונית',
    'חשבוניתך',
    'הקבלה',
    'קבלתך',
    'לחשבונית',
    'billing',
    'subscription',
    'renews',
    'payment',
    '"order confirmation"',
    'הזמנה',
    'תשלום'
  ];
  terms.forEach((term) => {
    assert.equal(lines[0].includes(term), true, term);
    assert.equal(lines[1].includes(term), true, term);
  });
  assert.equal(lines[0].startsWith('has:attachment '), true);
  assert.equal(lines[1].includes('has:attachment'), false);
  assert.equal(lines[1].includes('"total due"'), true);
  assert.equal(lines[2], 'has:attachment (filename:pdf OR filename:jpg OR filename:png)');
  const plan = gmail.buildCollectQueries({
    month: '2026-11',
    today: '2026-11-16',
    processed_label: 'invoices/processed',
    search_queries: lines,
    vendor_whitelist: []
  });
  assert.equal(plan.queries.length, 3);
  plan.queries.forEach((query) => {
    assert.match(query, /after:2026\/10\/31 before:2026\/12\/01 -label:invoices-processed$/);
  });
  assert.equal(plan.queries[1].includes('has:attachment'), false);
  assert.equal(
    gmail.formatRunCoverage(plan.queries.map((_, index) => index + 1), {}, 6),
    'candidates q1=1 q2=2 q3=3; scanned 6; skipped 0'
  );
});

test('the previous three-line default is replaced and a custom query is kept', () => {
  const grid = config.gridForSheet('Settings', [
    ['key', 'value', 'note'],
    ['search_queries', config.PREVIOUS_SEARCH_QUERIES, 'old']
  ]);
  const replaced = grid.find((row) => row[0] === 'search_queries');
  assert.equal(replaced[1].includes('החשבונית'), true);
  assert.equal(replaced[1].includes('billing'), true);
  const custom = config.gridForSheet('Settings', [
    ['key', 'value', 'note'],
    ['search_queries', 'subject:receipt', 'kept']
  ]);
  assert.equal(custom.find((row) => row[0] === 'search_queries')[1], 'subject:receipt');
});

test('html hrefs stay in the body text', () => {
  const text = gmail.textWithLinks('see the invoice', '<a href="https://cdn.example/a.pdf">download</a>');
  assert.equal(text.includes('https://cdn.example/a.pdf'), true);
});

test('a direct PDF link is saved and a login or non-PDF link is a review row', () => {
  const direct = drive.interpretLinkFetch('https://cdn.example/nov.pdf?token=1', {
    status: 200,
    contentType: 'application/pdf',
    bytes: pdf
  });
  assert.equal(direct.action, 'save');
  assert.equal(direct.fileName, 'nov.pdf');
  const login = drive.interpretLinkFetch('https://billing.example/invoice/9', {
    status: 200,
    contentType: 'text/html',
    finalUrl: 'https://billing.example/login',
    bytes: [0x3c],
    bodyText: 'Log in to continue'
  });
  assert.equal(login.action, 'review');
  assert.equal(login.note, 'invoice behind link: https://billing.example/invoice/9');
  const html = drive.interpretLinkFetch('https://vendor.example/receipt/1', {
    status: 403,
    contentType: 'text/html',
    bytes: []
  });
  assert.equal(html.action, 'review');
  assert.equal(html.note, 'invoice behind link: https://vendor.example/receipt/1');
  const message = {
    id: 'm-link',
    threadId: 't-link',
    from: 'Accounts <accounts@vendor.example>',
    dateYmd: '2026-11-04',
    subject: 'invoice',
    body: 'Download https://cdn.example/nov.pdf and https://billing.example/invoice/9'
  };
  const work = drive.buildCollectWork([message], {
    'm-link': {
      'https://cdn.example/nov.pdf': { status: 200, contentType: 'application/pdf', bytes: pdf },
      'https://billing.example/invoice/9': {
        status: 200,
        contentType: 'text/html',
        bodyText: 'password',
        bytes: [0x3c]
      }
    }
  }, extract.noticeWithoutInvoice);
  const saved = work.plans.filter((plan) => plan.source === 'link' && !plan.rowOnly);
  const review = work.plans.filter((plan) => plan.rowOnly);
  assert.equal(saved.length, 1);
  assert.equal(drive.linkSourceKey(saved[0]).endsWith('#link'), true);
  assert.equal(review.length, 1);
  assert.equal(review[0].fields.status, 'REVIEW');
  assert.equal(review[0].fields.notes, 'invoice behind link: https://billing.example/invoice/9');
  assert.equal(review[0].fields.source.endsWith('#link'), true);
});

test('an order or subscription notice with no invoice is NOT_INVOICE and stays out of the merge', () => {
  const notice = extract.noticeWithoutInvoice('Your subscription renews on Monday');
  assert.equal(notice.status, 'NOT_INVOICE');
  assert.equal(notice.notes, 'check for invoice');
  assert.equal(extract.noticeWithoutInvoice('Order confirmation\nחשבונית מס 18'), null);
  const message = {
    id: 'm-sub',
    threadId: 't-sub',
    from: 'Billing <billing@vendor.example>',
    dateYmd: '2026-11-04',
    subject: 'subscription',
    body: 'Your subscription renews tomorrow'
  };
  const work = drive.buildCollectWork([message], {}, extract.noticeWithoutInvoice);
  assert.equal(work.plans.length, 1);
  assert.equal(work.plans[0].rowOnly, true);
  assert.equal(work.plans[0].fields.status, 'NOT_INVOICE');
  assert.equal(work.plans[0].fields.notes, 'check for invoice');
  const summary = report.summarizeMonth([
    work.plans[0].fields,
    { status: 'OK', total: 10, currency: 'ILS', file_link: 'https://drive.google.com/file/d/okfile1234/view', doc_date: '2026-11-04' }
  ]);
  assert.equal(summary.included.length, 1);
  const files = report.selectMergeFiles([
    { status: 'NOT_INVOICE', notes: 'check for invoice', file_link: 'https://drive.google.com/file/d/skipfile12/view', doc_date: '2026-11-04' },
    { status: 'OK', total: 10, file_link: 'https://drive.google.com/file/d/okfile1234/view', doc_date: '2026-11-04' }
  ]);
  assert.deepEqual(files.map((file) => file.id), ['okfile1234']);
});

test('a direct PDF link replaces the email-body copy', () => {
  const message = {
    id: 'm-body',
    threadId: 't-body',
    from: 'Accounts <accounts@vendor.example>',
    dateYmd: '2026-11-04',
    subject: 'חשבונית',
    body: 'סה"כ לתשלום 118\nhttps://cdn.example/nov.pdf'
  };
  const work = drive.buildCollectWork([message], {
    'm-body': {
      'https://cdn.example/nov.pdf': { status: 200, contentType: 'application/pdf', bytes: pdf }
    }
  }, extract.noticeWithoutInvoice);
  assert.equal(work.plans.some((plan) => plan.source === 'email_body'), false);
  assert.equal(work.plans.filter((plan) => plan.source === 'link').length, 1);
});

test('rows for a message are rewritten only when extract_version changes', () => {
  const oldRow = { source: 'm1#0', extract_version: '1', vendor_id: '990100018', doc_number: '10', status: 'OK' };
  const same = { source: 'm1#0', vendor_id: '990100018', doc_number: '10', status: 'REVIEW' };
  assert.deepEqual(sheet.staleMessageIds([oldRow], extract.EXTRACT_VERSION), ['m1']);
  assert.equal(sheet.planInvoiceRows([oldRow], [same], extract.EXTRACT_VERSION).length, 1);
  assert.deepEqual(sheet.sourcesForMessage([oldRow, { source: 'm1#1#link', extract_version: '1' }], 'm1'), ['m1#0', 'm1#1#link']);
  const current = { source: 'm1#0', extract_version: extract.EXTRACT_VERSION, vendor_id: '1', doc_number: '2', status: 'OK' };
  assert.deepEqual(sheet.staleMessageIds([current], extract.EXTRACT_VERSION), []);
  assert.equal(sheet.planInvoiceRows([current], [same], extract.EXTRACT_VERSION).length, 0);
  assert.equal(config.headersFor('Invoices').indexOf('extract_version') > config.headersFor('Invoices').indexOf('notes'), true);
});
