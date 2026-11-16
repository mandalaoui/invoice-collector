const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const gmail = require('../src/gmail.js');
const dev = require('../src/dev/sendTestFixtures.js');

const expected = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'expected.json'), 'utf8')
);
const subjects = expected.documents.map((doc) => doc.email.subject);

test('month window covers the month and excludes the surrounding days', () => {
  assert.deepEqual(gmail.gmailMonthBounds('2026-11'), {
    after: '2026/10/31',
    before: '2026/12/01'
  });
  assert.deepEqual(gmail.gmailMonthBounds('2026-01'), {
    after: '2025/12/31',
    before: '2026/02/01'
  });
  assert.deepEqual(gmail.gmailMonthBounds('2024-03'), {
    after: '2024/02/29',
    before: '2024/04/01'
  });
});

test('a blank month is the previous calendar month', () => {
  assert.equal(gmail.resolveCollectMonth('', '2026-11-14'), '2026-10');
  assert.equal(gmail.resolveCollectMonth('  ', '2026-01-01'), '2025-12');
  assert.equal(gmail.resolveCollectMonth('2026-11', '2026-11-14'), '2026-11');
  assert.throws(() => gmail.resolveCollectMonth('2026-13', '2026-11-14'), /YYYY-MM/);
  assert.throws(() => gmail.resolveCollectMonth('', '14/11/2026'), /YYYY-MM-DD/);
});

test('collect queries use each Settings search, the vendor list, and skip processed', () => {
  const plan = gmail.buildCollectQueries({
    month: '2026-11',
    today: '2026-11-14',
    processed_label: 'invoices/processed',
    search_queries: [
      'has:attachment (חשבונית OR קבלה OR invoice OR receipt)',
      'subject:receipt'
    ],
    vendor_whitelist: ['billing@cafe-carmel.example', 'northwind-ledger.example']
  });
  assert.equal(plan.month, '2026-11');
  assert.equal(plan.queries.length, 3);
  assert.match(plan.queries[0], /^\(has:attachment \(חשבונית OR קבלה OR invoice OR receipt\)\) /);
  assert.match(plan.queries[1], /^\(subject:receipt\) /);
  assert.equal(
    plan.queries[2],
    'from:(billing@cafe-carmel.example OR northwind-ledger.example) after:2026/10/31 before:2026/12/01 -label:invoices-processed'
  );
  plan.queries.forEach((query) => {
    assert.match(query, /after:2026\/10\/31 before:2026\/12\/01 -label:invoices-processed$/);
  });
});

test('client query builder keeps Settings text and does not add fixture filters', () => {
  const settings = require('../src/config.js');
  const searchField = settings.SETTINGS_FIELDS.find((field) => field.key === 'search_queries');
  const lines = searchField.value.split('\n').map((line) => line.trim()).filter(Boolean);
  assert.deepEqual(lines, [
    'has:attachment (חשבונית OR קבלה OR invoice OR receipt)',
    '(חשבונית OR קבלה OR invoice OR receipt OR "סה\\"כ לתשלום" OR "total due" OR "amount due")',
    'has:attachment (filename:pdf OR filename:jpg OR filename:png)'
  ]);
  assert.equal(lines[1].includes('has:attachment'), false);
  const plan = gmail.buildCollectQueries({
    month: '2026-11',
    today: '2026-11-16',
    processed_label: 'invoices/processed',
    search_queries: lines,
    vendor_whitelist: []
  });
  const query =
    '(has:attachment (חשבונית OR קבלה OR invoice OR receipt)) after:2026/10/31 before:2026/12/01 -label:invoices-processed';
  assert.equal(plan.queries.length, 3);
  assert.equal(plan.queries[0], query);
  assert.equal(plan.queries[1].includes('has:attachment'), false);
  assert.match(plan.queries[2], /^\(has:attachment \(filename:pdf OR filename:jpg OR filename:png\)\) /);
  assert.equal(gmail.formatGmailQueryLog(query, 1), 'gmail query=' + query + ' count=1');
  assert.equal(plan.queries[0].includes('from:me'), false);
  const coverage = gmail.formatRunCoverage([4, 2, 9], { 'outside month': 1, 'processed label': 2 }, 11);
  assert.equal(
    coverage,
    'candidates q1=4 q2=2 q3=9; scanned 11; skipped 3 (outside month=1, processed label=2)'
  );
  const skips = gmail.partitionCollectMessages(
    [
      { id: 'old', subject: 'note', dateYmd: '2026-10-02', labelNames: [] },
      { id: 'done', subject: 'note', dateYmd: '2026-11-02', labelNames: ['invoices/processed'] },
      { id: 'done', subject: 'note', dateYmd: '2026-11-02', labelNames: [] },
      { id: 'ok', subject: 'note', dateYmd: '2026-11-03', labelNames: [] }
    ],
    { month: '2026-11', processedLabel: 'invoices/processed' }
  );
  assert.deepEqual(skips.kept.map((row) => row.id), ['ok']);
  assert.equal(skips.skipped['outside month'], 1);
  assert.equal(skips.skipped['processed label'], 1);
  assert.equal(skips.skipped.duplicate, 1);
  assert.equal(plan.queries[0].includes('in:anywhere'), false);
  subjects.forEach((subject) => {
    assert.equal(plan.queries[0].includes(subject), false);
  });
  const casual = gmail.buildCollectQueries({
    month: '2026-11',
    today: '2026-11-16',
    processed_label: 'invoices/processed',
    search_queries: ['subject:היי'],
    vendor_whitelist: []
  });
  assert.deepEqual(casual.queries, [
    '(subject:היי) after:2026/10/31 before:2026/12/01 -label:invoices-processed'
  ]);
  const kept = gmail.selectCollectMessages(
    [{ id: 'm1', subject: 'היי', dateYmd: '2026-11-16', labelNames: [], from: 'Accounts <accounts@vendor.example>' }],
    { month: '2026-11', processedLabel: 'invoices/processed' }
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0].subject, 'היי');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'gmail.js'), 'utf8');
  const clientSearch = source.slice(
    source.indexOf('function readClientMessages'),
    source.indexOf('function labelClientThreads')
  );
  assert.equal(clientSearch.includes('assertFixtureQueries_'), false);
  assert.equal(clientSearch.includes('fixtureSubjects_'), false);
  assert.equal(clientSearch.includes('allowedSubjects'), false);
  assert.equal(clientSearch.includes('from:me'), false);
});

test('empty Settings searches do not search the mailbox', () => {
  const plan = gmail.buildCollectQueries({
    month: '2026-11',
    today: '2026-11-14',
    processed_label: 'invoices/processed',
    search_queries: ['  '],
    vendor_whitelist: []
  });
  assert.deepEqual(plan.queries, []);
});

test('a label with spaces is quoted and a nested label uses a hyphen', () => {
  assert.equal(gmail.labelSearchName('invoices/processed'), 'invoices-processed');
  assert.equal(gmail.excludeProcessedTerm('needs review'), '-label:needs-review');
  assert.equal(gmail.excludeProcessedTerm('חשבוניות/טופל'), '-label:"חשבוניות-טופל"');
});

test('fixture search is from:me plus the eight subjects, not the inbox query', () => {
  assert.deepEqual(subjects, dev.TEST_FIXTURE_MESSAGES.map((message) => message.subject));
  const plan = gmail.buildFixtureSearchQueries(subjects, {
    month: '',
    today: '2026-12-02',
    processed_label: 'invoices/processed',
    search_queries: ['has:attachment (חשבונית OR invoice OR receipt)']
  });
  assert.equal(plan.month, '2026-11');
  assert.equal(plan.queries.length, 1);
  const query = plan.queries[0];
  assert.match(query, /^in:anywhere from:me \(/);
  assert.match(query, /after:2026\/10\/31 before:2026\/12\/01 -label:invoices-processed$/);
  assert.equal(query.includes('has:attachment'), false);
  subjects.forEach((subject) => {
    assert.equal(query.includes('subject:"' + subject + '"'), true);
  });
  assert.throws(
    () => gmail.buildFixtureSearchQueries(subjects.slice(0, 7), {
      month: '2026-11',
      today: '2026-11-14'
    }),
    /8 test subjects/
  );
  assert.throws(
    () => gmail.assertFixtureQueries_(['has:attachment invoice from:me'], subjects),
    /inbox-wide/
  );
});

test('selection keeps the fixture month, skips processed mail, and drops anything else', () => {
  const selected = gmail.selectCollectMessages(
    [
      { id: 'other', subject: 'Your bank statement', dateYmd: '2026-11-02', labelNames: [], from: 'bank@example.com' },
      { id: 'dup', subject: subjects[1], dateYmd: '2026-11-03', labelNames: [], from: 'me' },
      { id: 'old', subject: subjects[0], dateYmd: '2026-10-31', labelNames: [], from: 'me' },
      { id: 'done', subject: subjects[2], dateYmd: '2026-11-05', labelNames: ['invoices/processed'], from: 'me' },
      { id: 'dup', subject: subjects[1], dateYmd: '2026-11-03', labelNames: [], from: 'me' },
      { id: 'ok-late', subject: subjects[7], dateYmd: '2026-11-12', labelNames: ['inbox'], from: 'me' },
      { id: 'ok-early', subject: subjects[0], dateYmd: '2026-11-02', labelNames: [], from: 'me' },
      { id: 'hyphen-label', subject: subjects[3], dateYmd: '2026-11-06', labelNames: ['invoices-processed'], from: 'me' },
      { id: 'no-date', subject: subjects[4], dateYmd: '', labelNames: [], from: 'me' }
    ],
    {
      month: '2026-11',
      processedLabel: 'invoices/processed',
      allowedSubjects: subjects
    }
  );
  assert.deepEqual(
    selected.map((message) => message.id),
    ['ok-early', 'dup', 'ok-late']
  );
});

test('a processed fixture is skipped, and the clear search can still see it', () => {
  const candidates = subjects.map((subject, index) => ({
    id: 'id' + index,
    threadId: 'th' + index,
    subject: subject,
    dateYmd: '2026-11-02',
    labelNames: ['invoices/processed']
  }));
  const skipped = gmail.selectCollectMessages(candidates, {
    month: '2026-11',
    processedLabel: 'invoices/processed',
    allowedSubjects: subjects
  });
  assert.equal(skipped.length, 0);
  const found = gmail.selectCollectMessages(candidates, {
    month: '2026-11',
    processedLabel: 'invoices/processed',
    allowedSubjects: subjects,
    includeProcessed: true
  });
  assert.equal(found.length, 8);

  const plan = gmail.buildFixtureSearchQueries(subjects, {
    month: '2026-11',
    today: '2026-11-14',
    processed_label: 'invoices/processed',
    includeProcessed: true
  });
  assert.equal(plan.queries[0].includes('-label:'), false);
  assert.match(plan.queries[0], /^in:anywhere from:me \(/);
  subjects.forEach((subject) => {
    assert.equal(plan.queries[0].includes('subject:"' + subject + '"'), true);
  });
});

test('a second run processes no messages and creates no files', () => {
  const first = gmail.collectRunTotals(8, subjects.map(() => ({ created: true })));
  assert.deepEqual(first, { processed: 8, created: 8 });
  const kept = gmail.collectRunTotals(8, subjects.map(() => ({ created: false })));
  assert.deepEqual(kept, { processed: 8, created: 0 });
  assert.deepEqual(gmail.collectRunTotals(0, []), { processed: 0, created: 0 });
});

test('labels are planned only for fixture threads', () => {
  const messages = subjects.map((subject, index) => ({
    threadId: 'th' + index,
    subject: subject
  }));
  messages.push({ threadId: 'th0', subject: subjects[0] });
  const plan = gmail.planProcessedLabels(messages, subjects, 'invoices/processed');
  assert.equal(plan.length, 8);
  assert.equal(plan[0].messageCount, 2);
  assert.equal(plan[0].label, 'invoices/processed');
  assert.throws(
    () => gmail.planProcessedLabels(
      [{ threadId: 'x', subject: 'Your bank statement' }],
      subjects,
      'invoices/processed'
    ),
    /not one of the 8 fixtures/
  );
  assert.throws(
    () => gmail.planProcessedLabels([{ subject: subjects[0] }], subjects, 'invoices/processed'),
    /thread id/
  );
});

test('the label helper only lists the fixtures and the save labels them', () => {
  const root = path.join(__dirname, '..', 'src', 'dev');
  const clear = fs.readFileSync(path.join(root, 'clearTestFixtureLabels.js'), 'utf8');
  const save = fs.readFileSync(path.join(root, 'saveTestFixtures.js'), 'utf8');
  assert.match(clear, /listTestFixtureMessages\(\{ includeProcessed: true \}\)/);
  assert.match(clear, /removeProcessedLabel\(/);
  assert.equal(clear.includes('GmailApp.search'), false);
  assert.equal(clear.includes('has:attachment'), false);
  assert.match(save, /applyProcessedLabel\(/);
  assert.match(save, /collectRunTotals\(0, \[\]\)/);
  assert.equal(save.includes('GmailApp.search'), false);
});
