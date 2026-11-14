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

test('batch size 3 resumes through the eight fixtures', () => {
  const items = fixtures([false, false, false, false, false, false, false, false]);
  const first = sheet.planBatch(items, '', 3);
  assert.deepEqual(first.batch.map((row) => row.index), [0, 1, 2]);
  assert.equal(first.nextCursor, '3');
  assert.equal(first.done, false);

  const second = sheet.planBatch(items, first.nextCursor, 3);
  assert.deepEqual(second.batch.map((row) => row.index), [3, 4, 5]);
  assert.equal(second.nextCursor, '6');

  const third = sheet.planBatch(items, second.nextCursor, 3);
  assert.deepEqual(third.batch.map((row) => row.index), [6, 7]);
  assert.equal(third.nextCursor, '');
  assert.equal(third.done, true);

  const done = sheet.planBatch(fixtures([true, true, true, true, true, true, true, true]), '', 3);
  assert.deepEqual(done.batch, []);
  assert.equal(done.done, true);
  assert.equal(done.nextCursor, '');
});

test('a finished cursor does not reprocess, and a stale cursor restarts', () => {
  const labeled = fixtures([true, true, true, true, true, true, true, true]);
  assert.equal(sheet.planBatch(labeled, '6', 3).done, true);

  const tail = fixtures([false, false, false, false, false, false, false, false]);
  const resumed = sheet.planBatch(tail, '6', 3);
  assert.deepEqual(resumed.batch.map((row) => row.index), [6, 7]);
  assert.equal(resumed.done, true);
  assert.equal(resumed.nextCursor, '');

  const earlier = fixtures([false, false, false, true, true, true, true, true]);
  const fromStart = sheet.planBatch(earlier, '6', 3);
  assert.deepEqual(fromStart.batch.map((row) => row.index), [0, 1, 2]);
  assert.equal(fromStart.nextCursor, '');
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
    cursor: '3'
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
    '3'
  ]);
  assert.equal(row.length, config.RUN_LOG_HEADERS.length);
  assert.equal(sheet.resumeCursor({ status: 'partial', cursor: '3' }), 3);
  assert.equal(sheet.resumeCursor({ status: 'running', cursor: 6 }), 6);
  assert.equal(sheet.resumeCursor({ status: 'error', cursor: '4' }), 4);
  assert.equal(sheet.resumeCursor({ status: 'ok', cursor: '8' }), 0);
  assert.equal(sheet.resumeCursor(null), 0);
  assert.equal(sheet.parseCursor(''), 0);
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
  assert.match(source, /planBatch\(/);
  assert.match(source, /beginRunLog_\(/);
  assert.match(source, /collectRunTotals\(0, \[\]\)/);
  assert.match(clear, /clearCollectCursor_\(\)/);
  assert.equal(source.includes('GmailApp.search'), false);
  assert.equal(source.includes('has:attachment'), false);
});
