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

test('manifest can open Docs and still use Drive', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'src', 'appsscript.json'), 'utf8')
  );
  const scopes = manifest.oauthScopes;
  assert.ok(Array.isArray(scopes));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/documents'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/drive'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/spreadsheets'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/gmail.modify'));
  const drive = manifest.dependencies.enabledAdvancedServices.find(
    (service) => service.serviceId === 'drive'
  );
  assert.equal(drive.userSymbol, 'Drive');
  assert.equal(drive.version, 'v2');
});

test('production clasp push excludes src/dev', () => {
  const ignore = fs.readFileSync(path.join(root, '.claspignore'), 'utf8');
  assert.match(ignore, /^dev\/\*\*$/m);
  assert.match(ignore, /^src\/dev\/\*\*$/m);
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  assert.equal(scripts.push, 'clasp push');
  assert.equal(scripts['push:dev'].includes('.claspignore.dev'), true);
  const devIgnore = fs.readFileSync(path.join(root, '.claspignore.dev'), 'utf8');
  assert.equal(/^dev\/\*\*$/m.test(devIgnore), false);
});

test('task 0.1 directories exist', () => {
  for (const dir of ['src', 'tests/fixtures', 'worker']) {
    assert.equal(fs.statSync(path.join(root, dir)).isDirectory(), true);
  }
});
