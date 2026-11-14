const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const micromatch = require('micromatch');

const root = path.join(__dirname, '..');
const dev = require('../src/dev/sendTestFixtures.js');
const expected = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'expected.json'), 'utf8')
);

function ignorePatterns(fileName) {
  return fs.readFileSync(path.join(root, fileName), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function filesKept(patterns) {
  const files = [
    'appsscript.json',
    'config.js',
    'main.js',
    'setup.js',
    'dev/sendTestFixtures.js'
  ];
  return micromatch.not(files, patterns, { dot: true });
}

test('fixture messages match the answer key', () => {
  assert.equal(dev.TEST_FIXTURE_MESSAGES.length, 8);
  assert.equal(dev.TEST_FIXTURES_FOLDER_PROPERTY, 'TEST_FIXTURES_FOLDER_ID');
  assert.equal(expected.documents.length, dev.TEST_FIXTURE_MESSAGES.length);
  expected.documents.forEach((doc, index) => {
    const message = dev.TEST_FIXTURE_MESSAGES[index];
    assert.equal(message.file, doc.file);
    assert.equal(message.kind, doc.kind);
    assert.equal(message.fromName, doc.email.from_name);
    assert.equal(message.replyTo, doc.email.reply_to);
    assert.equal(message.subject, doc.email.subject);
    assert.equal(message.body, doc.email.body);
    assert.ok(message.replyTo.endsWith('.example'));
  });
  assert.equal(dev.TEST_FIXTURE_MESSAGES[5].kind, 'html');
});

test('html fixture is the message body and the others are attachments', () => {
  const html = dev.fixtureSendOptions(dev.TEST_FIXTURE_MESSAGES[5], {
    getDataAsString: () => '<html lang="he" dir="rtl"></html>',
    setName: () => {}
  });
  assert.match(html.htmlBody, /dir="rtl"/);
  assert.equal(html.attachments, undefined);
  assert.equal(html.replyTo, 'billing@net-gader.example');

  let attachedName = '';
  const pdf = dev.fixtureSendOptions(dev.TEST_FIXTURE_MESSAGES[0], {
    getDataAsString: () => '',
    setName: (name) => {
      attachedName = name;
    }
  });
  assert.equal(pdf.htmlBody, undefined);
  assert.equal(pdf.attachments.length, 1);
  assert.equal(attachedName, '01-tax-invoice-receipt-he.pdf');
});

test('a second run skips subjects already in the mailbox', () => {
  const names = dev.TEST_FIXTURE_MESSAGES.map((message) => message.file);
  const first = dev.planTestFixtureSends(dev.TEST_FIXTURE_MESSAGES, names, []);
  assert.equal(first.missing.length, 0);
  assert.equal(first.toSend.length, 8);

  const again = dev.planTestFixtureSends(
    dev.TEST_FIXTURE_MESSAGES,
    names,
    [dev.TEST_FIXTURE_MESSAGES[0].subject]
  );
  assert.equal(again.toSend.length, 7);
  assert.deepEqual(again.skipped, [dev.TEST_FIXTURE_MESSAGES[0].subject]);

  const missing = dev.planTestFixtureSends(dev.TEST_FIXTURE_MESSAGES, names.slice(1), []);
  assert.deepEqual(missing.missing, ['01-tax-invoice-receipt-he.pdf']);
  assert.equal(missing.toSend.length, 7);
});

test('subject search quotes the fixture subject', () => {
  const query = dev.gmailSubjectQuery('חשבונית מס 7712 לחודש נובמבר 2026');
  assert.equal(query, 'in:anywhere subject:"חשבונית מס 7712 לחודש נובמבר 2026"');
});

test('client clasp push excludes src/dev and the dev push includes it', () => {
  const client = filesKept(ignorePatterns('.claspignore'));
  const devPush = filesKept(ignorePatterns('.claspignore.dev'));
  assert.deepEqual(client.sort(), ['appsscript.json', 'config.js', 'main.js', 'setup.js']);
  assert.ok(devPush.indexOf('dev/sendTestFixtures.js') !== -1);
  assert.ok(devPush.indexOf('config.js') !== -1);
});
