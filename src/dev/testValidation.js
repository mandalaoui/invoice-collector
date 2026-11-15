/**
 * Dev only. Classifies built samples. Does not change Settings.
 * Bad totals, a bare receipt, and a missing allocation number are REVIEW
 * with a reason. A quote is NOT_INVOICE. A repeated vendor id + document
 * number is DUPLICATE.
 */

function testValidation() {
  var detail = '';
  var pass = false;
  try {
    var config = getConfig();
    config.allocation_threshold = 50;
    var broken = classifyInvoice(
      {
        doc_type: 'tax_invoice',
        vendor_id: '990100018',
        doc_number: '1',
        amount_before_vat: 100,
        vat_amount: 18,
        total: 200,
        confidence: 0.9,
        allocation_number: null
      },
      config,
      []
    );
    var receipt = classifyInvoice(
      {
        doc_type: 'receipt',
        vendor_id: '990100034',
        doc_number: '5521',
        total: 186,
        amount_before_vat: null,
        vat_amount: null,
        confidence: 0.9
      },
      config,
      []
    );
    var quote = classifyInvoice({ doc_type: 'not_invoice', confidence: 0.9 }, config, []);
    var first = { vendor_id: '990100018', doc_number: '10482', doc_type: 'tax_invoice', total: 100, amount_before_vat: 84.75, vat_amount: 15.25, confidence: 0.9 };
    var duplicate = classifyInvoice(first, config, [first]);
    Logger.log('testValidation broken %s %s', broken.status, broken.reasons.join(' | '));
    Logger.log('testValidation receipt %s %s', receipt.status, receipt.reasons.join(' | '));
    Logger.log('testValidation quote %s %s', quote.status, quote.reasons.join(' | '));
    Logger.log('testValidation duplicate %s %s', duplicate.status, duplicate.reasons.join(' | '));
    var checks = [
      broken.status === 'REVIEW' && broken.reasons.length > 0,
      receipt.status === 'REVIEW' && receipt.reasons.join(' ').indexOf('VAT deduction') >= 0,
      quote.status === 'NOT_INVOICE' && quote.reasons.length > 0,
      duplicate.status === 'DUPLICATE' && duplicate.reasons.length > 0
    ];
    pass = checks.every(function (ok) { return ok; });
    detail = 'broken=' + broken.status + ' receipt=' + receipt.status + ' quote=' + quote.status + ' duplicate=' + duplicate.status;
  } catch (error) {
    pass = false;
    detail = String(error && error.message ? error.message : error);
  }
  Logger.log('testValidation %s %s', pass ? 'PASS' : 'FAIL', detail);
  return { result: pass ? 'PASS' : 'FAIL', detail: detail };
}
