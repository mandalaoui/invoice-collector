const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sheet = require('../src/sheet.js');
const config = require('../src/config.js');

function fixtures(flags) {
  return flags.map((processed, index) => ({
    id: 'm' + index,
    processed: processed
  }));
}

test('labels applied between runs yield batches of 3, 3, and 2', () => {
  let remaining = fixtures([false, false, false, false, false, false, false, false]);
  const counts = [];
  const statuses = [];
  for (let run = 0; run < 4; run++) {
    const selection = sheet.fixtureRunSelection(remaining, 3);
    counts.push(selection.processed);
    statuses.push(selection.status);
    assert.equal(selection.rows.length, remaining.length);
    if (selection.idle) break;
    const doneIds = new Set(selection.batch.map((row) => row.item.id));
    remaining = remaining.map((item) => (
      doneIds.has(item.id) ? { ...item, processed: true } : item
    ));
  }
  assert.deepEqual(counts, [3, 3, 2, 0]);
  assert.deepEqual(statuses, ['partial', 'partial', 'ok', 'ok']);
  assert.equal(remaining.every((item) => item.processed), true);
});

test('the two unlabeled fixtures are saved when they are a short tail', () => {
  const tail = [
    { id: '1a1db3eb8409f450', threadId: 'thread-a', subject: 'Fixture one', processed: true },
    { id: '1a1db3eb8409f451', threadId: 'thread-b', subject: 'Fixture two', processed: true },
    { id: '1a1db3eb8409f452', threadId: 'thread-c', subject: 'Fixture three', processed: true },
    { id: '1a1db3eb8409f453', threadId: 'thread-d', subject: 'Fixture four', processed: true },
    { id: '1a1db3eb8409f454', threadId: 'thread-e', subject: 'Fixture five', processed: true },
    { id: '1a1db3eb8409f45f', threadId: 'thread-f', subject: 'Fixture six', processed: true },
    { id: '1a1db3eb8409f458', threadId: 'thread-shared', subject: 'Fixture seven', processed: false },
    { id: '1a1db3eb8409f459', threadId: 'thread-shared', subject: 'Fixture eight', processed: false }
  ];
  const run = sheet.fixtureRunSelection(tail, 3);
  assert.equal(run.idle, false);
  assert.equal(run.finishes, true);
  assert.equal(run.processed, 2);
  assert.equal(run.status, 'ok');
  assert.deepEqual(run.batch.map((row) => row.item.id), ['1a1db3eb8409f458', '1a1db3eb8409f459']);
  assert.deepEqual(
    run.rows.map((row) => [row.subject, row.threadId, row.messageId, row.hasLabel, row.decision, row.reason]),
    [
      ['Fixture one', 'thread-a', '1a1db3eb8409f450', true, 'skipped', 'has processed label'],
      ['Fixture two', 'thread-b', '1a1db3eb8409f451', true, 'skipped', 'has processed label'],
      ['Fixture three', 'thread-c', '1a1db3eb8409f452', true, 'skipped', 'has processed label'],
      ['Fixture four', 'thread-d', '1a1db3eb8409f453', true, 'skipped', 'has processed label'],
      ['Fixture five', 'thread-e', '1a1db3eb8409f454', true, 'skipped', 'has processed label'],
      ['Fixture six', 'thread-f', '1a1db3eb8409f45f', true, 'skipped', 'has processed label'],
      ['Fixture seven', 'thread-shared', '1a1db3eb8409f458', false, 'selected', 'unlabeled, within first batch_size'],
      ['Fixture eight', 'thread-shared', '1a1db3eb8409f459', false, 'selected', 'unlabeled, within first batch_size']
    ]
  );

  const cursorId = '1a1db3eb8409f45f';
  const beforeCursor = tail.filter((item) => !item.processed && item.id < cursorId);
  assert.deepEqual(beforeCursor.map((item) => item.id), ['1a1db3eb8409f458', '1a1db3eb8409f459']);
  assert.equal(sheet.planBatch(tail, 3).nextCursor, '');
  assert.deepEqual(sheet.fixtureRunSelection(tail, 3).batch.map((row) => row.item.id), beforeCursor.map((item) => item.id));

  const sibling = sheet.describeFixtureBatch([
    { id: 'kept', threadId: 'same', subject: 'Invoice A', processed: true },
    { id: 'open', threadId: 'same', subject: 'Invoice B', processed: false }
  ], 3);
  assert.deepEqual(sibling.selectedIds, ['open']);
  assert.equal(sibling.rows[0].reason, 'has processed label');
  assert.equal(sibling.rows[1].reason, 'unlabeled, within first batch_size');
  assert.equal(sibling.idle, false);

  const deferred = sheet.describeFixtureBatch([
    { id: 'first', threadId: 'same', subject: 'Invoice A', processed: false },
    { id: 'second', threadId: 'same', subject: 'Invoice B', processed: false }
  ], 1);
  assert.deepEqual(deferred.selectedIds, ['first']);
  assert.equal(deferred.rows[1].decision, 'skipped');
  assert.equal(deferred.rows[1].reason, 'unlabeled, after the first batch_size');
  assert.equal(deferred.rows[1].threadId, 'same');
});

test('the time budget stops a run before the batch is full', () => {
  assert.equal(sheet.runShouldStop(0, 0, sheet.RUN_TIME_BUDGET_MS, 0, 3), '');
  assert.equal(sheet.runShouldStop(0, sheet.RUN_TIME_BUDGET_MS, sheet.RUN_TIME_BUDGET_MS, 1, 3), 'time');
  assert.equal(sheet.RUN_TIME_BUDGET_MS < 6 * 60 * 1000, true);
  assert.equal(sheet.runShouldStop(0, 1, 60000, 3, 3), 'batch');
});

test('RunLog rows match the sheet headers and resume only from an open run', () => {
  assert.equal(config.getConfig([]).batch_size, 20);
  const row = sheet.buildRunLogRow({
    startedAt: '2026-11-15T00:00:00',
    finishedAt: '2026-11-15T00:01:00',
    mode: 'deterministic',
    messages: 3,
    files: 3,
    rows: 0,
    errors: '',
    status: 'partial',
    cursor: 'm2'
  });
  assert.deepEqual(row, [
    '2026-11-15T00:00:00',
    '2026-11-15T00:01:00',
    'deterministic',
    3,
    3,
    0,
    '',
    'partial',
    'm2'
  ]);
  assert.equal(row.length, config.RUN_LOG_HEADERS.length);
  assert.equal(sheet.resumeCursor({ status: 'ok', cursor: 'm8' }), '');
  assert.equal(sheet.resumeCursor(null), '');
});

test('the dev save logs a batch and does not search the mailbox', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'dev', 'saveTestFixtures.js'),
    'utf8'
  );
  const clear = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'dev', 'clearTestFixtureLabels.js'),
    'utf8'
  );
  assert.match(source, /listTestFixtureMessages\(\{ includeProcessed: true \}\)/);
  assert.match(source, /fixtureRunSelection\(listed\.messages, batchSize\)/);
  assert.match(source, /if \(selection\.idle\)/);
  assert.match(source, /subject=%s threadId=%s messageId=%s hasLabel=%s decision=%s reason=%s/);
  assert.equal(source.includes('loadCollectCursor_'), false);
  assert.equal(source.includes('saveCollectCursor_'), false);
  assert.match(source, /beginRunLog_\(/);
  assert.match(source, /collectRunTotals\(0, \[\]\)/);
  assert.match(clear, /clearCollectCursor_\(\)/);
  assert.equal(source.includes('GmailApp.search'), false);
  assert.equal(source.includes('has:attachment'), false);
});

test('invoice rows are written once per message and a repeated document is DUPLICATE', () => {
  global.INVOICE_HEADERS = config.INVOICE_HEADERS;
  const first = { source: 'm1 01-tax', vendor_id: '990100018', doc_number: '10482', status: 'OK', total: 1003 };
  const again = { source: 'm1 01-tax', vendor_id: '990100018', doc_number: '10482', status: 'OK', total: 1003 };
  const other = { source: 'm9 01-tax', vendor_id: '990100018', doc_number: '10482', status: 'OK', total: 1003 };
  assert.equal(sheet.planInvoiceRows([], [first, again]).length, 1);
  assert.equal(sheet.planInvoiceRows([first], [again]).length, 0);
  const duplicate = sheet.planInvoiceRows([], [first, other]);
  assert.equal(duplicate.length, 2);
  assert.equal(duplicate[1].status, 'DUPLICATE');
  assert.equal(sheet.buildInvoiceRow(first).length, config.INVOICE_HEADERS.length);
  assert.equal(sheet.invoiceSourceId('m1 01-tax'), 'm1');
});

test('doc_date is written as one Date with yyyy-mm-dd', () => {
  global.INVOICE_HEADERS = config.INVOICE_HEADERS;
  const fromDmy = sheet.sheetDateValue('02/11/2026');
  const fromIso = sheet.sheetDateValue('2026-11-02');
  assert.equal(Object.prototype.toString.call(fromDmy), '[object Date]');
  assert.equal(fromDmy.getFullYear(), 2026);
  assert.equal(fromDmy.getMonth(), 10);
  assert.equal(fromDmy.getDate(), 2);
  assert.equal(fromDmy.getTime(), fromIso.getTime());
  const column = config.INVOICE_HEADERS.indexOf('doc_date');
  const row = sheet.buildInvoiceRow({ doc_date: '02/11/2026' });
  assert.equal(row[column].getTime(), fromIso.getTime());
  assert.equal(sheet.invoiceNumberFormat('doc_date'), 'yyyy-mm-dd');
  assert.equal(sheet.buildInvoiceRow({ doc_date: '' })[column], '');
});
