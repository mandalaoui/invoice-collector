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

/**
 * PASS when the pack, the self-addressed draft, and the trigger check all hold.
 * A second publish updates the same draft. Original files stay as they were.
 */
function testPhase4() {
  var saved = {
    accountant_email: readSettingValue_('accountant_email'),
    owner_email: readSettingValue_('owner_email'),
    month: readSettingValue_('month')
  };
  var month = FIXTURE_EXPECTED.month;
  var detail = '';
  var pass = false;
  var hadTrigger = 0;
  var installedDuringTest = false;
  var leaveTrigger = false;
  try {
    var me = activeTestEmail_();
    if (!me) throw new Error('no user email for the draft');
    Logger.log('testPhase4 step 1: draft and error mail stay on %s', me);
    writeSettingValue_('accountant_email', me);
    writeSettingValue_('owner_email', me);
    writeSettingValue_('month', month);
    if (ownerErrorRecipient('') !== '') throw new Error('blank owner was accepted');
    if (ownerErrorRecipient(me) !== me) throw new Error('owner recipient changed');
    var spec = monthlyTriggerSpec();
    if (spec.day !== 2 || spec.hour !== 8 || spec.handler !== 'runMonthlyJob') {
      throw new Error('trigger spec is ' + spec.day + ' ' + spec.hour);
    }

    var folder = DriveApp.getFolderById(getConfig().invoices_folder_id);
    Logger.log('testPhase4 step 2: snapshot %s', folder.getName());
    var before = folderSnapshot_(folder);
    var sentPack = sentCount_('Invoices ' + month);
    var sentError = sentCount_('Invoice Collector failed ' + month);

    Logger.log('testPhase4 step 3: first publish');
    var first = runMonthlyJob();
    Logger.log('testPhase4 step 4: second publish');
    var second = runMonthlyJob();
    if (first.draftTo !== me || second.draftTo !== me) {
      throw new Error('draft went to ' + second.draftTo);
    }
    if (second.draftAction !== 'update') throw new Error('second draft action is ' + second.draftAction);
    if (sentCount_('Invoices ' + month) !== sentPack) throw new Error('a pack mail was sent');
    if (sentCount_('Invoice Collector failed ' + month) !== sentError) throw new Error('an error mail was sent');

    var message = GmailApp.getDraft(second.draftId).getMessage();
    var to = String(message.getTo() || '').toLowerCase();
    if (to.indexOf(me.toLowerCase()) < 0) throw new Error('draft To is ' + message.getTo());
    var body = message.getPlainBody();
    var sheetUrl = openCollectorSpreadsheet_().getUrl();
    if (body.indexOf(folder.getUrl()) < 0) throw new Error('draft is missing the folder link');
    if (body.indexOf(sheetUrl) < 0) throw new Error('draft is missing the sheet link');
    if (!second.pdfUrl || body.indexOf(second.pdfUrl) < 0) throw new Error('draft is missing the pdf link');

    var invoices = rowsForMonth(readInvoiceRows(), month);
    var exclusion = phase4Exclusions_(invoices);
    if (exclusion) throw new Error(exclusion);
    if (second.pages !== 7) throw new Error('merged pages ' + second.pages);
    var after = folderSnapshot_(folder);
    var held = phase4OriginalsHeld_(before, after);
    if (held) throw new Error(held);
    var quoteLeft = false;
    for (var i = 0; i < after.length; i++) {
      if (after[i].name.indexOf('08-quote-not-invoice-he') >= 0) quoteLeft = true;
    }
    if (!quoteLeft) throw new Error('quote original is missing');

    Logger.log('testPhase4 step 5: install and remove the monthly trigger');
    hadTrigger = listMonthlyTriggers().length;
    installMonthlyTrigger();
    installedDuringTest = true;
    if (listMonthlyTriggers().length !== 1) throw new Error('trigger was not installed');
    removeMonthlyTrigger();
    installedDuringTest = false;
    if (listMonthlyTriggers().length !== 0) throw new Error('trigger was not removed');
    if (hadTrigger) {
      installMonthlyTrigger();
      installedDuringTest = true;
      leaveTrigger = true;
    }

    pass = true;
    detail = 'included=' + second.included + ' pages=' + second.pages + ' draft=' + second.draftAction + ' to=' + me;
  } catch (error) {
    pass = false;
    detail = String(error && error.message ? error.message : error);
  } finally {
    if (installedDuringTest && !leaveTrigger) {
      try {
        removeMonthlyTrigger();
      } catch (ignore) {}
    }
    if (saved.accountant_email) writeSettingValue_('accountant_email', saved.accountant_email.value);
    if (saved.owner_email) writeSettingValue_('owner_email', saved.owner_email.value);
    if (saved.month) writeSettingValue_('month', saved.month.value);
    Logger.log('testPhase4 restored accountant_email, owner_email, and month');
  }
  Logger.log('testPhase4 %s %s', pass ? 'PASS' : 'FAIL', detail);
  return { result: pass ? 'PASS' : 'FAIL', detail: detail };
}

/**
 * PASS when the menu functions exist, a second install adds nothing,
 * and the test-run draft is to the current user with no mail sent.
 */
function testPhase6() {
  var saved = {
    accountant_email: readSettingValue_('accountant_email'),
    owner_email: readSettingValue_('owner_email'),
    month: readSettingValue_('month')
  };
  var detail = '';
  var pass = false;
  try {
    var me = activeTestEmail_();
    if (!me) throw new Error('no user email for the draft');
    Logger.log('testPhase6 step 1: menu functions');
    var items = collectorMenuItems();
    var expected = ['install', 'runThisMonth', 'testRun', 'turnMonthlyTriggerOn', 'turnMonthlyTriggerOff'];
    for (var i = 0; i < expected.length; i++) {
      if (!items[i] || items[i].fn !== expected[i]) throw new Error('menu slot ' + i + ' is wrong');
      if (typeof menuFunction_(expected[i]) !== 'function') throw new Error(expected[i] + ' is missing');
    }
    if (typeof onOpen !== 'function') throw new Error('onOpen is missing');

    if (!isInstallEmail_(saved.owner_email && saved.owner_email.value)) writeInstallEmail_('owner_email', me);
    if (!isInstallEmail_(saved.accountant_email && saved.accountant_email.value)) {
      writeInstallEmail_('accountant_email', me);
    }

    Logger.log('testPhase6 step 2: install twice');
    var foldersBefore = invoicesRootCount_();
    var first = install();
    var second = install();
    if (second.prompted.length) throw new Error('second install asked for ' + second.prompted.join(', '));
    if (invoicesRootCount_() !== Math.max(foldersBefore, 1)) throw new Error('Invoices folder count changed');
    if (second.folder.created) throw new Error('second install created a folder');
    for (var n = 0; n < second.labels.length; n++) {
      if (second.labels[n].created) throw new Error('second install created ' + second.labels[n].name);
    }
    if (second.trigger.action !== 'kept') throw new Error('second install added a menu trigger');
    if (!first.url || first.url !== second.url) throw new Error('install url changed');

    var month = FIXTURE_EXPECTED.month;
    writeSettingValue_('month', month);
    Logger.log('testPhase6 step 3: test run draft to %s', me);
    var sentPack = sentCount_('Invoices ' + month);
    var sentError = sentCount_('Invoice Collector failed ' + month);
    var folder = DriveApp.getFolderById(getConfig().invoices_folder_id);
    var officialName = month + '_merged.pdf';
    var officialBefore = fileStamp_(folder, officialName);
    var accountantBefore = String(getConfig().accountant_email || '');
    var result = testRun();
    if (result.documents > 3) throw new Error('test run used ' + result.documents + ' documents');
    if (result.pdfName !== testRunPdfName(month)) throw new Error('test pdf is ' + result.pdfName);
    if (String(result.draftTo || '').toLowerCase().indexOf(me.toLowerCase()) < 0) {
      throw new Error('draft went to ' + result.draftTo);
    }
    if (String(getConfig().accountant_email || '') !== accountantBefore) {
      throw new Error('accountant_email was not restored');
    }
    var message = GmailApp.getDraft(result.draftId).getMessage();
    if (String(message.getTo() || '').toLowerCase().indexOf(me.toLowerCase()) < 0) {
      throw new Error('draft To is ' + message.getTo());
    }
    if (sentCount_('Invoices ' + month) !== sentPack) throw new Error('a pack mail was sent');
    if (sentCount_('Invoice Collector failed ' + month) !== sentError) throw new Error('an error mail was sent');
    var officialAfter = fileStamp_(folder, officialName);
    if (officialBefore.id !== officialAfter.id || officialBefore.size !== officialAfter.size) {
      throw new Error('monthly pdf changed');
    }

    pass = true;
    detail = 'install=kept documents=' + result.documents + ' draft=' + result.draftAction + ' to=' + me;
  } catch (error) {
    pass = false;
    detail = String(error && error.message ? error.message : error);
  } finally {
    if (saved.accountant_email) writeSettingValue_('accountant_email', saved.accountant_email.value);
    if (saved.owner_email) writeSettingValue_('owner_email', saved.owner_email.value);
    if (saved.month) writeSettingValue_('month', saved.month.value);
    Logger.log('testPhase6 restored accountant_email, owner_email, and month');
  }
  Logger.log('testPhase6 %s %s', pass ? 'PASS' : 'FAIL', detail);
  return { result: pass ? 'PASS' : 'FAIL', detail: detail };
}

function menuFunction_(name) {
  if (name === 'install') return install;
  if (name === 'runThisMonth') return runThisMonth;
  if (name === 'testRun') return testRun;
  if (name === 'turnMonthlyTriggerOn') return turnMonthlyTriggerOn;
  if (name === 'turnMonthlyTriggerOff') return turnMonthlyTriggerOff;
  return null;
}

function invoicesRootCount_() {
  var count = 0;
  var found = DriveApp.getRootFolder().getFoldersByName(INSTALL_FOLDER_NAME);
  while (found.hasNext()) {
    found.next();
    count++;
  }
  return count;
}

function fileStamp_(folder, name) {
  var found = folder.getFilesByName(name);
  if (!found.hasNext()) return { id: '', size: 0 };
  var file = found.next();
  return { id: file.getId(), size: file.getSize() };
}

function testAllSoFar() {
  var rows = [
    runTaskCheck_('0.2', checkConfigKeys_),
    runTaskCheck_('1.1', checkFixtureMessages_),
    runTaskCheck_('1.2', checkMonthFiles_),
    runTaskCheck_('1.3', checkSecondRun_),
    testResumeFlowResult_(),
    testOcrResult_(),
    testExtractResult_(),
    testValidationResult_(),
    testPhase2Result_(),
    testAccuracyResult_(),
    testPhase4Result_(),
    testPhase6Result_()
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

function testValidationResult_() {
  Logger.log('testAllSoFar step 2.3: testValidation');
  var validation = testValidation();
  return { task: '2.3', result: validation.result, detail: validation.detail };
}

function testPhase2Result_() {
  Logger.log('testAllSoFar step 2.4: testPhase2');
  var phase = testPhase2();
  return { task: '2.4', result: phase.result, detail: phase.detail };
}

function testAccuracyResult_() {
  Logger.log('testAllSoFar step 3.2: testAccuracy');
  var accuracy = testAccuracy();
  return { task: '3.2', result: accuracy.result, detail: accuracy.detail };
}

function testPhase4Result_() {
  Logger.log('testAllSoFar step 4: testPhase4');
  var phase = testPhase4();
  return { task: '4', result: phase.result, detail: phase.detail };
}

function testPhase6Result_() {
  Logger.log('testAllSoFar step 6: testPhase6');
  var phase = testPhase6();
  return { task: '6', result: phase.result, detail: phase.detail };
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
  var names = [];
  var files = folder.getFiles();
  while (files.hasNext()) names.push(files.next().getName());
  var count = countFixtureMonthFiles(names);
  if (count !== 8) throw new Error('found ' + count + ' fixture files in Invoices/2026-11');
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
