const test = require('node:test');
const assert = require('node:assert/strict');
const install = require('../src/install.js');

test('install asks only for the two emails, and only when they are empty', () => {
  assert.deepEqual(install.installPromptKeys({ owner_email: '', accountant_email: '' }), [
    'owner_email',
    'accountant_email'
  ]);
  assert.deepEqual(
    install.installPromptKeys({
      owner_email: 'owner@example.com',
      accountant_email: 'books@example.com',
      company_name: ''
    }),
    []
  );
});

test('install email prompt rejects an unknown key', () => {
  assert.throws(() => install.installEmailPrompt_('company_name'), /does not ask/);
});

test('a blank answer keeps the saved email and a bad answer is refused', () => {
  assert.equal(install.applyInstallEmail('owner@example.com', '  '), 'owner@example.com');
  assert.equal(install.applyInstallEmail('', 'books@example.com'), 'books@example.com');
  assert.throws(() => install.applyInstallEmail('owner@example.com', 'not-an-email'), /not valid/);
});

test('install labels are the Settings names, without duplicates', () => {
  assert.deepEqual(
    install.installLabelNames({
      processed_label: 'invoices/processed',
      review_label: 'invoices/review'
    }),
    ['invoices/processed', 'invoices/review']
  );
  assert.deepEqual(
    install.installLabelNames({ processed_label: 'invoices/processed', review_label: 'invoices/processed' }),
    ['invoices/processed']
  );
  assert.equal(install.INSTALL_FOLDER_NAME, 'Invoices');
});
