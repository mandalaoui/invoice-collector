const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const config = require('../src/config.js');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'settings-rows.json'), 'utf8')
);

test('getConfig returns every Settings key', () => {
  const result = config.getConfig(fixture);
  for (const field of config.SETTINGS_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(result, field.key), field.key);
  }
  assert.equal(result.extra_flag, 'yes');
});

test('getConfig applies types and keeps defaults for missing keys', () => {
  const result = config.getConfig(fixture);
  assert.equal(result.month, '2026-01');
  assert.equal(result.confidence_threshold, 0.5);
  assert.deepEqual(result.search_queries, [
    'has:attachment invoice',
    'from:vendor@example.com'
  ]);
  assert.equal(result.allocation_threshold, null);
  assert.equal(result.vat_rate, 0.18);
  assert.equal(result.amount_tolerance, 1);
  assert.deepEqual(result.keywords_total, ['סה"כ לתשלום']);
  assert.equal(result.mode, 'deterministic');
  assert.equal(result.currency_default, 'ILS');
  assert.deepEqual(result.vendor_whitelist, []);
  assert.equal(result.processed_label, 'invoices/processed');
});

test('empty Settings still returns every default key', () => {
  const result = config.getConfig([]);
  assert.equal(Object.keys(result).length, config.SETTINGS_FIELDS.length);
  assert.equal(result.confidence_threshold, 0.7);
  assert.equal(result.keywords_doc_type[0].startsWith('tax_invoice_receipt'), true);
  assert.ok(result.keywords_vendor_id.indexOf('ח.פ') !== -1);
});

test('duplicate Settings keys use the last value', () => {
  const result = config.getConfig([
    ['key', 'value', 'note'],
    ['mode', 'deterministic', ''],
    ['mode', 'compare', '']
  ]);
  assert.equal(result.mode, 'compare');
});

test('workbook tabs and invoice headers match the spec', () => {
  assert.deepEqual(config.SHEET_NAMES, [
    'Invoices',
    'RunLog',
    'Comparison',
    'AnswerKey',
    'Settings'
  ]);
  assert.deepEqual(config.headersFor('Invoices'), [
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
    'buyer_name_ok',
    'source',
    'file_link',
    'confidence',
    'status'
  ]);
  assert.deepEqual(config.headersFor('AnswerKey'), config.headersFor('Invoices'));
  assert.ok(config.headersFor('RunLog').indexOf('mode') !== -1);
  assert.ok(config.headersFor('RunLog').indexOf('errors') !== -1);
  assert.ok(config.headersFor('Comparison').indexOf('tokens') !== -1);
});

test('initial Settings grid contains each key once', () => {
  const grids = config.buildInitialGrids();
  assert.deepEqual(Object.keys(grids), config.SHEET_NAMES);
  const keys = grids.Settings.slice(1).map((row) => row[0]);
  assert.deepEqual(
    keys,
    config.SETTINGS_FIELDS.map((field) => field.key)
  );
  assert.equal(grids.Invoices.length, 1);
  assert.equal(grids.RunLog[0][0], 'started_at');
});

test('the old one-line search default is replaced and a custom query is kept', () => {
  const legacy = config.LEGACY_SEARCH_QUERIES;
  const grid = config.gridForSheet('Settings', [
    ['key', 'value', 'note'],
    ['search_queries', legacy, 'old']
  ]);
  const replaced = grid.find((row) => row[0] === 'search_queries');
  assert.equal(replaced[1].split('\n').length, 3);
  assert.equal(replaced[1].includes('filename:pdf'), true);
  const custom = config.gridForSheet('Settings', [
    ['key', 'value', 'note'],
    ['search_queries', 'subject:receipt', 'kept']
  ]);
  assert.equal(custom.find((row) => row[0] === 'search_queries')[1], 'subject:receipt');
});

test('merging Settings keeps edited values and appends missing keys', () => {
  const grid = config.gridForSheet('Settings', [
    ['key', 'value', 'note'],
    ['month', '2026-02', 'kept'],
    ['mode', 'local_ai', 'kept']
  ]);
  const byKey = new Map(grid.slice(1).map((row) => [row[0], row[1]]));
  assert.equal(byKey.get('month'), '2026-02');
  assert.equal(byKey.get('mode'), 'local_ai');
  assert.equal(byKey.get('currency_default'), 'ILS');
  assert.equal(grid.length, config.SETTINGS_FIELDS.length + 1);
});

test('a filled Invoices tab is left untouched', () => {
  assert.equal(
    config.gridForSheet('Invoices', [config.INVOICE_HEADERS, ['Example Ltd']]),
    null
  );
});
