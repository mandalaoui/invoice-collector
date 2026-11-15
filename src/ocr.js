/**
 * Read document text.
 * A PDF text layer is used first. Images and scanned PDFs fall back to
 * Drive OCR in Hebrew. Original files are not modified.
 */

function toByteArray_(value) {
  if (value == null) return [];
  if (typeof value === 'string') {
    var chars = [];
    for (var i = 0; i < value.length; i++) chars.push(value.charCodeAt(i) & 255);
    return chars;
  }
  var out = [];
  for (var n = 0; n < value.length; n++) out.push(value[n] & 255);
  return out;
}

function binaryString_(bytes) {
  var parts = [];
  for (var i = 0; i < bytes.length; i++) parts.push(String.fromCharCode(bytes[i] & 255));
  return parts.join('');
}

function loadZlib_() {
  if (loadZlib_.cached !== undefined) return loadZlib_.cached;
  loadZlib_.cached = null;
  if (typeof require !== 'function') return null;
  try {
    loadZlib_.cached = require('zlib');
  } catch (error) {
    loadZlib_.cached = null;
  }
  return loadZlib_.cached;
}

function inflateFlate_(bytes) {
  var zlib = loadZlib_();
  if (!zlib || typeof Buffer === 'undefined') return null;
  var inflated = zlib.inflateSync(Buffer.from(bytes));
  return toByteArray_(inflated);
}

function textLayerIsUsable(text) {
  var compact = String(text || '').replace(/\s/g, '');
  return compact.length >= 40;
}

function htmlToText(html) {
  var text = String(html || '');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|tr|h1|h2|h3|li|table)>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
  text = text.replace(/&#(\d+);/g, function (_, code) {
    return String.fromCharCode(Number(code));
  });
  text = text.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ');
  return text.replace(/\n{2,}/g, '\n').trim();
}

function bytesToUtf8_(bytes) {
  var raw = toByteArray_(bytes);
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(Uint8Array.from(raw));
  }
  return binaryString_(raw);
}

function pdfDictEnd_(text) {
  var depth = 0;
  for (var i = 0; i < text.length; i++) {
    if (text.slice(i, i + 2) === '<<') {
      depth++;
      i++;
      continue;
    }
    if (text.slice(i, i + 2) === '>>') {
      depth--;
      i++;
      if (depth === 0) return i - 1;
    }
  }
  return -1;
}

function parseXref_(binary) {
  var at = binary.lastIndexOf('startxref');
  if (at < 0) return null;
  var offset = parseInt(binary.slice(at).split(/\s+/)[1], 10);
  if (!isFinite(offset)) return null;
  var lines = binary.slice(offset).split(/\r?\n/);
  if (lines[0] !== 'xref') return null;
  var entries = {};
  var i = 1;
  while (i < lines.length && lines[i] !== 'trailer') {
    var head = lines[i].trim().split(/\s+/);
    if (head.length < 2) break;
    var start = parseInt(head[0], 10);
    var count = parseInt(head[1], 10);
    i++;
    for (var n = 0; n < count; n++) {
      var parts = lines[i].trim().split(/\s+/);
      i++;
      if (parts[2] === 'n') entries[start + n] = parseInt(parts[0], 10);
    }
  }
  return entries;
}

function pdfObjectAt_(bytes, binary, offset) {
  var head = binary.slice(offset, offset + 32);
  var match = /^(\d+)\s+(\d+)\s+obj\s*/.exec(head);
  if (!match) return null;
  var body = binary.slice(offset + match[0].length);
  if (body.slice(0, 2) !== '<<') return { dictionary: '', stream: null };
  var end = pdfDictEnd_(body);
  if (end < 0) return null;
  var dictionary = body.slice(0, end + 2);
  var rest = body.slice(end + 2).replace(/^\s+/, '');
  if (rest.slice(0, 6) !== 'stream') return { dictionary: dictionary, stream: null };
  var breakAt = rest.indexOf('\n');
  if (breakAt < 0) return { dictionary: dictionary, stream: null };
  var lengthMatch = /\/Length\s+(\d+)/.exec(dictionary);
  if (!lengthMatch) return { dictionary: dictionary, stream: null };
  var marker = binary.indexOf('stream', offset);
  var dataStart = binary.indexOf('\n', marker) + 1;
  var length = parseInt(lengthMatch[1], 10);
  var slice = bytes.slice(dataStart, dataStart + length);
  var stream = /\/FlateDecode/.test(dictionary) ? inflateFlate_(slice) : slice;
  return { dictionary: dictionary, stream: stream };
}

function decodePdfUtf_(hexText) {
  var raw = [];
  for (var i = 0; i < hexText.length; i += 2) raw.push(parseInt(hexText.slice(i, i + 2), 16));
  if (raw.length >= 2 && raw.length % 2 === 0) {
    var chars = [];
    for (var n = 0; n < raw.length; n += 2) {
      chars.push(String.fromCharCode((raw[n] << 8) | raw[n + 1]));
    }
    return chars.join('');
  }
  return String.fromCharCode(parseInt(hexText, 16));
}

function cmapOf_(streamBytes) {
  var text = binaryString_(streamBytes);
  var mapping = {};
  var blocks = text.match(/beginbfchar[\s\S]*?endbfchar/g) || [];
  var b;
  var pairs;
  var p;
  for (b = 0; b < blocks.length; b++) {
    pairs = blocks[b].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) || [];
    for (p = 0; p < pairs.length; p++) {
      var both = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/.exec(pairs[p]);
      mapping[parseInt(both[1], 16)] = decodePdfUtf_(both[2]);
    }
  }
  var ranges = text.match(/beginbfrange[\s\S]*?endbfrange/g) || [];
  for (b = 0; b < ranges.length; b++) {
    pairs = ranges[b].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) || [];
    for (p = 0; p < pairs.length; p++) {
      var range = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/.exec(pairs[p]);
      var from = parseInt(range[1], 16);
      var to = parseInt(range[2], 16);
      var dest = parseInt(range[3], 16);
      for (var code = from; code <= to; code++) mapping[code] = String.fromCharCode(dest + (code - from));
    }
  }
  return mapping;
}

function pdfTokens_(streamBytes) {
  var text = binaryString_(streamBytes);
  var i = 0;
  var out = [];
  while (i < text.length) {
    var c = text.charAt(i);
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f') {
      i++;
      continue;
    }
    if (c === '%') {
      while (i < text.length && text.charAt(i) !== '\n' && text.charAt(i) !== '\r') i++;
      continue;
    }
    if (c === '(') {
      var parsed = pdfLiteral_(text, i);
      out.push(['str', parsed.raw]);
      i = parsed.next;
      continue;
    }
    if (c === '<') {
      var close = text.indexOf('>', i);
      out.push(['hex', hexBytes_(text.slice(i + 1, close))]);
      i = close + 1;
      continue;
    }
    if (c === '[' || c === ']') {
      out.push(['op', c]);
      i++;
      continue;
    }
    if ('+-0123456789.'.indexOf(c) >= 0) {
      var j = i + 1;
      while (j < text.length && '+-0123456789.'.indexOf(text.charAt(j)) >= 0) j++;
      out.push(['num', parseFloat(text.slice(i, j))]);
      i = j;
      continue;
    }
    if (c === '/') {
      var k = i + 1;
      while (k < text.length && ' \t\r\n[]()<>{}/%'.indexOf(text.charAt(k)) < 0) k++;
      out.push(['name', text.slice(i + 1, k)]);
      i = k;
      continue;
    }
    var op = i + 1;
    while (op < text.length && ' \t\r\n[]()<>{}/%'.indexOf(text.charAt(op)) < 0) op++;
    out.push(['op', text.slice(i, op)]);
    i = op;
  }
  return out;
}

function pdfLiteral_(text, i) {
  i++;
  var raw = [];
  while (i < text.length) {
    var c = text.charAt(i);
    if (c === '\\') {
      var n = text.charAt(i + 1);
      var escapes = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
      if (Object.prototype.hasOwnProperty.call(escapes, n)) {
        raw.push(escapes[n]);
        i += 2;
        continue;
      }
      if (n >= '0' && n <= '7') {
        var oct = n;
        var k = i + 2;
        while (k < i + 4 && k < text.length && text.charAt(k) >= '0' && text.charAt(k) <= '7') {
          oct += text.charAt(k);
          k++;
        }
        raw.push(parseInt(oct, 8) & 255);
        i = k;
        continue;
      }
      raw.push(n.charCodeAt(0) & 255);
      i += 2;
      continue;
    }
    if (c === ')') return { raw: raw, next: i + 1 };
    raw.push(c.charCodeAt(0) & 255);
    i++;
  }
  return { raw: raw, next: i };
}

function hexBytes_(hex) {
  var clean = hex.replace(/\s/g, '');
  var raw = [];
  for (var i = 0; i < clean.length; i += 2) raw.push(parseInt(clean.slice(i, i + 2), 16));
  return raw;
}

function decodeCid_(raw, cmap) {
  var chars = [];
  for (var i = 0; i + 1 < raw.length; i += 2) {
    var cid = (raw[i] << 8) | raw[i + 1];
    if (Object.prototype.hasOwnProperty.call(cmap, cid)) chars.push(cmap[cid]);
  }
  return chars.join('');
}

function logicalPdfLine_(text) {
  var chars = String(text || '').replace(/\u0000/g, '').split('');
  var out = [];
  var run = [];

  function isHebrew(ch) {
    var code = ch.charCodeAt(0);
    return code >= 0x0590 && code <= 0x05ff;
  }

  function inRun(ch) {
    return isHebrew(ch) || ch === ' ' || ch === '\t' || ch === '"' || ch === "'" || ch === '״' || ch === '׳';
  }

  function flush() {
    var hebrew = false;
    var i;
    for (i = 0; i < run.length; i++) {
      if (isHebrew(run[i])) hebrew = true;
    }
    if (hebrew) {
      for (i = run.length - 1; i >= 0; i--) out.push(run[i]);
    } else {
      for (i = 0; i < run.length; i++) out.push(run[i]);
    }
    run = [];
  }

  for (var n = 0; n < chars.length; n++) {
    if (inRun(chars[n])) run.push(chars[n]);
    else {
      flush();
      out.push(chars[n]);
    }
  }
  flush();
  return out.join('').trim();
}

/**
 * Text written into the PDF. Empty when the page is only an image, or when
 * this runtime cannot inflate Flate streams (Apps Script uses Drive instead).
 * @param {Array<number>|Uint8Array} bytes
 * @return {string}
 */
function extractPdfTextLayer(bytes) {
  var raw = toByteArray_(bytes);
  if (raw.length < 5) return '';
  if (raw[0] !== 0x25 || raw[1] !== 0x50 || raw[2] !== 0x44 || raw[3] !== 0x46) return '';
  if (!loadZlib_()) return '';
  var binary = binaryString_(raw);
  var entries = parseXref_(binary);
  if (!entries) return '';
  var objects = {};
  var ids = Object.keys(entries);
  var i;
  for (i = 0; i < ids.length; i++) {
    objects[ids[i]] = pdfObjectAt_(raw, binary, entries[ids[i]]);
  }
  var fonts = {};
  var content = null;
  for (i = 0; i < ids.length; i++) {
    var obj = objects[ids[i]];
    if (!obj || !obj.stream) continue;
    var streamText = binaryString_(obj.stream);
    if (streamText.indexOf('beginbfchar') >= 0 || streamText.indexOf('beginbfrange') >= 0) {
      fonts[ids[i]] = cmapOf_(obj.stream);
    }
    if (streamText.indexOf(' Tj') >= 0) content = obj.stream;
  }
  if (!content) return '';
  var fontNames = {};
  for (i = 0; i < ids.length; i++) {
    var dictionary = objects[ids[i]] && objects[ids[i]].dictionary;
    if (!dictionary || dictionary.indexOf('/Font') < 0) continue;
    var links = dictionary.match(/\/(F\d+)\s+(\d+)\s+0\s+R/g) || [];
    for (var link = 0; link < links.length; link++) {
      var found = /\/(F\d+)\s+(\d+)\s+0\s+R/.exec(links[link]);
      var fontObj = objects[found[2]];
      if (!fontObj) continue;
      var uni = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(fontObj.dictionary || '');
      if (uni && fonts[uni[1]]) fontNames[found[1]] = fonts[uni[1]];
    }
  }
  var fontIds = Object.keys(fontNames);
  if (!fontIds.length) return '';
  var font = fontNames[fontIds[0]];
  var glyphs = [];
  var stack = [];
  var array = null;
  var x = 0;
  var y = 0;
  var tokens = pdfTokens_(content);
  for (i = 0; i < tokens.length; i++) {
    var kind = tokens[i][0];
    var value = tokens[i][1];
    if (kind === 'str' || kind === 'hex' || kind === 'num' || kind === 'name') {
      if (array) array.push(tokens[i]);
      else stack.push(tokens[i]);
      continue;
    }
    if (value === '[') {
      array = [];
      continue;
    }
    if (value === ']') {
      stack.push(['array', array]);
      array = null;
      continue;
    }
    if (value === 'Tf' && stack.length) {
      if (fontNames[stack[0][1]]) font = fontNames[stack[0][1]];
      stack = [];
      continue;
    }
    if (value === 'Tm' && stack.length >= 6) {
      x = stack[4][1];
      y = stack[5][1];
      stack = [];
      continue;
    }
    if (value === 'Td' && stack.length >= 2) {
      x += stack[0][1];
      y += stack[1][1];
      stack = [];
      continue;
    }
    if (value === 'Tj' && stack.length && (stack[stack.length - 1][0] === 'str' || stack[stack.length - 1][0] === 'hex')) {
      glyphs.push([y, x, decodeCid_(stack[stack.length - 1][1], font)]);
      stack = [];
      continue;
    }
    if (value === 'TJ' && stack.length && stack[stack.length - 1][0] === 'array') {
      var parts = stack[stack.length - 1][1];
      var word = [];
      for (var p = 0; p < parts.length; p++) {
        if (parts[p][0] === 'str' || parts[p][0] === 'hex') word.push(decodeCid_(parts[p][1], font));
      }
      glyphs.push([y, x, word.join('')]);
      stack = [];
      continue;
    }
    if (value === 'BT') {
      x = 0;
      y = 0;
    }
    stack = [];
  }
  glyphs.sort(function (a, b) {
    var dy = Math.round(b[0] * 10) - Math.round(a[0] * 10);
    if (dy) return dy;
    return a[1] - b[1];
  });
  var lines = [];
  for (i = 0; i < glyphs.length; i++) {
    if (!lines.length || Math.abs(lines[lines.length - 1].y - glyphs[i][0]) > 3.5) {
      lines.push({ y: glyphs[i][0], parts: [[glyphs[i][1], glyphs[i][2]]] });
    } else {
      lines[lines.length - 1].parts.push([glyphs[i][1], glyphs[i][2]]);
    }
  }
  var rendered = [];
  for (i = 0; i < lines.length; i++) {
    lines[i].parts.sort(function (a, b) {
      return a[0] - b[0];
    });
    var line = [];
    for (var g = 0; g < lines[i].parts.length; g++) line.push(lines[i].parts[g][1]);
    rendered.push(logicalPdfLine_(line.join('')));
  }
  return rendered.join('\n').trim();
}

/**
 * @param {{name?: string, mime?: string, bytes?: Array<number>, html?: string, ocr?: function(Object): string}} input
 * @return {{text: string, source: string}}
 */
var TEMP_OCR_TITLE = 'invoice-collector-text';

function mimeBase_(mime) {
  return String(mime || '').toLowerCase().split(';')[0].trim();
}

/** Temp OCR docs are not invoices. */
function isTempOcrFile(name) {
  return String(name || '').indexOf(TEMP_OCR_TITLE) === 0;
}

/**
 * pdf and image may be OCR'd. A Google Doc is read as a Doc.
 * HTML is read as HTML. A temp OCR doc is skipped.
 * @return {string}
 */
function textSourceForMime(mime, name) {
  if (isTempOcrFile(name)) return 'skip';
  var type = mimeBase_(mime);
  var lower = String(name || '').toLowerCase();
  if (type === 'application/vnd.google-apps.document') return 'google-doc';
  if (type.indexOf('text/html') === 0 || lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (type === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (type.indexOf('image/') === 0 || /\.(jpe?g|png)$/.test(lower)) return 'image';
  return 'unsupported';
}

/** Drive OCR accepts only PDF and image bytes. */
function allowsOcr(mime, name) {
  var kind = textSourceForMime(mime, name);
  return kind === 'pdf' || kind === 'image';
}

function readDocumentText(input) {
  var source = input || {};
  var name = String(source.name || '');
  var mime = String(source.mime || '');
  var kind = textSourceForMime(mime, name);
  if (kind === 'skip') return { text: '', source: 'skip' };
  if (kind === 'google-doc') {
    return { text: String(source.text || ''), source: 'google-doc' };
  }
  if (kind === 'html' || source.html != null) {
    var html = source.html != null ? source.html : bytesToUtf8_(source.bytes);
    return { text: htmlToText(html), source: 'html' };
  }
  if (kind === 'pdf') {
    var layer = extractPdfTextLayer(source.bytes);
    if (textLayerIsUsable(layer)) return { text: layer, source: 'text-layer' };
    if (allowsOcr(mime, name) && typeof source.ocr === 'function') {
      return { text: String(source.ocr(source) || ''), source: 'ocr' };
    }
    return { text: layer || '', source: 'empty' };
  }
  if (kind === 'image') {
    if (allowsOcr(mime, name) && typeof source.ocr === 'function') {
      return { text: String(source.ocr(source) || ''), source: 'ocr' };
    }
    return { text: '', source: 'empty' };
  }
  return { text: '', source: 'empty' };
}

function googleDocsMime_() {
  if (typeof MimeType !== 'undefined' && MimeType.GOOGLE_DOCS) return MimeType.GOOGLE_DOCS;
  return 'application/vnd.google-apps.document';
}

function ocrInsertFailed_(resource, options, error) {
  var detail = 'drive.files.insert resource=' + JSON.stringify(resource) +
    ' options=' + JSON.stringify(options) +
    ' error=' + String(error && error.message ? error.message : error);
  if (typeof Logger !== 'undefined' && Logger.log) Logger.log(detail);
  return new Error(detail);
}

/**
 * Drive v2: resource {title, mimeType: MimeType.GOOGLE_DOCS}, image/PDF blob,
 * optional args {ocr: true, ocrLanguage: 'iw'}. A rejected language is retried
 * with ocr only. The temp Doc is read and trashed.
 */
function driveOcrText_(blob, mime, name) {
  var uploadType = mimeBase_(mime);
  if (!allowsOcr(uploadType, name)) {
    throw new Error('OCR is only supported for PDF and image files, not ' + (uploadType || 'unknown'));
  }
  if (typeof Drive === 'undefined' || !Drive.Files || typeof Drive.Files.insert !== 'function') {
    throw new Error('Enable the Drive advanced service (Drive API v2). It is required for OCR.');
  }
  var media = blob && blob.setContentType ? blob.setContentType(uploadType) : blob;
  var resource = { title: TEMP_OCR_TITLE, mimeType: googleDocsMime_() };
  var withLanguage = { ocr: true, ocrLanguage: 'iw' };
  var created = null;
  try {
    try {
      created = Drive.Files.insert(resource, media, withLanguage);
    } catch (error) {
      ocrInsertFailed_(resource, withLanguage, error);
      var ocrOnly = { ocr: true };
      try {
        created = Drive.Files.insert(resource, media, ocrOnly);
      } catch (again) {
        throw ocrInsertFailed_(resource, ocrOnly, again);
      }
    }
    return DocumentApp.openById(created.id).getBody().getText();
  } finally {
    if (created && created.id) DriveApp.getFileById(created.id).setTrashed(true);
  }
}

function driveConvertText_(blob, useOcr, mime, name) {
  if (useOcr) return driveOcrText_(blob, mime, name);
  if (typeof Drive === 'undefined' || !Drive.Files || typeof Drive.Files.insert !== 'function') {
    throw new Error('Enable the Drive advanced service (Drive API v2). It is required for OCR.');
  }
  var created = null;
  try {
    created = Drive.Files.insert(
      {
        title: TEMP_OCR_TITLE,
        mimeType: 'application/vnd.google-apps.document',
        parents: [{ id: DriveApp.getRootFolder().getId() }]
      },
      blob,
      { convert: true }
    );
    return DocumentApp.openById(created.id).getBody().getText();
  } finally {
    if (created && created.id) DriveApp.getFileById(created.id).setTrashed(true);
  }
}

/**
 * Trash leftover OCR docs so they are not treated as invoices.
 * @return {number}
 */
function trashTempOcrFiles(folder) {
  var removed = 0;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (!isTempOcrFile(file.getName())) continue;
    file.setTrashed(true);
    removed++;
  }
  return removed;
}

/**
 * Apps Script entry. PDF text layer first. OCR only for PDF and images.
 * Google Docs are read with DocumentApp. HTML is read as HTML.
 * @return {{text: string, source: string, name: string, mimeType: string}}
 */
function readDriveFileText(file) {
  var fileName = file.getName();
  var mime = file.getMimeType();
  var kind = textSourceForMime(mime, fileName);
  if (kind === 'skip') return { text: '', source: 'skip', name: fileName, mimeType: mime };
  if (kind === 'google-doc') {
    return {
      text: DocumentApp.openById(file.getId()).getBody().getText(),
      source: 'google-doc',
      name: fileName,
      mimeType: mime
    };
  }
  var blob = file.getBlob();
  if (kind === 'html') {
    return { text: htmlToText(blob.getDataAsString()), source: 'html', name: fileName, mimeType: mime };
  }
  if (kind === 'image') {
    return { text: driveOcrText_(blob, mime, fileName), source: 'ocr', name: fileName, mimeType: mime };
  }
  var read = readDocumentText({ name: fileName, mime: mime, bytes: blob.getBytes() });
  read.name = fileName;
  read.mimeType = mime;
  if (read.source === 'text-layer' || read.source === 'html') return read;
  if (!allowsOcr(mime, fileName)) {
    throw new Error('OCR is only supported for PDF and image files, not ' + mime);
  }
  if (kind === 'pdf') {
    var converted = driveConvertText_(blob, false, mime, fileName);
    if (textLayerIsUsable(converted)) {
      return { text: converted, source: 'text-layer', name: fileName, mimeType: mime };
    }
  }
  return { text: driveOcrText_(blob, mime, fileName), source: 'ocr', name: fileName, mimeType: mime };
}

/** @deprecated Use readDriveFileText so the file mime type is known. */
function readDriveBlobText(blob, name) {
  var fileName = String(name || (blob.getName && blob.getName()) || '');
  var mime = String((blob.getContentType && blob.getContentType()) || '');
  var read = readDocumentText({ name: fileName, mime: mime, bytes: blob.getBytes() });
  if (read.source === 'html' || read.source === 'text-layer' || read.source === 'google-doc' || read.source === 'skip') {
    return read;
  }
  if (!allowsOcr(mime, fileName)) {
    throw new Error('OCR is only supported for PDF and image files, not ' + (mime || 'unknown'));
  }
  if (textSourceForMime(mime, fileName) === 'pdf') {
    var converted = driveConvertText_(blob, false, mime, fileName);
    if (textLayerIsUsable(converted)) return { text: converted, source: 'text-layer' };
  }
  return { text: driveOcrText_(blob, mime, fileName), source: 'ocr' };
}

if (typeof module !== 'undefined') {
  module.exports = {
    htmlToText: htmlToText,
    textLayerIsUsable: textLayerIsUsable,
    extractPdfTextLayer: extractPdfTextLayer,
    readDocumentText: readDocumentText,
    textSourceForMime: textSourceForMime,
    allowsOcr: allowsOcr,
    isTempOcrFile: isTempOcrFile,
    driveOcrText_: driveOcrText_,
    readDriveFileText: readDriveFileText
  };
}
