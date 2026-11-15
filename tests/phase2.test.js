const test = require('node:test');
const assert = require('node:assert/strict');
const phase = require('../src/dev/testInvoices.js');

test('phase 2 passes at 80% only when every miss is REVIEW', () => {
  assert.equal(phase.phase2Passes_(71, 88, ['REVIEW', 'REVIEW', 'REVIEW']), true);
  assert.equal(phase.phase2Passes_(88, 88, []), true);
  assert.equal(phase.phase2Passes_(70, 88, ['REVIEW']), false);
  assert.equal(phase.phase2Passes_(80, 88, ['OK']), false);
  assert.equal(phase.phase2Passes_(80, 88, ['NOT_INVOICE']), false);
});
