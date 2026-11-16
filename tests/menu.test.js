const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const menu = require('../src/menu.js');
const report = require('../src/report.js');

test('the sheet menu exposes install, run, test, and the trigger', () => {
  const items = menu.collectorMenuItems();
  assert.deepEqual(
    items.map((item) => item.fn),
    ['install', 'runThisMonth', 'testRun', 'turnMonthlyTriggerOn', 'turnMonthlyTriggerOff', 'exportOcrText', 'resetMonth']
  );
  assert.equal(items[5].label, 'Export OCR text');
  assert.equal(items[6].label, 'Reset month (re-run)');
  assert.equal(
    menu.resetMonthConfirmText('2026-11', 'invoices/processed', 'invoices/review'),
    "Reset 2026-11? This removes the invoices/processed and invoices/review labels and deletes this month's Invoices rows. Drive files and Gmail messages are not changed."
  );
  assert.equal(menu.exportOcrFolderName('2026-11'), 'ocr-text-2026-11');
  assert.equal(items[0].label, 'Install');
  assert.equal(items[2].label, 'Test run (draft to me)');
});

test('a test run keeps at most 3 rows and does not replace the monthly pdf', () => {
  assert.equal(menu.testRunBatchSize(), 3);
  assert.equal(menu.limitRows_([1, 2, 3, 4], 3).length, 3);
  assert.equal(menu.testRunPdfName('2026-11'), '__test_run_2026-11.pdf');
  assert.notEqual(menu.testRunPdfName('2026-11'), report.mergedPdfName('2026-11'));
});

test('the menu file does not send mail', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'menu.js'), 'utf8');
  assert.equal(source.includes('sendEmail'), false);
  assert.equal(source.includes('MailApp'), false);
});

test('reset month asks first and does not change Drive files or Gmail content', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'menu.js'), 'utf8');
  const reset = source.slice(source.indexOf('function resetMonth()'), source.indexOf('if (typeof module'));
  assert.match(reset, /if \(!confirmResetMonth_\(/);
  const confirmAt = reset.indexOf('confirmResetMonth_');
  assert.ok(confirmAt < reset.indexOf('clearMonthLabels_'));
  assert.ok(confirmAt < reset.indexOf('deleteMonthInvoiceRows_'));
  assert.ok(confirmAt < reset.indexOf('writeSearchQueriesDefault_'));
  const actions = source.slice(source.indexOf('function clearMonthLabels_'), source.indexOf('if (typeof module'));
  assert.match(actions, /removeLabel\(label\)/);
  assert.equal(actions.includes('setTrashed'), false);
  assert.equal(actions.includes('moveToTrash'), false);
  assert.equal(actions.includes('DriveApp'), false);
  assert.equal(actions.includes('deleteThread'), false);
  assert.equal(actions.includes('GmailApp'), false);
  assert.match(source, /defaultSearchQueriesValue\(\)/);
  const report = require('../src/report.js');
  assert.deepEqual(
    report.sourcesForMonthReset(
      [
        { source: 'nov#0', doc_date: '2026-11-02' },
        { source: 'nov#0', doc_date: '2026-11-02' },
        { source: 'blank', doc_date: '' },
        { source: 'oct#1', doc_date: '2026-10-30' }
      ],
      '2026-11'
    ),
    ['nov#0', 'blank']
  );
});

test('client runs search Settings queries and do not use fixture filters', () => {
  const root = path.join(__dirname, '..', 'src');
  const menuSource = fs.readFileSync(path.join(root, 'menu.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(menuSource, /collectClientMonth\(config, \{ documentLimit: testRunBatchSize\(\) \}\)/);
  assert.match(mainSource, /buildCollectQueries\(/);
  assert.match(mainSource, /readClientMessages\(/);
  assert.equal(mainSource.includes('allowedSubjects'), false);
  for (const source of [menuSource, mainSource]) {
    assert.equal(source.includes('buildFixtureSearchQueries'), false);
    assert.equal(source.includes('readFixtureMessages'), false);
    assert.equal(source.includes('assertFixtureQueries_'), false);
    assert.equal(source.includes('fixtureSubjects_'), false);
    assert.equal(source.includes('applyProcessedLabel'), false);
  }
});
