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
