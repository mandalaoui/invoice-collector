const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config.js');
const extract = require('../src/extract.js');
const menu = require('../src/menu.js');

test('explainInvoice names the keyword and line and matches extractInvoice', () => {
  const settings = config.getConfig([]);
  settings.company_name = 'סטודיו דמה לבדיקות בע"מ';
  settings.company_id = '990100091';
  settings.month = '2026-11';
  const text = [
    'קפה הכרמל בע"מ',
    'מע"מ 18.00',
    'סה"כ לתשלום: 118.00',
    'לכבוד',
    'סטודיו דמה לבדיקות בע"מ'
  ].join('\n');
  const explained = extract.explainInvoice(text, settings, { senderName: 'קפה הכרמל' });
  const fields = extract.extractInvoice(text, settings, { senderName: 'קפה הכרמל' });
  assert.deepEqual(explained.fields, fields);
  const byField = {};
  explained.evidence.forEach((row) => {
    byField[row.field] = row;
  });
  assert.equal(byField.total.keyword, 'סה"כ לתשלום');
  assert.equal(byField.total.line.includes('118.00'), true);
  assert.equal(byField.vat_amount.keyword, 'מע"מ');
  assert.equal(byField.vendor_name.keyword, 'business name');
  assert.equal(byField.buyer_name_ok.value, true);
  assert.equal(byField.buyer_name_ok.keyword, 'company_name');
});

test('the debug grid keeps the raw query, each count, and 600 characters of text', () => {
  const text = 'א'.repeat(700);
  const grid = menu.debugGrid({
    build: 'abc123',
    month: '2026-11',
    companyName: 'Buyer Ltd',
    companyId: '990100091',
    searchRaw: 'has:attachment (חשבונית OR invoice)\nsubject:receipt',
    queries: [
      { query: '(has:attachment (חשבונית OR invoice)) after:2026/10/31 before:2026/12/01 -label:invoices-processed', count: 4 },
      { query: '(subject:receipt) after:2026/10/31 before:2026/12/01 -label:invoices-processed', count: 0 }
    ],
    rows: [
      {
        source: 'm1#0',
        sender: 'Vendor <vendor@example.com>',
        text: text,
        stored: { total: 118, vat_amount: 118, vendor_name: '', buyer_name_ok: false },
        evidence: [
          { field: 'total', value: 118, keyword: 'סה"כ', line: 'סה"כ 118' },
          { field: 'vat_amount', value: 118, keyword: 'מע"מ', line: 'מע"מ 118' },
          { field: 'vendor_name', value: '', keyword: '', line: '' },
          { field: 'buyer_name_ok', value: false, keyword: '', line: '' }
        ]
      }
    ]
  });
  assert.deepEqual(grid[0], ['build', 'abc123']);
  assert.deepEqual(grid[4], ['search_queries', 'has:attachment (חשבונית OR invoice)\nsubject:receipt']);
  assert.deepEqual(grid[6], ['query', 'count']);
  assert.equal(grid[7][1], 4);
  assert.equal(grid[8][1], 0);
  const textRow = grid.find((row) => row[0] === 'text');
  assert.equal(textRow[1].length, 600);
  const total = grid.find((row) => row[0] === 'total');
  assert.deepEqual(total, ['total', 118, 118, 'סה"כ', 'סה"כ 118']);
  const vendor = grid.find((row) => row[0] === 'vendor_name');
  assert.equal(vendor[2], '');
  assert.equal(menu.debugTextClip('abc', 600), 'abc');
});
