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

function fixtureStem_(fileName) {
  return String(fileName || '').replace(/\.[^.]+$/, '');
}

function formatFixtureDriveFile_(row) {
  return row.fixture + '\t' + row.name + '\t' + row.mimeType;
}

/**
 * Pair each fixture with a Drive file. Temp OCR docs are left out.
 * @param {Array<{file: string}>} fixtures
 * @param {Array<{name: string, mimeType: string}>} driveFiles
 * @return {Array<{fixture: string, name: string, mimeType: string}>}
 */
function driveFileRank_(mime) {
  var type = String(mime || '').toLowerCase();
  if (type === 'application/pdf' || type.indexOf('image/') === 0) return 3;
  if (type.indexOf('text/html') === 0) return 2;
  if (type === 'application/vnd.google-apps.document') return 1;
  return 0;
}

function mapFixturesToDriveFiles(fixtures, driveFiles) {
  var pending = {};
  var list = fixtures || [];
  var i;
  for (i = 0; i < list.length; i++) pending[fixtureStem_(list[i].file)] = list[i].file;
  var best = {};
  var files = driveFiles || [];
  for (i = 0; i < files.length; i++) {
    var drive = files[i] || {};
    if (isTempOcrFile(drive.name)) continue;
    var keys = Object.keys(pending);
    var stem = '';
    var k;
    for (k = 0; k < keys.length; k++) {
      if (String(drive.name || '').indexOf(keys[k]) >= 0) stem = keys[k];
    }
    if (!stem) continue;
    var candidate = { fixture: pending[stem], name: drive.name, mimeType: drive.mimeType || '' };
    if (!best[stem] || driveFileRank_(candidate.mimeType) > driveFileRank_(best[stem].mimeType)) {
      best[stem] = candidate;
    }
  }
  var maps = [];
  for (i = 0; i < list.length; i++) {
    var chosen = best[fixtureStem_(list[i].file)];
    if (chosen) maps.push(chosen);
  }
  return maps;
}

function readFailureFields(error) {
  var reason = String(error && error.message ? error.message : error);
  return {
    vendor_name: '',
    vendor_id: '',
    doc_type: '',
    doc_number: '',
    doc_date: '',
    amount_before_vat: '',
    vat_amount: '',
    total: '',
    currency: '',
    allocation_number: '',
    buyer_name_ok: '',
    confidence: 0,
    status: 'REVIEW',
    reasons: [reason]
  };
}

/**
 * One thrown read does not drop the other files.
 * @param {Array<Object>} files
 * @param {function(Object): Object} readOne
 * @return {Array<Object>}
 */
function readFixtureFiles(files, readOne) {
  var rows = [];
  var list = files || [];
  for (var i = 0; i < list.length; i++) {
    try {
      rows.push(readOne(list[i]));
    } catch (error) {
      var failed = readFailureFields(error);
      failed.file = list[i] && (list[i].fixture || list[i].name) ? list[i].fixture || list[i].name : '';
      rows.push(failed);
    }
  }
  return rows;
}

function buildFixtureInvoiceRows() {
  var listed = listTestFixtureMessages({ includeProcessed: true });
  if (listed.count !== 8) throw new Error('found ' + listed.count + ' fixture messages');
  var bySubject = {};
  var i;
  for (i = 0; i < listed.messages.length; i++) bySubject[listed.messages[i].subject] = listed.messages[i];
  var folder = DriveApp.getFolderById(getConfig().invoices_folder_id);
  var removed = trashTempOcrFiles(folder);
  if (removed) Logger.log('trashed %s temp OCR doc(s) from the month folder', removed);
  var docs = FIXTURE_EXPECTED.documents;
  var driveFiles = [];
  var fileByName = {};
  var found = folder.getFiles();
  while (found.hasNext()) {
    var file = found.next();
    if (isTempOcrFile(file.getName())) {
      file.setTrashed(true);
      continue;
    }
    driveFiles.push({ name: file.getName(), mimeType: file.getMimeType() });
    fileByName[file.getName()] = file;
  }
  var maps = mapFixturesToDriveFiles(docs, driveFiles);
  var jobs = [];
  for (i = 0; i < docs.length; i++) {
    var doc = docs[i];
    var docStem = fixtureStem_(doc.file);
    var matched = null;
    var m;
    for (m = 0; m < maps.length; m++) {
      if (maps[m].fixture === doc.file) matched = maps[m];
    }
    jobs.push({
      fixture: doc.file,
      doc: doc,
      stem: docStem,
      name: matched ? matched.name : '',
      mimeType: matched ? matched.mimeType : '',
      file: matched ? fileByName[matched.name] || null : null
    });
  }
  var rows = readFixtureFiles(jobs, function (job) {
    if (!job.file) throw new Error('no Drive file for ' + job.fixture);
    var fixtureMessage = null;
    for (var n = 0; n < TEST_FIXTURE_MESSAGES.length; n++) {
      if (fixtureStem_(TEST_FIXTURE_MESSAGES[n].file) === job.stem) fixtureMessage = TEST_FIXTURE_MESSAGES[n];
    }
    var message = fixtureMessage ? bySubject[fixtureMessage.subject] : null;
    if (!message) throw new Error('no message for ' + job.fixture);
    var read = readDriveFileText(job.file);
    var fields = extractInvoice(read.text, getConfig(), { senderEmail: job.doc.from, senderName: job.doc.name });
    var existing = [];
    var decision = classifyInvoice(fields, getConfig(), existing);
    fields.source = message.id + ' ' + job.stem;
    fields.file_link = job.file.getUrl();
    fields.status = decision.status;
    fields.reasons = decision.reasons;
    return fields;
  });
  for (i = 0; i < rows.length; i++) {
    if (rows[i].status !== 'REVIEW' || rows[i].source) continue;
    var job = jobs[i];
    var fixtureMessage = null;
    var n;
    for (n = 0; n < TEST_FIXTURE_MESSAGES.length; n++) {
      if (fixtureStem_(TEST_FIXTURE_MESSAGES[n].file) === job.stem) fixtureMessage = TEST_FIXTURE_MESSAGES[n];
    }
    var message = fixtureMessage ? bySubject[fixtureMessage.subject] : null;
    rows[i].source = (message ? message.id : 'missing') + ' ' + job.stem;
    rows[i].file_link = job.file ? job.file.getUrl() : '';
    Logger.log('REVIEW %s %s', job.fixture, rows[i].reasons.join(' | '));
  }
  var prior = [];
  for (i = 0; i < rows.length; i++) {
    if (rows[i].status === 'REVIEW' && rows[i].reasons && rows[i].reasons.length && !rows[i].doc_number) continue;
    var decision = classifyInvoice(rows[i], getConfig(), prior);
    if (decision.status === 'DUPLICATE') rows[i].status = 'DUPLICATE';
    if (rows[i].vendor_id && rows[i].doc_number) prior.push(rows[i]);
  }
  return { rows: rows, maps: maps };
}

function testInvoices() {
  var detail = '';
  var pass = false;
  var added = [];
  var maps = [];
  try {
    var result = withFixtureCompany_(function () {
      var built = buildFixtureInvoiceRows();
      var rows = built.rows;
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
      return { first: first, second: second, rows: rows, maps: built.maps };
    });
    added = [result.first.added, result.second.added];
    maps = result.maps || [];
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
  return { result: pass ? 'PASS' : 'FAIL', detail: detail, added: added, maps: maps };
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
    var maps = invoices.maps || [];
    Logger.log('fixture\tname\tmimeType');
    var m;
    for (m = 0; m < maps.length; m++) Logger.log(formatFixtureDriveFile_(maps[m]));
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
  if (typeof isTempOcrFile !== 'function') {
    global.isTempOcrFile = require('../ocr.js').isTempOcrFile;
  }
  module.exports = {
    phase2Passes_: phase2Passes_,
    mapFixturesToDriveFiles: mapFixturesToDriveFiles,
    formatFixtureDriveFile_: formatFixtureDriveFile_,
    readFixtureFiles: readFixtureFiles,
    readFailureFields: readFailureFields
  };
}
