/**
 * Dev only. Checks vendor, same-line amounts, reversed doc numbers,
 * plain חשבונית, and a two-document file. Logs PASS or FAIL.
 */
function testExtractV3() {
  var settings = getConfig();
  settings.company_name = 'סטודיו דמה לבדיקות בע"מ';
  settings.company_id = '990100091';
  settings.month = '2026-11';
  var checks = [];
  function check(name, ok, detail) {
    checks.push({ name: name, ok: !!ok, detail: detail || '' });
    Logger.log('%s %s %s', ok ? 'ok' : 'FAIL', name, detail || '');
  }
  var invoice = extractInvoice(
    [
      'מסמך דוגמה בלבד • כל הנתונים פיקטיביים',
      'סטודיו מרחב לדוגמה',
      'חשבונית לדוגמה',
      '-1001INV',
      'תיאור 1500.00 מע"מ 18% 270.00 סה"כ לתשלום 1770.00'
    ].join('\n'),
    settings,
    { senderName: 'Omer Mandalaoui' }
  );
  check('vendor', invoice.vendor_name === 'סטודיו מרחב לדוגמה', invoice.vendor_name);
  check('type', invoice.doc_type === 'tax_invoice', invoice.doc_type);
  check('number', invoice.doc_number === 'INV-1001', invoice.doc_number);
  check('before', invoice.amount_before_vat === 1500, String(invoice.amount_before_vat));
  check('vat', invoice.vat_amount === 270, String(invoice.vat_amount));
  check('total', invoice.total === 1770, String(invoice.total));
  var receipt = extractInvoice('קבלה לדוגמה\n-2001REC\nסה"כ התקבל 1200.00', settings, {
    senderName: 'Omer Mandalaoui'
  });
  check('receipt number', receipt.doc_number === 'REC-2001', receipt.doc_number);
  check('receipt vendor', receipt.vendor_name === 'Omer Mandalaoui', receipt.vendor_name);
  var file = [
    'שער',
    'ספק : סטודיו מרחב לדוגמה',
    'חשבונית לדוגמה',
    'INV-1001',
    '1500.00 מע"מ 270.00 סה"כ לתשלום 1770.00',
    'עמוד 1 מתוך 2',
    'קבלה לדוגמה',
    'REC-2001',
    'סה"כ התקבל 1770.00',
    'עמוד 2 מתוך 2'
  ].join('\n');
  var rows = invoiceRowsFromText(file, settings, { senderName: 'Omer Mandalaoui' }, 'm1#0');
  check('two rows', rows.length === 2, String(rows.length));
  check('invoice pages', rows[0] && rows[0].notes === 'pages 1', rows[0] && rows[0].notes);
  check('receipt pages', rows[1] && rows[1].notes === 'pages 2', rows[1] && rows[1].notes);
  check('invoice kept', rows[0] && rows[0].doc_number === 'INV-1001', rows[0] && rows[0].doc_number);
  check('receipt kept', rows[1] && rows[1].doc_type === 'receipt', rows[1] && rows[1].doc_type);
  var failed = checks.filter(function (item) {
    return !item.ok;
  });
  var summary = failed.length ? 'FAIL ' + failed.map(function (item) { return item.name; }).join(', ') : 'PASS';
  Logger.log(summary);
  return { summary: summary, checks: checks };
}
