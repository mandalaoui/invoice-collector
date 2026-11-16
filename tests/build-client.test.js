const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const build = require('../scripts/build-client.js');

const root = path.join(__dirname, '..');

test('build:client writes Code.gs without src/dev and copies the manifest', () => {
  const names = build.buildClient();
  assert.ok(names.includes('config.js'));
  assert.ok(names.includes('main.js'));
  assert.equal(names.some((name) => name.includes('dev')), false);
  const code = fs.readFileSync(path.join(root, 'dist', 'Code.gs'), 'utf8');
  assert.match(code, /function mergePdfBytes\(/);
  assert.match(code, /function install\(/);
  assert.match(code, /function getConfig\(/);
  assert.equal(code.includes('function testPhase6'), false);
  assert.equal(code.includes('function testAllSoFar'), false);
  assert.equal(code.includes('function sendTestFixtures'), false);
  assert.equal(code.match(/function toByteArray_/g).length, 1);
  assert.match(code, /var CODE_BUILD = '[0-9a-f]{40}';/);
  assert.equal(code.includes("var CODE_BUILD = 'dev';"), false);
  const manifest = fs.readFileSync(path.join(root, 'dist', 'appsscript.json'), 'utf8');
  assert.equal(manifest, fs.readFileSync(path.join(root, 'src', 'appsscript.json'), 'utf8'));
  new vm.Script('"use strict";\n' + code, { filename: 'Code.gs' });
});
