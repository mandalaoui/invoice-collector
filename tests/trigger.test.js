const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = require('../src/main.js');

test('the monthly trigger is day 2 at 08:00 and error mail goes to the owner only', () => {
  assert.deepEqual(main.monthlyTriggerSpec(), { handler: 'runMonthlyJob', day: 2, hour: 8 });
  assert.equal(main.ownerErrorRecipient(''), '');
  assert.equal(main.ownerErrorRecipient('not-an-email'), '');
  assert.equal(main.ownerErrorRecipient(' owner@example.com '), 'owner@example.com');
  const mail = main.buildOwnerErrorMail(new Error('folder missing'), '2026-11');
  assert.equal(mail.subject, 'Invoice Collector failed 2026-11');
  assert.ok(mail.body.indexOf('folder missing') >= 0);
  assert.equal(mail.body.indexOf('http'), -1);

  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const draft = fs.readFileSync(path.join(__dirname, '..', 'src', 'draft.js'), 'utf8');
  assert.equal(draft.indexOf('sendEmail'), -1);
  const sends = source.match(/sendEmail/g) || [];
  assert.equal(sends.length, 1);
  assert.ok(source.indexOf('GmailApp.sendEmail(to, mail.subject, mail.body)') >= 0);
  assert.ok(source.indexOf('.onMonthDay(spec.day).atHour(spec.hour)') >= 0);
});
