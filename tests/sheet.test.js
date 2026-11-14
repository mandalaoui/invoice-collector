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
  const cursors = [];
  for (let run = 0; run < 4; run++) {
    const plan = sheet.planBatch(remaining, 3);
    counts.push(plan.batch.length);
    cursors.push(plan.nextCursor);
    if (!plan.batch.length) break;
    const doneIds = new Set(plan.batch.map((row) => row.item.id));
    remaining = remaining.filter((item) => !doneIds.has(item.id));
  }
  assert.deepEqual(counts, [3, 3, 2, 0]);
  assert.deepEqual(cursors, ['m2', 'm5', '', '']);
  assert.equal(remaining.length, 0);
});

test('a stale index cursor does not skip the unlabeled tail', () => {
  const labeled = fixtures([true, true, true, true, true, true, false, false]);
  const tail = sheet.planBatch(labeled, 3);
  assert.deepEqual(tail.batch.map((row) => row.item.id), ['m6', 'm7']);
  assert.equal(tail.done, true);
  assert.equal(tail.nextCursor, '');
  assert.equal(sheet.resumeCursor({ status: 'partial', cursor: '6' }), '');
  assert.equal(sheet.resumeCursor({ status: 'partial', cursor: 'm6' }), 'm6');
  assert.equal(sheet.planBatch(fixtures([true, true, true, true, true, true, true, true]), 3).done, true);
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
  assert.match(source, /planBatch\(listed\.messages, batchSize\)/);
  assert.equal(source.includes('loadCollectCursor_'), false);
  assert.match(source, /beginRunLog_\(/);
  assert.match(source, /collectRunTotals\(0, \[\]\)/);
  assert.match(clear, /clearCollectCursor_\(\)/);
  assert.equal(source.includes('GmailApp.search'), false);
  assert.equal(source.includes('has:attachment'), false);
});
