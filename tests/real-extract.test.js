const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const extract = require('../src/extract.js');
const config = require('../src/config.js');

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

function same(actual, expected) {
  if (expected == null || expected === '') return actual == null || actual === '';
  if (typeof expected === 'number') return Number(actual) === expected;
  if (typeof expected === 'boolean') return actual === expected;
  return String(actual) === String(expected);
}

function legacyBuyer(text, settings) {
  const folded = String(text || '').toLowerCase();
  const id = String(settings.company_id || '').replace(/\D/g, '');
  if (id && folded.indexOf(id) >= 0) return true;
  return String(settings.company_name || '')
    .split(/\n/)
    .some((name) => name && folded.indexOf(name.toLowerCase()) >= 0);
}

function legacyVendor(text, senderName) {
  const lines = String(text || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (/[A-Za-z\u0590-\u05FF]/.test(line)) return line;
  }
  return senderName || null;
}

function legacyVat(text) {
  const lines = String(text || '').split(/\n/);
  for (const line of lines) {
    if (!/מע"מ|מע״מ|\bVAT\b/i.test(line)) continue;
    const match = line.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return null;
}

function scoreCases(cases, read) {
  const hits = {};
  for (const key of FIELD_KEYS) hits[key] = { ok: 0, n: 0 };
  for (const row of cases) {
    const got = read(row);
    for (const key of FIELD_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(row.fields, key)) continue;
      hits[key].n += 1;
      if (same(got[key], row.fields[key])) hits[key].ok += 1;
    }
  }
  return hits;
}

function formatScore(label, hits) {
  const lines = [label];
  for (const key of FIELD_KEYS) {
    const hit = hits[key];
    if (!hit.n) continue;
    const pct = Math.round((1000 * hit.ok) / hit.n) / 10;
    lines.push(key + ' ' + hit.ok + '/' + hit.n + ' ' + pct + '%');
  }
  return lines.join('\n');
}

test('per-field accuracy is reported before and after the extractor change', () => {
  const settings = config.getConfig([]);
  settings.company_name = 'סטודיו דמה לבדיקות בע"מ';
  settings.company_id = '990100091';
  settings.month = '2026-11';
  const cases = [
    {
      fields: {
        vendor_name: 'קפה הכרמל בע"מ',
        vat_amount: 18,
        total: 118,
        buyer_name_ok: true
      },
      text: [
        'מקור',
        'קפה הכרמל בע"מ',
        'סה"כ כולל מע"מ: 118.00',
        'מע"מ 18.00',
        'סה"כ לתשלום: 118.00',
        'לכבוד',
        'סטודיו דמה לבדיקות   בע״מ'
      ].join('\n'),
      senderName: 'קפה הכרמל'
    },
    {
      fields: {
        vendor_name: 'Accounts Desk',
        vat_amount: 153,
        total: 1003,
        buyer_name_ok: true
      },
      text: ['מקור', 'לכבוד', 'ח.פ 990-100-091', 'מע"מ 153.00', 'סה"כ לתשלום: 1,003.00'].join('\n'),
      senderName: 'Accounts Desk'
    }
  ];
  const before = scoreCases(cases, (row) => ({
    vendor_name: legacyVendor(row.text, row.senderName),
    vat_amount: legacyVat(row.text),
    total: extract.extractInvoice(row.text, settings, {}).total,
    buyer_name_ok: legacyBuyer(row.text, settings)
  }));
  const after = scoreCases(cases, (row) =>
    extract.extractInvoice(row.text, settings, { senderName: row.senderName })
  );
  console.log(formatScore('before', before));
  console.log(formatScore('after', after));
  for (const key of ['vendor_name', 'vat_amount', 'buyer_name_ok']) {
    assert.ok(after[key].ok >= before[key].ok, key);
    assert.equal(after[key].ok, after[key].n, key);
  }

  const dir = path.join(__dirname, 'real', 'ocr-text');
  const answerPath = path.join(__dirname, 'real', 'expected.json');
  if (!fs.existsSync(dir) || !fs.existsSync(answerPath)) {
    console.log('real ocr: no tests/real/ocr-text answer key yet');
    return;
  }
  const answer = JSON.parse(fs.readFileSync(answerPath, 'utf8'));
  const realSettings = config.getConfig([]);
  realSettings.month = answer.month || '';
  realSettings.company_name = answer.company_name || '';
  realSettings.company_id = answer.company_id || '';
  const realCases = (answer.documents || []).map((doc) => ({
    fields: doc.fields || {},
    text: fs.readFileSync(path.join(dir, doc.file), 'utf8'),
    senderName: doc.senderName || ''
  }));
  const realAfter = scoreCases(realCases, (row) =>
    extract.extractInvoice(row.text, realSettings, { senderName: row.senderName })
  );
  console.log(formatScore('real after', realAfter));
});
