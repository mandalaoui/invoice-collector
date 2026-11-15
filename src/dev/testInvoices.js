/**
 * Dev only. Writes one Invoices row per saved fixture.
 * A second pass adds 0 rows. Restores company_name, company_id, and month.
 */

var INVOICE_FIELD_KEYS_ = [
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

function withFixtureCompany_(run) {
  var saved = {
    company_name: readSettingValue_('company_name'),
    company_id: readSettingValue_('company_id'),
    month: readSettingValue_('month')
  };
  try {
    if (!saved.company_name || !saved.company_id || !saved.month) {
      throw new Error('Settings is missing company_name, company_id, or month.');
    }
    writeSettingValue_(
      'company_name',
      FIXTURE_EXPECTED.buyer.name_he + '\n' + FIXTURE_EXPECTED.buyer.name_en
    );
    writeSettingValue_('company_id', FIXTURE_EXPECTED.buyer.vendor_id);
    writeSettingValue_('month', FIXTURE_EXPECTED.month);
    return run();
  } finally {
    if (saved.company_name) writeSettingValue_('company_name', saved.company_name.value);
    if (saved.company_id) writeSettingValue_('company_id', saved.company_id.value);
    if (saved.month) writeSettingValue_('month', saved.month.value);
  }
}

function buildFixtureInvoiceRows() {
  var listed = listTestFixtureMessages({ includeProcessed: true });
  if (listed.count !== 8) throw new Error('found ' + listed.count + ' fixture messages');
  var bySubject = {};
  var i;
  for (i = 0; i < listed.messages.length; i++) bySubject[listed.messages[i].subject] = listed.messages[i];
  var folder = DriveApp.getFolderById(getConfig().invoices_folder_id);
  var docs = FIXTURE_EXPECTED.documents;
  var pending = {};
  for (i = 0; i < docs.length; i++) pending[docs[i].file.replace(/\.[^.]+$/, '')] = docs[i];
  var rows = [];
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    var stem = '';
    var keys = Object.keys(pending);
    for (i = 0; i < keys.length; i++) {
      if (file.getName().indexOf(keys[i]) >= 0) stem = keys[i];
    }
    if (!stem) continue;
    var doc = pending[stem];
    var message = bySubject[TEST_FIXTURE_MESSAGES.filter(function (item) {
      return item.file.replace(/\.[^.]+$/, '') === stem;
    })[0].subject];
    if (!message) throw new Error('no message for ' + doc.file);
    var read = readDriveBlobText(file.getBlob(), file.getName());
    var fields = extractInvoice(read.text, getConfig(), { senderEmail: doc.from, senderName: doc.name });
    var existing = rows.map(function (row) {
      return { vendor_id: row.vendor_id, doc_number: row.doc_number };
    });
    var decision = classifyInvoice(fields, getConfig(), existing);
    fields.source = message.id + ' ' + stem;
    fields.file_link = file.getUrl();
    fields.status = decision.status;
    rows.push(fields);
    delete pending[stem];
  }
  var missing = Object.keys(pending);
  if (missing.length) throw new Error('missing files ' + missing.join(', '));
  return rows;
}

function testInvoices() {
  var detail = '';
  var pass = false;
  var added = [];
  try {
    var result = withFixtureCompany_(function () {
      var rows = buildFixtureInvoiceRows();
      var first = appendInvoiceRows(rows);
      var second = appendInvoiceRows(rows);
      beginRunLog_({
        startedAt: new Date(),
        finishedAt: new Date(),
        mode: getConfig().mode || 'deterministic',
        messages: rows.length,
        files: rows.length,
        rows: first.added,
        errors: '',
        status: 'ok',
        cursor: ''
      });
      return { first: first, second: second, rows: rows };
    });
    added = [result.first.added, result.second.added];
    var stored = readInvoiceRows();
    var found = 0;
    for (var i = 0; i < FIXTURE_EXPECTED.documents.length; i++) {
      var stem = FIXTURE_EXPECTED.documents[i].file.replace(/\.[^.]+$/, '');
      var hit = false;
      for (var r = 0; r < stored.length; r++) {
        if (String(stored[r].source || '').indexOf(stem) >= 0) hit = true;
      }
      if (hit) found++;
    }
    pass = result.second.added === 0 && found === 8;
    detail = 'added=' + result.first.added + ' then ' + result.second.added + ' rows=' + found;
    Logger.log('testInvoices %s', detail);
  } catch (error) {
    pass = false;
    detail = String(error && error.message ? error.message : error);
  }
  Logger.log('testInvoices %s %s', pass ? 'PASS' : 'FAIL', detail);
  return { result: pass ? 'PASS' : 'FAIL', detail: detail, added: added };
}

function phase2Passes_(correct, total, missStatuses) {
  if (!total || correct / total < 0.8) return false;
  var misses = missStatuses || [];
  for (var i = 0; i < misses.length; i++) {
    if (misses[i] !== 'REVIEW') return false;
  }
  return true;
}

function invoiceFieldEqual_(key, actual, expected) {
  if (expected == null || expected === '') return actual == null || actual === '';
  if (typeof expected === 'number') return Number(actual) === expected;
  if (typeof expected === 'boolean') {
    return actual === expected || String(actual).toLowerCase() === String(expected);
  }
  if (key === 'doc_date' && Object.prototype.toString.call(actual) === '[object Date]') {
    return false;
  }
  return String(actual).trim() === String(expected);
}

function scoreFixtureInvoices_() {
  var stored = readInvoiceRows();
  var correct = 0;
  var total = 0;
  var missStatuses = [];
  var lines = [];
  var docs = FIXTURE_EXPECTED.documents;
  for (var d = 0; d < docs.length; d++) {
    var stem = docs[d].file.replace(/\.[^.]+$/, '');
    var row = null;
    for (var r = 0; r < stored.length; r++) {
      if (String(stored[r].source || '').indexOf(stem) >= 0) row = stored[r];
    }
    for (var k = 0; k < INVOICE_FIELD_KEYS_.length; k++) {
      var key = INVOICE_FIELD_KEYS_[k];
      total++;
      var expected = docs[d].fields[key];
      var actual = row ? row[key] : '';
      var status = row ? String(row.status || '') : '';
      if (!row || !invoiceFieldEqual_(key, actual, expected)) {
        missStatuses.push(status);
        lines.push(docs[d].file + '\t' + key + '\t' + expected + '\t' + actual + '\t' + status);
      } else {
        correct++;
      }
    }
  }
  return { correct: correct, total: total, missStatuses: missStatuses, lines: lines };
}

/**
 * Writes the fixture rows, checks a second write adds 0, then scores fields
 * against the answer key. PASS when at least 80% of fields match and every
 * miss is REVIEW.
 */
function testPhase2() {
  var invoices = testInvoices();
  var score = { correct: 0, total: 0, missStatuses: [], lines: [] };
  var pass = false;
  var detail = invoices.detail;
  try {
    score = scoreFixtureInvoices_();
    Logger.log('file\tfield\texpected\tactual\tstatus');
    for (var i = 0; i < score.lines.length; i++) Logger.log(score.lines[i]);
    var accuracy = score.total ? Math.round((1000 * score.correct) / score.total) / 10 : 0;
    Logger.log('testPhase2 accuracy=%s% %s/%s', accuracy, score.correct, score.total);
    pass = invoices.result === 'PASS' && phase2Passes_(score.correct, score.total, score.missStatuses);
    detail = invoices.detail + ' accuracy=' + accuracy + '% ' + score.correct + '/' + score.total;
  } catch (error) {
    pass = false;
    detail = String(error && error.message ? error.message : error);
  }
  Logger.log('testPhase2 %s %s', pass ? 'PASS' : 'FAIL', detail);
  return {
    result: pass ? 'PASS' : 'FAIL',
    detail: detail,
    correct: score.correct,
    total: score.total
  };
}

if (typeof module !== 'undefined') {
  module.exports = { phase2Passes_: phase2Passes_ };
}
