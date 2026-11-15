/**
 * Dev only. One-run checks for the pipeline so far.
 * A client push does not include src/dev (.claspignore).
 *
 * npm run push:dev, then run testAllSoFar or testResumeFlow.
 * Both log each step and end with PASS or FAIL. testResumeFlow
 * restores batch_size. Gmail is read only through the fixture helpers.
 */

function resumeFlowPasses_(counts) {
  var expected = [3, 3, 2, 0];
  if (!counts || counts.length !== expected.length) return false;
  for (var i = 0; i < expected.length; i++) {
    if (counts[i] !== expected[i]) return false;
  }
  return true;
}

function summarizeTaskResults_(rows) {
  var failed = [];
  var source = rows || [];
  for (var i = 0; i < source.length; i++) {
    if (!source[i] || source[i].result !== 'PASS') failed.push(source[i] ? source[i].task : '?');
  }
  return { result: failed.length ? 'FAIL' : 'PASS', failed: failed };
}

function readSettingValue_(key) {
  var sheet = openCollectorSpreadsheet_().getSheetByName('Settings');
  if (!sheet) return null;
  var values = sheet.getDataRange().getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === key) return { row: i + 1, value: values[i][1] };
  }
  return null;
}

function writeSettingValue_(key, value) {
  var found = readSettingValue_(key);
  if (!found) throw new Error('Settings is missing ' + key + '. Run setupCollectorSheet().');
  openCollectorSpreadsheet_().getSheetByName('Settings').getRange(found.row, 2).setValue(value);
  SpreadsheetApp.flush();
}

/**
 * Clears fixture labels, saves with batch_size 3 until ok, then once more.
 * Expects processed counts 3, 3, 2, 0. Restores batch_size.
 * @return {{result: string, detail: string, counts: number[]}}
 */
function testResumeFlow() {
  var previous = readSettingValue_('batch_size');
  var counts = [];
  var detail = '';
  var pass = false;
  try {
    if (!previous) throw new Error('Settings is missing batch_size. Run setupCollectorSheet().');
    Logger.log('testResumeFlow step 1: clear fixture labels');
    var cleared = clearTestFixtureLabels();
    Logger.log('testResumeFlow cleared=%s found=%s', cleared.cleared, cleared.found);
    Logger.log('testResumeFlow step 2: set batch_size=3 (was %s)', previous.value);
    writeSettingValue_('batch_size', 3);
    var last = null;
    var i;
    for (i = 0; i < 10; i++) {
      last = saveTestFixtureFiles();
      counts.push(last.processed);
      Logger.log(
        'testResumeFlow save %s processed=%s created=%s status=%s',
        i + 1,
        last.processed,
        last.created,
        last.status
      );
      if (last.status === 'ok') break;
    }
    if (!last || last.status !== 'ok') {
      throw new Error('status did not reach ok within 10 runs');
    }
    Logger.log('testResumeFlow step 3: one more run, expect processed 0');
    var extra = saveTestFixtureFiles();
    counts.push(extra.processed);
    Logger.log('testResumeFlow extra processed=%s status=%s', extra.processed, extra.status);
    pass = resumeFlowPasses_(counts) && extra.status === 'ok';
    detail = 'counts=' + counts.join(',');
    if (!pass) detail += ' expected 3,3,2,0';
  } catch (error) {
    pass = false;
    detail = String(error && error.message ? error.message : error);
    if (counts.length) detail += ' counts=' + counts.join(',');
  } finally {
    if (previous) {
      writeSettingValue_('batch_size', previous.value);
      Logger.log('testResumeFlow restored batch_size=%s', previous.value);
    }
  }
  Logger.log('testResumeFlow %s %s', pass ? 'PASS' : 'FAIL', detail);
  return { result: pass ? 'PASS' : 'FAIL', detail: detail, counts: counts };
}

function testAllSoFar() {
  var rows = [
    runTaskCheck_('0.2', checkConfigKeys_),
    runTaskCheck_('1.1', checkFixtureMessages_),
    runTaskCheck_('1.2', checkMonthFiles_),
    runTaskCheck_('1.3', checkSecondRun_),
    testResumeFlowResult_(),
    testOcrResult_(),
    testExtractResult_()
  ];
  var summary = summarizeTaskResults_(rows);
  Logger.log('task\tresult\tdetail');
  for (var i = 0; i < rows.length; i++) {
    Logger.log('%s\t%s\t%s', rows[i].task, rows[i].result, rows[i].detail);
  }
  Logger.log('testAllSoFar %s', summary.result);
  return { result: summary.result, tasks: rows };
}

function testResumeFlowResult_() {
  Logger.log('testAllSoFar step 1.4: testResumeFlow');
  var resume = testResumeFlow();
  return { task: '1.4', result: resume.result, detail: resume.detail };
}

function testOcrResult_() {
  Logger.log('testAllSoFar step 2.1: testOcr');
  var ocr = testOcr();
  return { task: '2.1', result: ocr.result, detail: ocr.detail };
}

function testExtractResult_() {
  Logger.log('testAllSoFar step 2.2: testExtract');
  var extracted = testExtract();
  return { task: '2.2', result: extracted.result, detail: extracted.detail };
}

function runTaskCheck_(task, check) {
  Logger.log('testAllSoFar step %s', task);
  try {
    var detail = check();
    Logger.log('%s PASS %s', task, detail);
    return { task: task, result: 'PASS', detail: detail };
  } catch (error) {
    var message = String(error && error.message ? error.message : error);
    Logger.log('%s FAIL %s', task, message);
    return { task: task, result: 'FAIL', detail: message };
  }
}

function checkConfigKeys_() {
  var config = getConfig();
  var missing = [];
  for (var i = 0; i < SETTINGS_FIELDS.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(config, SETTINGS_FIELDS[i].key)) {
      missing.push(SETTINGS_FIELDS[i].key);
    }
  }
  if (missing.length) throw new Error('missing ' + missing.join(', '));
  return SETTINGS_FIELDS.length + ' keys';
}

function checkFixtureMessages_() {
  var listed = listTestFixtureMessages({ includeProcessed: true });
  if (listed.month !== '2026-11') throw new Error('month is ' + listed.month);
  if (listed.count !== 8) throw new Error('found ' + listed.count + ' fixtures');
  return '8 fixtures in 2026-11';
}

function checkMonthFiles_() {
  var id = getConfig().invoices_folder_id;
  if (!id) throw new Error('invoices_folder_id is empty');
  var folder = DriveApp.getFolderById(id);
  if (folder.getName() !== '2026-11') throw new Error('folder is named ' + folder.getName());
  var count = 0;
  var files = folder.getFiles();
  while (files.hasNext()) {
    files.next();
    count++;
  }
  if (count !== 8) throw new Error('found ' + count + ' files in Invoices/2026-11');
  return '8 files in Invoices/2026-11';
}

function checkSecondRun_() {
  var result = saveTestFixtureFiles();
  if (result.processed !== 0 || result.created !== 0) {
    throw new Error('processed=' + result.processed + ' created=' + result.created);
  }
  return 'processed=0 created=0';
}

if (typeof module !== 'undefined') {
  module.exports = {
    resumeFlowPasses_: resumeFlowPasses_,
    summarizeTaskResults_: summarizeTaskResults_
  };
}
