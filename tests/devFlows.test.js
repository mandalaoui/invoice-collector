const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const flows = require('../src/dev/testFlows.js');

test('resume counts are 3, 3, 2, then 0', () => {
  assert.equal(flows.resumeFlowPasses_([3, 3, 2, 0]), true);
  assert.equal(flows.resumeFlowPasses_([3, 3, 0, 0]), false);
  assert.equal(flows.resumeFlowPasses_([3, 3, 2]), false);
  assert.equal(flows.resumeFlowPasses_([]), false);
});

test('the suite fails when any task fails', () => {
  assert.deepEqual(
    flows.summarizeTaskResults_([
      { task: '0.2', result: 'PASS' },
      { task: '1.4', result: 'FAIL' }
    ]),
    { result: 'FAIL', failed: ['1.4'] }
  );
  assert.equal(
    flows.summarizeTaskResults_([
      { task: '0.2', result: 'PASS' },
      { task: '1.1', result: 'PASS' }
    ]).result,
    'PASS'
  );
});

test('dev checks stay on the fixture helpers and restore batch size', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'dev', 'testFlows.js'), 'utf8');
  const agents = fs.readFileSync(path.join(__dirname, '..', 'AGENTS.md'), 'utf8');
  assert.match(source, /function testResumeFlow\(/);
  assert.match(source, /function testAllSoFar\(/);
  assert.match(source, /writeSettingValue_\('batch_size', previous\.value\)/);
  assert.match(source, /clearTestFixtureLabels\(/);
  assert.match(source, /listTestFixtureMessages\(\{ includeProcessed: true \}\)/);
  assert.equal(source.includes('GmailApp.search'), false);
  assert.equal(source.includes('has:attachment'), false);
  assert.match(agents, /test<TaskName>\(\)/);
  assert.match(agents, /Never run `clasp push`|Run `clasp push`/);
});
