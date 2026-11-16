const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const extract = require('../src/extract.js');
const config = require('../src/config.js');

const FIELD_KEYS = ['vendor_name', 'doc_type', 'doc_number', 'amount_before_vat', 'vat_amount', 'total', 'buyer_name_ok'];

function settings() {
  const value = config.getConfig([]);
  value.company_name = 'סטודיו דמה לבדיקות בע"מ';
  value.company_id = '990100091';
  value.month = '2026-11';
  return value;
}

function loadPages(name) {
  const raw = fs.readFileSync(path.join(__dirname, 'real', 'debug-docs', name), 'utf8');
  return raw
    .split(/--- page \d+ ---/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function legacy(text) {
  const lines = String(text || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const vendor = lines.find((line) => /[A-Za-z\u0590-\u05FF]/.test(line)) || null;
  let docType = null;
  if (/חשבונית מס קבלה|חשבונית מס\/קבלה|tax invoice receipt/i.test(text)) docType = 'tax_invoice_receipt';
  else if (/חשבונית מס|tax invoice/i.test(text)) docType = 'tax_invoice';
  else if (/קבלה|receipt/i.test(text)) docType = 'receipt';
  else if (/זיכוי|credit note/i.test(text)) docType = 'credit_note';
  const docNumber = (text.match(/מספר\s+\S+\s+([A-Z]+-\d+)/) || [])[1] || null;
  const before = (text.match(/לפני מע["״]מ\s*:?\s*₪?\s*([\d,]+\.\d+)/) || [])[1];
  const withoutBefore = text.replace(/לפני מע["״]מ[^:\n]*:?\s*₪?\s*[\d,]+\.\d+/g, ' ');
  const vatLine = (withoutBefore.match(/מע["״]מ[^:\n]*:?\s*₪?\s*([\d,]+\.\d+)/) || [])[1];
  const total = (text.match(/סה["״]כ(?:\s+לתשלום|\s+התקבל)?\s*₪?\s*([\d,]+\.\d+)/) || [])[1];
  return {
    vendor_name: vendor,
    doc_type: docType,
    doc_number: docNumber,
    amount_before_vat: before ? Number(before.replace(/,/g, '')) : null,
    vat_amount: vatLine ? Number(vatLine.replace(/,/g, '')) : null,
    total: total ? Number(total.replace(/,/g, '')) : null,
    buyer_name_ok: false
  };
}

function same(actual, expected) {
  if (expected == null || expected === '') return actual == null || actual === '';
  if (typeof expected === 'number') return Number(actual) === expected;
  return String(actual) === String(expected);
}

test('plain חשבונית, reversed document numbers, and same-line amounts', () => {
  const value = settings();
  const invoice = extract.extractInvoice(
    [
      'מסמך דוגמה בלבד • כל הנתונים פיקטיביים',
      'page 1 of 2',
      'סטודיו מרחב לדוגמה',
      'חשבונית לדוגמה',
      '-1001INV',
      'לכבוד חברת אופק לדוגמה',
      'תיאור סכום עיצוב אתר 1500.00 מע"מ 18% 270.00 סה"כ לתשלום 1770.00'
    ].join('\n'),
    value,
    { senderName: 'Omer Mandalaoui' }
  );
  assert.equal(invoice.vendor_name, 'סטודיו מרחב לדוגמה');
  assert.equal(invoice.doc_type, 'tax_invoice');
  assert.equal(invoice.doc_number, 'INV-1001');
  assert.equal(invoice.amount_before_vat, 1500);
  assert.equal(invoice.vat_amount, 270);
  assert.equal(invoice.total, 1770);
  assert.equal(invoice.buyer_name_ok, false);

  const receipt = extract.extractInvoice(
    ['סטודיו מרחב לדוגמה', 'קבלה לדוגמה', '-2001REC', 'סה"כ התקבל 1200.00'].join('\n'),
    value,
    { senderName: 'Omer Mandalaoui' }
  );
  assert.equal(receipt.doc_type, 'receipt');
  assert.equal(receipt.doc_number, 'REC-2001');
  assert.equal(receipt.total, 1200);
  assert.equal(receipt.vendor_name, 'סטודיו מרחב לדוגמה');

  const pasted = extract.extractInvoice(
    [
      'סטודיו מרחב לדוגמה',
      'חשבונית לדוגמה',
      'INV-1001',
      'תיאור סכום עיצוב אתר ₪1500.00 מע״מ בדוגמה) 18%( ₪270.00 סה״כ לתשלום ₪1770.00'
    ].join('\n'),
    value
  );
  assert.equal(pasted.amount_before_vat, 1500);
  assert.equal(pasted.vat_amount, 270);
  assert.equal(pasted.total, 1770);
  const reversed = extract.extractInvoice('קבלה לדוגמה\nמספר קבלה -2001REC', value, {
    senderName: 'Omer Mandalaoui'
  });
  assert.equal(reversed.doc_number, 'REC-2001');
});

test('debug docs: per-field before and after', () => {
  const value = settings();
  const sender = { senderName: 'Omer Mandalaoui' };
  const cases = [];
  for (const name of ['invoice_01.pdf.txt', 'invoice_02.pdf.txt', 'receipt_01.pdf.txt', 'receipt_02.pdf.txt']) {
    const pages = loadPages(name);
    cases.push({ name: name.replace('.txt', ''), text: pages.join('\n'), sender });
  }
  const multi = loadPages('receipt_page_4.pdf.txt');
  const docs = extract.splitDocuments(multi, value);
  assert.deepEqual(
    docs.map((doc) => doc.range),
    ['1-3', '4-5']
  );
  const rows = extract.invoiceRowsFromText(multi.join('\n'), value, sender, 'file5');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].notes, 'pages 1-3');
  assert.equal(rows[1].notes, 'pages 4-5');
  assert.equal(rows[0].source, 'file5#p1-3');
  assert.equal(rows[1].source, 'file5#p4-5');
  cases.push({ name: 'file5 invoice pages 1-3', text: docs[0].text, sender, fields: rows[0] });
  cases.push({ name: 'file5 receipt pages 4-5', text: docs[1].text, sender, fields: rows[1] });

  const expected = {
    'invoice_01.pdf': {
      vendor_name: 'סטודיו מרחב לדוגמה',
      doc_type: 'tax_invoice',
      doc_number: 'INV-1001',
      amount_before_vat: 1500,
      vat_amount: 270,
      total: 1770,
      buyer_name_ok: false
    },
    'invoice_02.pdf': {
      vendor_name: 'סטודיו מרחב לדוגמה',
      doc_type: 'tax_invoice',
      doc_number: 'INV-1002',
      amount_before_vat: 2000,
      vat_amount: 360,
      total: 2360,
      buyer_name_ok: false
    },
    'receipt_01.pdf': {
      vendor_name: 'סטודיו מרחב לדוגמה',
      doc_type: 'receipt',
      doc_number: 'REC-2001',
      amount_before_vat: null,
      vat_amount: null,
      total: 1770,
      buyer_name_ok: false
    },
    'receipt_02.pdf': {
      vendor_name: 'סטודיו מרחב לדוגמה',
      doc_type: 'receipt',
      doc_number: 'REC-2002',
      amount_before_vat: null,
      vat_amount: null,
      total: 1200,
      buyer_name_ok: false
    },
    'file5 invoice pages 1-3': {
      vendor_name: 'סטודיו מרחב לדוגמה',
      doc_type: 'tax_invoice',
      doc_number: 'INV-1001',
      amount_before_vat: 1500,
      vat_amount: 270,
      total: 1770,
      buyer_name_ok: false
    },
    'file5 receipt pages 4-5': {
      vendor_name: 'Omer Mandalaoui',
      doc_type: 'receipt',
      doc_number: 'REC-2001',
      amount_before_vat: null,
      vat_amount: null,
      total: 1770,
      buyer_name_ok: false
    }
  };

  const lines = ['debug docs before -> after'];
  for (const row of cases) {
    const before = legacy(row.text);
    const after = row.fields || extract.extractInvoice(row.text, value, row.sender);
    const want = expected[row.name];
    lines.push(row.name);
    for (const key of FIELD_KEYS) {
      lines.push('  ' + key + ': ' + String(before[key]) + ' -> ' + String(after[key]));
      assert.equal(same(after[key], want[key]), true, row.name + ' ' + key + ' ' + after[key]);
    }
  }
  console.log(lines.join('\n'));
});
