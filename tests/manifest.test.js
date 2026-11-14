const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('Apps Script manifest is V8 in Asia/Jerusalem', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'src', 'appsscript.json'), 'utf8')
  );
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.equal(manifest.timeZone, 'Asia/Jerusalem');
});

test('task 0.1 directories exist', () => {
  for (const dir of ['src', 'tests/fixtures', 'worker']) {
    assert.equal(fs.statSync(path.join(root, dir)).isDirectory(), true);
  }
});
