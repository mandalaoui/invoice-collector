/**
 * Builds the client paste: every src/*.js except src/dev, plus the manifest.
 * Dev tests stay out of the file a client copies into Apps Script.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');

function clientSourceNames() {
  return fs
    .readdirSync(srcDir)
    .filter(function (name) {
      if (!name.endsWith('.js')) return false;
      return fs.statSync(path.join(srcDir, name)).isFile();
    })
    .sort();
}

function functionBodyEnd_(source, openBrace) {
  var depth = 0;
  var quote = '';
  var i = openBrace;
  while (i < source.length) {
    var ch = source.charAt(i);
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = '';
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i++;
      continue;
    }
    if (ch === '/' && source.charAt(i + 1) === '/') {
      var newline = source.indexOf('\n', i);
      i = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  throw new Error('unclosed function in client bundle');
}

/** Keeps the first top-level function when two source files share a name. */
function dropDuplicateFunctions_(source, seen) {
  var re = /^function ([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/gm;
  var out = '';
  var cursor = 0;
  var match;
  while ((match = re.exec(source))) {
    var name = match[1];
    var openBrace = match.index + match[0].length - 1;
    if (!seen[name]) {
      seen[name] = true;
      continue;
    }
    var end = functionBodyEnd_(source, openBrace);
    out += source.slice(cursor, match.index);
    cursor = end;
    re.lastIndex = end;
  }
  return out + source.slice(cursor);
}

function gitBuildId() {
  try {
    return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch (error) {
    return 'unknown';
  }
}

function stampBuildId(source, id) {
  const token = "var CODE_BUILD = 'dev';";
  if (source.indexOf(token) < 0) throw new Error('CODE_BUILD marker missing');
  return source.replace(token, "var CODE_BUILD = '" + String(id || 'unknown') + "';");
}

function buildClient() {
  const names = clientSourceNames();
  const seen = {};
  const buildId = gitBuildId();
  const parts = names.map(function (name) {
    const body = dropDuplicateFunctions_(
      fs.readFileSync(path.join(srcDir, name), 'utf8').replace(/^\uFEFF/, '').replace(/\s+$/, ''),
      seen
    );
    return '// ' + name + '\n' + body;
  });
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'Code.gs'), stampBuildId(parts.join('\n\n') + '\n', buildId), 'utf8');
  fs.copyFileSync(path.join(srcDir, 'appsscript.json'), path.join(distDir, 'appsscript.json'));
  return names;
}

if (require.main === module) {
  const names = buildClient();
  console.log('dist/Code.gs ' + gitBuildId() + ' from ' + names.join(', '));
}

module.exports = {
  clientSourceNames: clientSourceNames,
  gitBuildId: gitBuildId,
  stampBuildId: stampBuildId,
  buildClient: buildClient
};
