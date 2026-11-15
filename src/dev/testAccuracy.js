/**
 * Dev only. Scores Invoices against the fixture answer key and writes
 * Comparison. Does not read Drive files and does not run OCR.
 * Restores nothing on the sheet: Comparison is the report.
 */

function fixtureAnswerRows_() {
  var docs = FIXTURE_EXPECTED.documents;
  var rows = [];
  for (var i = 0; i < docs.length; i++) {
    var stem = String(docs[i].file || '').replace(/\.[^.]+$/, '');
    var row = { file: docs[i].file, source: stem };
    var fields = docs[i].fields || {};
    for (var k = 0; k < ACCURACY_FIELDS.length; k++) {
      var key = ACCURACY_FIELDS[k];
      row[key] = fields[key] == null ? '' : fields[key];
    }
    rows.push(row);
  }
  return rows;
}

function accuracySelfCheck_(invoices) {
  var scored = compareInvoicesToAnswerKey(invoices, invoices);
  var bad = [];
  for (var i = 0; i < scored.rows.length; i++) {
    if (scored.rows[i].match_percent !== '100%') bad.push(scored.rows[i].field);
  }
  return bad;
}

/**
 * Writes Comparison from the live Invoices rows and the fixture answer key.
 * PASS when every fixture is present, the sheet shows a percent per field,
 * and scoring a row against itself is 100%.
 */
function testAccuracy() {
  var detail = '';
  var pass = false;
  try {
    var invoices = readInvoiceRows();
    var answers = fixtureAnswerRows_();
    var scored = compareInvoicesToAnswerKey(invoices, answers);
    if (scored.pairs !== answers.length || scored.unmatched !== 0) {
      throw new Error('paired ' + scored.pairs + ' of ' + answers.length + '. Run testPhase2 first.');
    }
    var selfMisses = accuracySelfCheck_(invoices);
    if (selfMisses.length) throw new Error('self-check failed for ' + selfMisses.join(', '));
    writeAccuracyReport(invoices, answers);
    var sheet = openCollectorSpreadsheet_().getSheetByName('Comparison');
    var values = sheet.getDataRange().getValues();
    if (values.length !== ACCURACY_FIELDS.length + 1) {
      throw new Error('Comparison has ' + values.length + ' rows');
    }
    if (String(values[0][0]) !== 'field' || String(values[0][values[0].length - 1]) !== 'match_percent') {
      throw new Error('Comparison header is ' + values[0].join(','));
    }
    var parts = [];
    for (var i = 1; i < values.length; i++) {
      var percent = String(values[i][values[0].length - 1] || '');
      if (!/^\d+(\.\d+)?%$/.test(percent)) throw new Error(values[i][0] + ' percent is "' + percent + '"');
      parts.push(values[i][0] + '=' + percent);
      Logger.log('testAccuracy %s %s/%s %s', values[i][0], values[i][2], values[i][1], percent);
    }
    pass = true;
    detail = parts.join(' ');
  } catch (error) {
    pass = false;
    detail = String(error && error.message ? error.message : error);
  }
  Logger.log('testAccuracy %s %s', pass ? 'PASS' : 'FAIL', detail);
  return { result: pass ? 'PASS' : 'FAIL', detail: detail };
}
