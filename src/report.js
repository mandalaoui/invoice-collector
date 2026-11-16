/**
 * Accuracy of Invoices against AnswerKey, one row per field.
 * Pairing and scoring do not touch Gmail, Drive, or OCR.
 */

var ACCURACY_FIELDS = [
  'vendor_name',
  'vendor_id',
  'doc_type',
  'doc_number',
  'doc_date',
  'amount_before_vat',
  'vat_amount',
  'total',
  'currency',
  'allocation_number',
  'buyer_name_ok'
];

function pad2Report_(value) {
  var text = String(value);
  return text.length < 2 ? '0' + text : text;
}

function canonicalDate_(value) {
  if (value == null || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return value.getFullYear() + '-' + pad2Report_(value.getMonth() + 1) + '-' + pad2Report_(value.getDate());
  }
  var text = String(value).trim();
  var iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return iso[1] + '-' + pad2Report_(iso[2]) + '-' + pad2Report_(iso[3]);
  var dmy = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (dmy) return dmy[3] + '-' + pad2Report_(dmy[2]) + '-' + pad2Report_(dmy[1]);
  return text;
}

function canonicalAmount_(value) {
  if (value == null || value === '') return '';
  var text = String(value).trim().replace(/,/g, '').replace(/\s/g, '');
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    var number = Number(text);
    if (isFinite(number)) return String(number);
  }
  return String(value).trim();
}

function canonicalText_(value) {
  if (value == null) return '';
  return String(value).trim();
}

function canonicalBool_(value) {
  if (value == null || value === '') return '';
  if (value === true) return 'true';
  if (value === false) return 'false';
  var text = String(value).trim().toLowerCase();
  if (text === 'true' || text === 'yes') return 'true';
  if (text === 'false' || text === 'no') return 'false';
  return text;
}

/**
 * @return {boolean}
 */
function fieldValuesEqual(key, actual, expected) {
  if (key === 'doc_date') return canonicalDate_(actual) === canonicalDate_(expected);
  if (key === 'buyer_name_ok') return canonicalBool_(actual) === canonicalBool_(expected);
  if (key === 'amount_before_vat' || key === 'vat_amount' || key === 'total') {
    return canonicalAmount_(actual) === canonicalAmount_(expected);
  }
  return canonicalText_(actual) === canonicalText_(expected);
}

function formatMatchPercent_(matches, total) {
  if (!total) return '';
  var value = Math.round((1000 * matches) / total) / 10;
  return value + '%';
}

/**
 * 1 and "100%" are the same. A number above 1 is a percent, not a fraction.
 * @return {number|null}
 */
function matchPercentNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (!isFinite(value)) return null;
    if (value >= 0 && value <= 1) return value;
    return value / 100;
  }
  var text = String(value).trim();
  if (!text) return null;
  var withSign = text.match(/^(\d+(?:\.\d+)?)%$/);
  if (withSign) return Number(withSign[1]) / 100;
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  var parsed = Number(text);
  if (parsed >= 0 && parsed <= 1) return parsed;
  return parsed / 100;
}

function matchPercentsEqual(actual, expected) {
  var left = matchPercentNumber(actual);
  var right = matchPercentNumber(expected);
  if (left == null || right == null) return false;
  return Math.abs(left - right) < 0.0005;
}

function namedFileStem_(value) {
  var text = String(value || '');
  var match = text.match(/([A-Za-z0-9][A-Za-z0-9_-]*\.(?:pdf|html|jpg|jpeg|png))/i);
  if (!match) return '';
  return match[1].replace(/\.[^.]+$/, '').toLowerCase();
}

/** File stem used to pair a row. A bare message id is not a stem. */
function rowFileStem_(row) {
  if (!row) return '';
  if (row.file) {
    var fromName = namedFileStem_(row.file);
    if (fromName) return fromName;
    return String(row.file).replace(/\.[^.]+$/, '').toLowerCase();
  }
  var fromSource = namedFileStem_(row.source);
  if (fromSource) return fromSource;
  var fromLink = namedFileStem_(row.file_link);
  if (fromLink) return fromLink;
  var parts = String(row.source || '').trim().split(/\s+/);
  if (parts.length >= 2 && parts[parts.length - 1]) return parts[parts.length - 1].toLowerCase();
  return '';
}

function rowSourceId_(row) {
  var text = String(row && row.source || '').trim();
  if (!text || text.indexOf(' ') === -1) return '';
  return text.split(/\s+/)[0];
}

function rowDocKey_(row) {
  var vendor = row && row.vendor_id != null ? String(row.vendor_id).trim() : '';
  var number = row && row.doc_number != null ? String(row.doc_number).trim() : '';
  if (!vendor || !number) return '';
  return vendor + '|' + number;
}

function findInvoiceIndex_(invoices, used, answer) {
  var stem = rowFileStem_(answer);
  var sourceId = rowSourceId_(answer);
  var docKey = rowDocKey_(answer);
  var i;
  if (stem) {
    for (i = 0; i < invoices.length; i++) {
      if (used[i]) continue;
      if (rowFileStem_(invoices[i]) === stem) return i;
    }
  }
  if (sourceId) {
    for (i = 0; i < invoices.length; i++) {
      if (used[i]) continue;
      if (rowSourceId_(invoices[i]) === sourceId) return i;
    }
  }
  if (docKey) {
    for (i = 0; i < invoices.length; i++) {
      if (used[i]) continue;
      if (rowDocKey_(invoices[i]) === docKey) return i;
    }
  }
  return -1;
}

function isManualStatus_(status) {
  var text = String(status || '').trim();
  return text === 'REVIEW' || text === 'NEEDS_MANUAL';
}

/**
 * @param {Array<Object>} invoices
 * @param {Array<Object>} answerKey
 * @return {{rows: Array<Object>, pairs: number, unmatched: number}}
 */
function compareInvoicesToAnswerKey(invoices, answerKey) {
  var left = invoices || [];
  var right = answerKey || [];
  var used = {};
  var pairs = [];
  var unmatched = 0;
  var r;
  for (r = 0; r < right.length; r++) {
    var index = findInvoiceIndex_(left, used, right[r]);
    if (index < 0) {
      unmatched++;
      pairs.push({ answer: right[r], invoice: null });
      continue;
    }
    used[index] = true;
    pairs.push({ answer: right[r], invoice: left[index] });
  }
  var manual = 0;
  for (r = 0; r < pairs.length; r++) {
    if (pairs[r].invoice && isManualStatus_(pairs[r].invoice.status)) manual++;
  }
  var rows = [];
  for (var f = 0; f < ACCURACY_FIELDS.length; f++) {
    var key = ACCURACY_FIELDS[f];
    var matches = 0;
    for (r = 0; r < pairs.length; r++) {
      var invoice = pairs[r].invoice;
      if (!invoice) continue;
      if (fieldValuesEqual(key, invoice[key], pairs[r].answer[key])) matches++;
    }
    rows.push({
      field: key,
      answer_key_count: pairs.length,
      deterministic_matches: matches,
      local_ai_matches: '',
      time_ms: '',
      tokens: '',
      manual_count: manual,
      match_percent: formatMatchPercent_(matches, pairs.length)
    });
  }
  return { rows: rows, pairs: pairs.length, unmatched: unmatched };
}

function comparisonGrid(reportRows) {
  var headers = typeof COMPARISON_HEADERS !== 'undefined'
    ? COMPARISON_HEADERS
    : ['field', 'answer_key_count', 'deterministic_matches', 'local_ai_matches', 'time_ms', 'tokens', 'manual_count', 'match_percent'];
  var grid = [headers.slice()];
  var rows = reportRows || [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || {};
    grid.push(headers.map(function (key) {
      return row[key] == null ? '' : row[key];
    }));
  }
  return grid;
}

function amountNumber_(value) {
  if (value == null || value === '') return 0;
  var number = Number(String(value).replace(/,/g, '').trim());
  return isFinite(number) ? number : 0;
}

function roundMoney_(value) {
  return Math.round(value * 100) / 100;
}

function statusLabel_(row) {
  var text = row && row.status != null ? String(row.status).trim() : '';
  return text || 'BLANK';
}

function excludedFromPack_(status) {
  return status === 'NOT_INVOICE' || status === 'DUPLICATE';
}

/**
 * A row dated in another month is left out. A row with no date stays in.
 * @return {boolean}
 */
function rowInMonth_(row, month) {
  if (!month) return true;
  var iso = canonicalDate_(row && row.doc_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return true;
  return iso.slice(0, 7) === month;
}

function rowsForMonth(rows, month) {
  var source = rows || [];
  var kept = [];
  for (var i = 0; i < source.length; i++) {
    if (rowInMonth_(source[i], month)) kept.push(source[i]);
  }
  return kept;
}

/**
 * Totals and VAT skip NOT_INVOICE and DUPLICATE. Status counts include them.
 * @return {{documents: number, included: Array<Object>, excluded: Array<Object>, byStatus: Object, byCurrency: Object}}
 */
function summarizeMonth(rows) {
  var list = rows || [];
  var byStatus = {};
  var byCurrency = {};
  var included = [];
  var excluded = [];
  for (var i = 0; i < list.length; i++) {
    var row = list[i] || {};
    var status = statusLabel_(row);
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (excludedFromPack_(status)) {
      excluded.push(row);
      continue;
    }
    included.push(row);
    var currency = canonicalText_(row.currency) || 'ILS';
    if (!byCurrency[currency]) byCurrency[currency] = { total: 0, vat: 0, count: 0 };
    byCurrency[currency].total = roundMoney_(byCurrency[currency].total + amountNumber_(row.total));
    byCurrency[currency].vat = roundMoney_(byCurrency[currency].vat + amountNumber_(row.vat_amount));
    byCurrency[currency].count++;
  }
  return {
    documents: list.length,
    included: included,
    excluded: excluded,
    byStatus: byStatus,
    byCurrency: byCurrency
  };
}

function summaryGrid(summary, month) {
  var source = summary || summarizeMonth([]);
  var rows = [
    ['metric', 'value'],
    ['month', month || ''],
    ['documents', source.documents],
    ['included', source.included.length],
    ['excluded', source.excluded.length]
  ];
  var currencies = Object.keys(source.byCurrency).sort();
  var i;
  for (i = 0; i < currencies.length; i++) {
    var bucket = source.byCurrency[currencies[i]];
    rows.push(['total_' + currencies[i], bucket.total]);
    rows.push(['vat_' + currencies[i], bucket.vat]);
  }
  var statuses = Object.keys(source.byStatus).sort();
  for (i = 0; i < statuses.length; i++) {
    rows.push(['status_' + statuses[i], source.byStatus[statuses[i]]]);
  }
  return rows;
}

function gridWidth_(grid) {
  var width = 0;
  var rows = grid || [];
  for (var i = 0; i < rows.length; i++) width = Math.max(width, (rows[i] || []).length);
  return width;
}

function padGrid_(grid) {
  var width = gridWidth_(grid);
  return (grid || []).map(function (row) {
    var copy = (row || []).slice();
    while (copy.length < width) copy.push('');
    return copy;
  });
}

/**
 * Keeps the accuracy table and replaces a previous summary block.
 */
function withMonthlySummary(existingGrid, summary, month) {
  var kept = [];
  var grid = existingGrid || [];
  for (var i = 0; i < grid.length; i++) {
    var label = grid[i] && grid[i][0] != null ? String(grid[i][0]) : '';
    if (label === 'metric') break;
    kept.push(grid[i]);
  }
  while (kept.length) {
    var last = kept[kept.length - 1] || [];
    var blank = true;
    for (var c = 0; c < last.length; c++) {
      if (last[c] !== '' && last[c] != null) blank = false;
    }
    if (!blank) break;
    kept.pop();
  }
  if (kept.length) kept.push(['', '']);
  return padGrid_(kept.concat(summaryGrid(summary, month)));
}

function driveIdFromLink(link) {
  var text = String(link || '').trim();
  var slash = text.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (slash) return slash[1];
  var query = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (query) return query[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) return text;
  return '';
}

/**
 * Notice for one file inside the merged PDF. Page numbers are the merged PDF.
 * keepLocal null, or no keyword page, means check manually.
 * @return {string}
 */
function multipageNote(file) {
  var source = file || {};
  var pages = Number(source.pages);
  if (!(pages > 1)) return '';
  var start = Number(source.start);
  if (!isFinite(start) || start < 1) start = 1;
  var end = start + pages - 1;
  var range = start + '-' + end;
  var z = 'check manually';
  var local = source.keepLocal;
  if (local && local.length) {
    var merged = [];
    var i;
    for (i = 0; i < local.length; i++) {
      var n = Number(local[i]);
      if (n >= 1 && n <= pages) merged.push(String(start + n - 1));
    }
    if (merged.length) z = merged.join(', ');
  }
  return (
    'File ' +
    source.name +
    ' has ' +
    pages +
    ' pages; pages to keep: ' +
    z +
    '; merged PDF pages ' +
    range
  );
}

/**
 * @param {Array<{id?: string, name: string, pages: number, keepLocal?: number[]|null}>} files
 * @return {Array<{id: string, name: string, note: string}>}
 */
function multipageNotes(files) {
  var start = 1;
  var notes = [];
  var list = files || [];
  for (var i = 0; i < list.length; i++) {
    var pages = Number(list[i].pages) || 0;
    var note = multipageNote({
      name: list[i].name,
      pages: pages,
      start: start,
      keepLocal: list[i].keepLocal
    });
    if (note) notes.push({ id: list[i].id || '', name: list[i].name || '', note: note });
    start += pages > 0 ? pages : 0;
  }
  return notes;
}

function noticeLines_(notices) {
  var lines = [];
  var list = notices || [];
  for (var i = 0; i < list.length; i++) {
    var line = list[i] && list[i].note ? list[i].note : list[i];
    if (line) lines.push(String(line));
  }
  return lines;
}

/** Files for the merged PDF. NOT_INVOICE and DUPLICATE are left out. */
function selectMergeFiles(rows) {
  var included = summarizeMonth(rows).included;
  var files = [];
  var seen = {};
  for (var i = 0; i < included.length; i++) {
    var id = driveIdFromLink(included[i].file_link);
    if (!id || seen[id]) continue;
    seen[id] = true;
    files.push({ id: id, file_link: included[i].file_link });
  }
  return files;
}

function mergedPdfName(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new Error('month must be YYYY-MM');
  return month + '_merged.pdf';
}

function toByteArray_(bytes) {
  if (!bytes) return [];
  if (typeof bytes === 'string') {
    var chars = [];
    for (var i = 0; i < bytes.length; i++) chars.push(bytes.charCodeAt(i) & 255);
    return chars;
  }
  var list = [];
  for (var n = 0; n < bytes.length; n++) list.push(bytes[n] & 255);
  return list;
}

function bytesToLatin1_(bytes) {
  var data = toByteArray_(bytes);
  var chunks = [];
  for (var i = 0; i < data.length; i += 8192) {
    chunks.push(String.fromCharCode.apply(null, data.slice(i, i + 8192)));
  }
  return chunks.join('');
}

function isPdfHeader_(bytes) {
  var data = toByteArray_(bytes);
  return data.length >= 5 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46;
}

function dictHead_(body) {
  var cut = String(body || '').indexOf('stream');
  return cut === -1 ? String(body || '') : String(body).slice(0, cut);
}

function pdfType_(dict, name) {
  return new RegExp('/Type\\s*/' + name + '(?![A-Za-z])').test(dict || '');
}

function mediaBoxText_(dict) {
  var match = String(dict || '').match(/\/MediaBox\s*\[([^\]]+)\]/);
  return match ? match[1].trim() : '';
}

function refsInArray_(dict, key) {
  var text = String(dict || '');
  var at = text.search(new RegExp('/' + key + '\\s*\\['));
  var slice = text;
  if (at >= 0) {
    var end = text.indexOf(']', at);
    slice = text.slice(at, end === -1 ? text.length : end);
  } else {
    var one = text.match(new RegExp('/' + key + '\\s+(\\d+)\\s+\\d+\\s+R'));
    return one ? [Number(one[1])] : [];
  }
  var refs = [];
  var re = /(\d+)\s+\d+\s+R/g;
  var match;
  while ((match = re.exec(slice))) refs.push(Number(match[1]));
  return refs;
}

function reverseBits_(code, length) {
  var out = 0;
  for (var i = 0; i < length; i++) {
    out = (out << 1) | (code & 1);
    code >>>= 1;
  }
  return out;
}

function huffman_(lengths) {
  var counts = [];
  var max = 0;
  var i;
  for (i = 0; i < lengths.length; i++) {
    var len = lengths[i] || 0;
    if (!len) continue;
    counts[len] = (counts[len] || 0) + 1;
    if (len > max) max = len;
  }
  if (!max) return { table: [], max: 0 };
  var next = [];
  var code = 0;
  for (var bits = 1; bits <= max; bits++) {
    code = (code + (counts[bits - 1] || 0)) << 1;
    next[bits] = code;
  }
  var table = new Array(1 << max);
  for (var sym = 0; sym < lengths.length; sym++) {
    var length = lengths[sym] || 0;
    if (!length) continue;
    var reversed = reverseBits_(next[length]++, length);
    var step = 1 << length;
    for (var fill = reversed; fill < table.length; fill += step) table[fill] = { sym: sym, len: length };
  }
  return { table: table, max: max };
}

function BitReader_(data) {
  this.data = data;
  this.i = 0;
  this.bit = 0;
  this.acc = 0;
}

BitReader_.prototype.pull = function (n) {
  while (this.bit < n) {
    if (this.i >= this.data.length) throw new Error('pdf flate ended early');
    this.acc |= this.data[this.i++] << this.bit;
    this.bit += 8;
  }
  var value = this.acc & ((1 << n) - 1);
  this.acc >>>= n;
  this.bit -= n;
  return value;
};

BitReader_.prototype.align = function () {
  this.bit = 0;
  this.acc = 0;
};

function decodeSymbol_(reader, huff) {
  if (!huff.max) throw new Error('pdf flate huffman is empty');
  while (reader.bit < huff.max && reader.i < reader.data.length) {
    reader.acc |= reader.data[reader.i++] << reader.bit;
    reader.bit += 8;
  }
  var found = huff.table[reader.acc & ((1 << huff.max) - 1)];
  if (!found) throw new Error('pdf flate symbol was not found');
  reader.acc >>>= found.len;
  reader.bit -= found.len;
  return found.sym;
}

var FLATE_LEN_BASE_ = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
var FLATE_LEN_EXTRA_ = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
var FLATE_DIST_BASE_ = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
var FLATE_DIST_EXTRA_ = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
var FLATE_CLEN_ORDER_ = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function fixedLitTree_() {
  if (fixedLitTree_.cached) return fixedLitTree_.cached;
  var lengths = [];
  var i;
  for (i = 0; i <= 143; i++) lengths.push(8);
  for (i = 144; i <= 255; i++) lengths.push(9);
  for (i = 256; i <= 279; i++) lengths.push(7);
  for (i = 280; i <= 287; i++) lengths.push(8);
  fixedLitTree_.cached = huffman_(lengths);
  return fixedLitTree_.cached;
}

function fixedDistTree_() {
  if (fixedDistTree_.cached) return fixedDistTree_.cached;
  var lengths = [];
  for (var i = 0; i < 32; i++) lengths.push(5);
  fixedDistTree_.cached = huffman_(lengths);
  return fixedDistTree_.cached;
}

function dynamicTrees_(reader) {
  var hlit = reader.pull(5) + 257;
  var hdist = reader.pull(5) + 1;
  var hclen = reader.pull(4) + 4;
  var clens = [];
  var i;
  for (i = 0; i < 19; i++) clens.push(0);
  for (i = 0; i < hclen; i++) clens[FLATE_CLEN_ORDER_[i]] = reader.pull(3);
  var clenTree = huffman_(clens);
  var lengths = [];
  while (lengths.length < hlit + hdist) {
    var sym = decodeSymbol_(reader, clenTree);
    if (sym < 16) lengths.push(sym);
    else if (sym === 16) {
      var prev = lengths.length ? lengths[lengths.length - 1] : 0;
      var repeat = reader.pull(2) + 3;
      for (i = 0; i < repeat; i++) lengths.push(prev);
    } else if (sym === 17) {
      var zeros = reader.pull(3) + 3;
      for (i = 0; i < zeros; i++) lengths.push(0);
    } else if (sym === 18) {
      var more = reader.pull(7) + 11;
      for (i = 0; i < more; i++) lengths.push(0);
    } else throw new Error('pdf flate code length is invalid');
  }
  return { lit: huffman_(lengths.slice(0, hlit)), dist: huffman_(lengths.slice(hlit, hlit + hdist)) };
}

function inflateBlock_(reader, output, lit, dist) {
  while (true) {
    var sym = decodeSymbol_(reader, lit);
    if (sym < 256) {
      output.push(sym);
      continue;
    }
    if (sym === 256) return;
    var length = FLATE_LEN_BASE_[sym - 257] + (FLATE_LEN_EXTRA_[sym - 257] ? reader.pull(FLATE_LEN_EXTRA_[sym - 257]) : 0);
    var dsym = decodeSymbol_(reader, dist);
    var distance = FLATE_DIST_BASE_[dsym] + (FLATE_DIST_EXTRA_[dsym] ? reader.pull(FLATE_DIST_EXTRA_[dsym]) : 0);
    if (!distance || distance > output.length) throw new Error('pdf flate distance is invalid');
    for (var n = 0; n < length; n++) output.push(output[output.length - distance]);
  }
}

function inflateRaw_(data) {
  var reader = new BitReader_(data);
  var output = [];
  while (true) {
    var bfinal = reader.pull(1);
    var btype = reader.pull(2);
    if (btype === 0) {
      reader.align();
      if (reader.i + 4 > reader.data.length) throw new Error('pdf flate ended early');
      var len = reader.data[reader.i] | (reader.data[reader.i + 1] << 8);
      var nlen = reader.data[reader.i + 2] | (reader.data[reader.i + 3] << 8);
      if ((len ^ 0xffff) !== nlen) throw new Error('pdf stored block length mismatch');
      reader.i += 4;
      for (var s = 0; s < len; s++) output.push(reader.data[reader.i++]);
    } else if (btype === 1) inflateBlock_(reader, output, fixedLitTree_(), fixedDistTree_());
    else if (btype === 2) {
      var trees = dynamicTrees_(reader);
      inflateBlock_(reader, output, trees.lit, trees.dist);
    } else throw new Error('pdf flate block type is invalid');
    if (bfinal) break;
  }
  reader.align();
  return { output: output, offset: reader.i };
}

function adler32_(bytes) {
  var a = 1;
  var b = 0;
  for (var i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Inflate a PDF FlateDecode stream (zlib wrapper). */
function inflateZlib_(bytes) {
  var data = toByteArray_(bytes);
  if (data.length < 6) throw new Error('pdf flate stream is empty');
  var cmf = data[0];
  var flg = data[1];
  if ((cmf & 15) !== 8 || ((cmf << 8) + flg) % 31 !== 0) throw new Error('pdf flate header is invalid');
  if (flg & 32) throw new Error('pdf flate preset dictionary is not supported');
  var raw = inflateRaw_(data.slice(2));
  if (raw.offset + 4 > data.length) throw new Error('pdf flate checksum is missing');
  var expect = 0;
  for (var i = 0; i < 4; i++) expect = (expect << 8) + data[2 + raw.offset + i];
  if ((expect >>> 0) !== adler32_(raw.output)) throw new Error('pdf flate checksum failed');
  return raw.output;
}

function paeth_(left, up, upLeft) {
  var estimate = left + up - upLeft;
  var pa = Math.abs(estimate - left);
  var pb = Math.abs(estimate - up);
  var pc = Math.abs(estimate - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

/** Undo a PDF PNG predictor. columns is the sample width, without the filter byte. */
function pngUnpredict_(bytes, columns, predictor) {
  var data = toByteArray_(bytes);
  var pred = Number(predictor) || 1;
  if (pred === 1) return data;
  var rowSize = columns + 1;
  if (!columns || data.length % rowSize !== 0) throw new Error('pdf predictor row is invalid');
  var out = [];
  var prev = [];
  var c;
  for (c = 0; c < columns; c++) prev.push(0);
  for (var at = 0; at < data.length; at += rowSize) {
    var filter = data[at];
    if (pred >= 10 && pred <= 14) filter = pred - 10;
    var row = [];
    for (c = 0; c < columns; c++) {
      var left = c ? row[c - 1] : 0;
      var up = prev[c];
      var upLeft = c ? prev[c - 1] : 0;
      var value = data[at + 1 + c];
      if (filter === 1) value = (value + left) & 255;
      else if (filter === 2) value = (value + up) & 255;
      else if (filter === 3) value = (value + ((left + up) >> 1)) & 255;
      else if (filter === 4) value = (value + paeth_(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error('pdf predictor ' + filter + ' is not supported');
      row.push(value);
    }
    for (c = 0; c < row.length; c++) out.push(row[c]);
    prev = row;
  }
  return out;
}

function readPdfObject_(text, offset, lengthOf) {
  var slice = text.slice(offset);
  var skipped = slice.match(/^[\s\0]*/);
  var start = skipped && skipped[0].length <= 32 ? skipped[0].length : 0;
  var head = slice.slice(start).match(/^(\d+)\s+(\d+)\s+obj\s*/);
  if (!head) throw new Error('bad pdf object at ' + offset);
  var bodyAt = offset + start + head[0].length;
  var preview = text.slice(bodyAt, bodyAt + 8000);
  var streamAt = preview.indexOf('stream');
  var endEarly = preview.indexOf('endobj');
  if (streamAt >= 0 && (endEarly === -1 || streamAt < endEarly)) {
    var dict = preview.slice(0, streamAt);
    var directLength = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
    var indirectLength = dict.match(/\/Length\s+(\d+)\s+\d+\s+R/);
    var length = directLength ? Number(directLength[1]) : null;
    if (length == null && indirectLength && lengthOf) length = lengthOf(Number(indirectLength[1]));
    if (length == null) throw new Error('pdf stream length is not a direct number');
    var dataAt = bodyAt + streamAt + 'stream'.length;
    if (text.charCodeAt(dataAt) === 13) dataAt++;
    if (text.charCodeAt(dataAt) === 10) dataAt++;
    var after = dataAt + length;
    if (!/^\s*endstream/.test(text.slice(after, after + 30))) throw new Error('pdf stream did not end');
    var endObj = text.indexOf('endobj', after);
    if (endObj < 0) throw new Error('pdf object did not end');
    return { num: Number(head[1]), body: text.slice(bodyAt, endObj).replace(/\s*$/, '') };
  }
  var endObjPlain = text.indexOf('endobj', bodyAt);
  if (endObjPlain < 0) throw new Error('pdf object did not end');
  return { num: Number(head[1]), body: text.slice(bodyAt, endObjPlain).replace(/\s*$/, '') };
}

function streamBytesFromBody_(body) {
  var dict = dictHead_(body);
  var lengthMatch = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
  if (!lengthMatch) throw new Error('pdf stream length is not a direct number');
  var length = Number(lengthMatch[1]);
  var at = body.indexOf('stream');
  if (at < 0) throw new Error('pdf stream is missing');
  var dataAt = at + 'stream'.length;
  if (body.charCodeAt(dataAt) === 13) dataAt++;
  if (body.charCodeAt(dataAt) === 10) dataAt++;
  var bytes = [];
  for (var i = 0; i < length; i++) bytes.push(body.charCodeAt(dataAt + i) & 255);
  return bytes;
}

function decodeParms_(dict) {
  var predictor = 1;
  var columns = 0;
  var pred = String(dict || '').match(/\/Predictor\s+(\d+)/);
  if (pred) predictor = Number(pred[1]);
  var cols = String(dict || '').match(/\/Columns\s+(\d+)/);
  if (cols) columns = Number(cols[1]);
  return { predictor: predictor, columns: columns };
}

function readField_(bytes, at, width) {
  var value = 0;
  for (var i = 0; i < width; i++) value = (value << 8) + (bytes[at + i] & 255);
  return value >>> 0;
}

function applyXrefSection_(entries, section, override) {
  var ids = Object.keys(section);
  for (var i = 0; i < ids.length; i++) {
    if (override || !entries[ids[i]]) entries[ids[i]] = section[ids[i]];
  }
}

function readClassicXref_(text, offset) {
  var trailerAt = text.indexOf('trailer', offset);
  if (trailerAt < 0) throw new Error('pdf trailer is missing');
  var trailerEnd = text.indexOf('startxref', trailerAt + 7);
  var trailer = text.slice(trailerAt, trailerEnd < 0 ? text.length : trailerEnd);
  if (/\/Encrypt\b/.test(trailer)) throw new Error('encrypted pdfs are not merged');
  var cursor = offset + 4;
  var entries = {};
  while (cursor < trailerAt) {
    var head = text.slice(cursor).match(/^\s*(\d+)\s+(\d+)\s+/);
    if (!head) break;
    var startNum = Number(head[1]);
    var count = Number(head[2]);
    cursor += head[0].length;
    for (var i = 0; i < count; i++) {
      var line = text.slice(cursor).match(/^(\d{10})\s+(\d{5})\s+([nf])\s*/);
      if (!line) throw new Error('bad pdf xref row');
      if (line[3] === 'n') entries[startNum + i] = { offset: Number(line[1]), gen: Number(line[2]) };
      cursor += line[0].length;
    }
  }
  var rootMatch = trailer.match(/\/Root\s+(\d+)\s+\d+\s+R/);
  if (!rootMatch) throw new Error('pdf catalog is missing');
  var prevMatch = trailer.match(/\/Prev\s+(\d+)/);
  var streamMatch = trailer.match(/\/XRefStm\s+(\d+)/);
  return {
    entries: entries,
    root: Number(rootMatch[1]),
    prev: prevMatch ? Number(prevMatch[1]) : 0,
    xrefStm: streamMatch ? Number(streamMatch[1]) : 0
  };
}

function readStreamXref_(text, offset) {
  var obj = readPdfObject_(text, offset);
  var dict = dictHead_(obj.body);
  if (/\/Encrypt\b/.test(dict)) throw new Error('encrypted pdfs are not merged');
  var widthMatch = dict.match(/\/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/);
  if (!widthMatch) throw new Error('pdf xref stream has no widths');
  var widths = [Number(widthMatch[1]), Number(widthMatch[2]), Number(widthMatch[3])];
  var stride = widths[0] + widths[1] + widths[2];
  var size = Number((dict.match(/\/Size\s+(\d+)/) || [])[1]);
  if (!size) throw new Error('pdf xref stream has no size');
  var ranges = [];
  var indexMatch = dict.match(/\/Index\s*\[([^\]]*)\]/);
  if (indexMatch && indexMatch[1].trim()) {
    var parts = indexMatch[1].trim().split(/\s+/);
    for (var p = 0; p < parts.length; p += 2) ranges.push([Number(parts[p]), Number(parts[p + 1])]);
  } else ranges.push([0, size]);
  var stream = streamBytesFromBody_(obj.body);
  if (/\/FlateDecode\b/.test(dict)) stream = inflateZlib_(stream);
  var parms = decodeParms_(dict);
  if (parms.predictor > 1) stream = pngUnpredict_(stream, parms.columns || stride, parms.predictor);
  var entries = {};
  var cursor = 0;
  for (var r = 0; r < ranges.length; r++) {
    for (var n = 0; n < ranges[r][1]; n++) {
      if (cursor + stride > stream.length) throw new Error('pdf xref stream ended early');
      var type = widths[0] ? readField_(stream, cursor, widths[0]) : 1;
      var field2 = widths[1] ? readField_(stream, cursor + widths[0], widths[1]) : 0;
      var field3 = widths[2] ? readField_(stream, cursor + widths[0] + widths[1], widths[2]) : 0;
      cursor += stride;
      var id = ranges[r][0] + n;
      if (!id || type === 0) continue;
      if (type === 1) entries[id] = { offset: field2, gen: field3 };
      else if (type === 2) entries[id] = { objstm: field2, index: field3 };
      else throw new Error('pdf xref type ' + type + ' is not supported');
    }
  }
  var rootMatch = dict.match(/\/Root\s+(\d+)\s+\d+\s+R/);
  if (!rootMatch) throw new Error('pdf catalog is missing');
  var prevMatch = dict.match(/\/Prev\s+(\d+)/);
  return { entries: entries, root: Number(rootMatch[1]), prev: prevMatch ? Number(prevMatch[1]) : 0 };
}

function readXrefAt_(text, offset) {
  if (text.slice(offset, offset + 4) === 'xref') return readClassicXref_(text, offset);
  return readStreamXref_(text, offset);
}

function expandObjStm_(objects, id) {
  var body = objects[id];
  if (!body) throw new Error('pdf object stream ' + id + ' is missing');
  var dict = dictHead_(body);
  var count = Number((dict.match(/\/N\s+(\d+)/) || [])[1]);
  var first = Number((dict.match(/\/First\s+(\d+)/) || [])[1]);
  if (!count || !(first >= 0)) throw new Error('pdf object stream ' + id + ' is invalid');
  var stream = streamBytesFromBody_(body);
  if (/\/FlateDecode\b/.test(dict)) stream = inflateZlib_(stream);
  var header = bytesToLatin1_(stream.slice(0, first)).trim().split(/\s+/);
  if (header.length < count * 2) throw new Error('pdf object stream ' + id + ' header is short');
  for (var i = 0; i < count; i++) {
    var objId = Number(header[i * 2]);
    var at = first + Number(header[i * 2 + 1]);
    var end = i + 1 < count ? first + Number(header[(i + 1) * 2 + 1]) : stream.length;
    if (!(at >= 0) || end < at || end > stream.length) throw new Error('pdf object stream ' + id + ' is out of range');
    objects[objId] = bytesToLatin1_(stream.slice(at, end)).trim();
  }
}

function parsePdf_(bytes) {
  var text = bytesToLatin1_(bytes);
  var marker = text.lastIndexOf('startxref');
  if (marker < 0) throw new Error('pdf has no startxref');
  var offsetMatch = text.slice(marker + 9).match(/\d+/);
  if (!offsetMatch) throw new Error('pdf startxref is empty');
  var entries = {};
  var root = 0;
  var offset = Number(offsetMatch[0]);
  var guard = 0;
  while (offset && guard < 8) {
    var section = readXrefAt_(text, offset);
    if (!root) root = section.root;
    applyXrefSection_(entries, section.entries, false);
    if (section.xrefStm) {
      applyXrefSection_(entries, readXrefAt_(text, section.xrefStm).entries, true);
    }
    offset = section.prev;
    guard++;
  }
  if (!root) throw new Error('pdf catalog is missing');
  var objects = {};
  var ids = Object.keys(entries);
  var n;
  function loadPlainObject_(id) {
    var key = Number(id);
    if (Object.prototype.hasOwnProperty.call(objects, key)) return objects[key];
    var entry = entries[key];
    if (!entry || entry.objstm || (!entry.offset && entry.offset !== 0)) return '';
    var obj = readPdfObject_(text, entry.offset, function (lengthId) {
      var raw = loadPlainObject_(lengthId);
      var match = String(raw || '').match(/^\s*(-?\d+)/);
      if (!match) throw new Error('pdf stream length is not a direct number');
      return Number(match[1]);
    });
    objects[key] = obj.body;
    return obj.body;
  }
  for (n = 0; n < ids.length; n++) {
    if (entries[ids[n]].objstm) continue;
    loadPlainObject_(ids[n]);
  }
  var expanded = {};
  for (n = 0; n < ids.length; n++) {
    if (!entries[ids[n]].objstm) continue;
    var streamId = entries[ids[n]].objstm;
    if (expanded[streamId] || !objects[streamId]) continue;
    if (!pdfType_(dictHead_(objects[streamId]), 'ObjStm')) continue;
    expandObjStm_(objects, streamId);
    expanded[streamId] = true;
  }
  var streamIds = {};
  for (n = 0; n < ids.length; n++) {
    if (entries[ids[n]].objstm) streamIds[entries[ids[n]].objstm] = true;
  }
  var objectIds = Object.keys(objects);
  for (n = 0; n < objectIds.length; n++) {
    if (objectIds[n] === '__expanded') continue;
    var kind = dictHead_(objects[objectIds[n]]);
    if (streamIds[objectIds[n]] || pdfType_(kind, 'XRef') || pdfType_(kind, 'ObjStm')) delete objects[objectIds[n]];
  }
  return { objects: objects, root: root };
}

function collectPdfPages_(objects, pagesId, inheritedBox, found, pageTreeIds) {
  if (pageTreeIds[pagesId]) throw new Error('pdf page tree loops');
  pageTreeIds[pagesId] = true;
  var dict = dictHead_(objects[pagesId]);
  if (!pdfType_(dict, 'Pages')) throw new Error('pdf page tree is missing');
  var box = mediaBoxText_(dict) || inheritedBox;
  var kids = refsInArray_(dict, 'Kids');
  for (var i = 0; i < kids.length; i++) {
    var child = objects[kids[i]];
    if (!child) throw new Error('pdf page ' + kids[i] + ' is missing');
    var childDict = dictHead_(child);
    if (pdfType_(childDict, 'Page')) found.push({ id: kids[i], mediaBox: mediaBoxText_(childDict) || box });
    else if (pdfType_(childDict, 'Pages')) collectPdfPages_(objects, kids[i], box, found, pageTreeIds);
    else throw new Error('pdf page tree has an unexpected node');
  }
}

function rewritePdfRefs_(body, map, pageTreeIds, newPagesId) {
  var cut = body.indexOf('stream');
  var head = cut === -1 ? body : body.slice(0, cut);
  var rest = cut === -1 ? '' : body.slice(cut);
  head = head.replace(/(\d+)\s+(\d+)\s+R/g, function (all, num, gen) {
    var id = Number(num);
    if (pageTreeIds[id]) return newPagesId + ' ' + gen + ' R';
    if (!map[id]) throw new Error('pdf references object ' + id + ' which was not copied');
    return map[id] + ' ' + gen + ' R';
  });
  return head + rest;
}

function catalogPagesId_(parsed) {
  var objects = parsed && parsed.objects ? parsed.objects : {};
  function pagesFrom_(body) {
    if (!body) return 0;
    var dict = dictHead_(body);
    if (!pdfType_(dict, 'Catalog')) return 0;
    var pages = refsInArray_(dict, 'Pages');
    return pages.length === 1 ? pages[0] : 0;
  }
  var rootBody = objects[parsed.root];
  var fromRoot = pagesFrom_(rootBody);
  if (fromRoot) return fromRoot;
  if (rootBody && pdfType_(dictHead_(rootBody), 'Pages')) return Number(parsed.root);
  var ids = Object.keys(objects);
  for (var i = 0; i < ids.length; i++) {
    var found = pagesFrom_(objects[ids[i]]);
    if (found) return found;
  }
  throw new Error('pdf catalog is missing');
}

function ensureMediaBox_(body, box) {
  if (!box) throw new Error('pdf page has no media box');
  if (/\/MediaBox\s*\[/.test(dictHead_(body))) return body;
  return body.replace('<<', '<< /MediaBox [' + box + ']');
}

/**
 * One PDF built by copying page objects. Input bytes are not modified.
 * @param {Array<Array<number>|Buffer>} pdfList
 * @return {number[]}
 */
function mergePdfBytes(pdfList, names) {
  var inputs = pdfList || [];
  if (!inputs.length) throw new Error('no pdfs to merge');
  var pages = [];
  var copied = [];
  for (var i = 0; i < inputs.length; i++) {
    var label = names && names[i] ? names[i] : 'merge input ' + (i + 1);
    if (!isPdfHeader_(inputs[i])) throw new Error(label + ' is not a pdf');
    try {
      var parsed = parsePdf_(inputs[i]);
      var treeId = catalogPagesId_(parsed);
      var found = [];
      var pageTreeIds = {};
      collectPdfPages_(parsed.objects, treeId, '', found, pageTreeIds);
      pageTreeIds[parsed.root] = false;
      var keep = {};
      var objectIds = Object.keys(parsed.objects);
      for (var k = 0; k < objectIds.length; k++) {
        var id = Number(objectIds[k]);
        if (id === parsed.root || pageTreeIds[id]) continue;
        keep[id] = parsed.objects[id];
      }
      copied.push({ keep: keep, pages: found, pageTreeIds: pageTreeIds });
      for (var p = 0; p < found.length; p++) pages.push(found[p]);
    } catch (error) {
      var message = error && error.message ? error.message : String(error);
      throw new Error(label + ': ' + message);
    }
  }
  var nextId = 3;
  var parts = ['%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'];
  var objects = [];
  function pushObject(id, body) {
    var chunk = id + ' 0 obj\n' + body + '\nendobj\n';
    objects.push({ id: id, offset: parts.join('').length, chunk: chunk });
    parts.push(chunk);
  }
  var kids = [];
  for (var c = 0; c < copied.length; c++) {
    var group = copied[c];
    var map = {};
    var ids = Object.keys(group.keep);
    for (var n = 0; n < ids.length; n++) {
      map[Number(ids[n])] = nextId;
      nextId++;
    }
    for (var page = 0; page < group.pages.length; page++) {
      var oldId = group.pages[page].id;
      kids.push(map[oldId] + ' 0 R');
      var body = ensureMediaBox_(group.keep[oldId], group.pages[page].mediaBox);
      body = rewritePdfRefs_(body, map, group.pageTreeIds, 2);
      if (!/\/Parent\s+\d+\s+\d+\s+R/.test(dictHead_(body))) {
        body = body.replace('<<', '<< /Parent 2 0 R');
      }
      group.keep[oldId] = body;
    }
    for (n = 0; n < ids.length; n++) {
      var sourceId = Number(ids[n]);
      var rewritten = group.keep[sourceId];
      if (group.pages.every(function (item) { return item.id !== sourceId; })) {
        rewritten = rewritePdfRefs_(rewritten, map, group.pageTreeIds, 2);
      }
      pushObject(map[sourceId], rewritten);
    }
  }
  var pagesBody = '<< /Type /Pages /Count ' + kids.length + ' /Kids [' + kids.join(' ') + '] >>';
  var catalogBody = '<< /Type /Catalog /Pages 2 0 R >>';
  var prefix = parts.join('');
  var pagesChunk = '2 0 obj\n' + pagesBody + '\nendobj\n';
  var catalogChunk = '1 0 obj\n' + catalogBody + '\nendobj\n';
  var pagesOffset = prefix.length;
  var catalogOffset = pagesOffset + pagesChunk.length;
  var bodyText = prefix + pagesChunk + catalogChunk;
  var size = nextId;
  var xref = 'xref\n0 ' + size + '\n';
  xref += '0000000000 65535 f \n';
  var offsets = { 1: catalogOffset, 2: pagesOffset };
  for (var o = 0; o < objects.length; o++) offsets[objects[o].id] = objects[o].offset;
  for (var idNum = 1; idNum < size; idNum++) {
    var at = offsets[idNum];
    if (at == null) throw new Error('pdf object ' + idNum + ' was not written');
    xref += ('0000000000' + at).slice(-10) + ' 00000 n \n';
  }
  var xrefAt = bodyText.length;
  var trailer = 'trailer\n<< /Size ' + size + ' /Root 1 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF\n';
  return toByteArray_(bodyText + xref + trailer);
}

function pdfPageCount(bytes) {
  var parsed = parsePdf_(bytes);
  var root = parsed.objects[parsed.root];
  var tree = refsInArray_(dictHead_(root), 'Pages');
  var found = [];
  collectPdfPages_(parsed.objects, tree[0], '', found, {});
  return found.length;
}

function jpegSize_(bytes) {
  var data = toByteArray_(bytes);
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) throw new Error('not a jpeg');
  var i = 2;
  while (i + 8 < data.length) {
    if (data[i] !== 0xff) {
      i++;
      continue;
    }
    var marker = data[i + 1];
    if (marker === 0xd8 || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9) break;
    if (marker >= 0xc0 && marker <= 0xc2) {
      return { height: (data[i + 5] << 8) + data[i + 6], width: (data[i + 7] << 8) + data[i + 8] };
    }
    var length = (data[i + 2] << 8) + data[i + 3];
    if (length < 2) throw new Error('bad jpeg marker');
    i += 2 + length;
  }
  throw new Error('jpeg size was not found');
}

/** A one-page PDF whose only image is the JPEG bytes. */
function jpegToPdfBytes(bytes) {
  var data = toByteArray_(bytes);
  var size = jpegSize_(data);
  var pageW = 595.28;
  var pageH = 841.89;
  var scale = Math.min(pageW / size.width, pageH / size.height);
  var drawW = Math.round(size.width * scale * 100) / 100;
  var drawH = Math.round(size.height * scale * 100) / 100;
  var x = Math.round(((pageW - drawW) / 2) * 100) / 100;
  var y = Math.round(((pageH - drawH) / 2) * 100) / 100;
  var content = 'q\n' + drawW + ' 0 0 ' + drawH + ' ' + x + ' ' + y + ' cm\n/Im Do\nQ\n';
  var header = '%PDF-1.4\n';
  var objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Count 1 /Kids [3 0 R] >>');
  objects.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageW + ' ' + pageH + '] /Resources << /XObject << /Im 4 0 R >> >> /Contents 5 0 R >>'
  );
  objects.push(
    '<< /Type /XObject /Subtype /Image /Width ' + size.width + ' /Height ' + size.height +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + data.length + ' >>\nstream\n'
  );
  objects.push('<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream');
  var out = header;
  var offsets = [0];
  for (var i = 0; i < objects.length; i++) {
    offsets.push(out.length);
    if (i === 3) {
      out += (i + 1) + ' 0 obj\n' + objects[i];
      out += bytesToLatin1_(data);
      out += '\nendstream\nendobj\n';
    } else {
      out += (i + 1) + ' 0 obj\n' + objects[i] + '\nendobj\n';
    }
  }
  var xrefAt = out.length;
  var xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (var n = 1; n < offsets.length; n++) {
    xref += ('0000000000' + offsets[n]).slice(-10) + ' 00000 n \n';
  }
  out += xref + 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF\n';
  return toByteArray_(out);
}

function writeMonthlySummary(rows, month) {
  var summary = summarizeMonth(rowsForMonth(rows, month));
  var sheet = comparisonSheet_();
  var existing = sheet.getLastRow() === 0 ? [] : sheet.getDataRange().getValues();
  var grid = withMonthlySummary(existing, summary, month);
  sheet.clearContents();
  if (grid.length) sheet.getRange(1, 1, grid.length, grid[0].length).setValues(grid);
  return summary;
}

/**
 * Merges COPIES of the month's files into YYYY-MM_merged.pdf.
 * Originals are checked before and after. Copies are trashed.
 * NOT_INVOICE and DUPLICATE rows are not copied.
 * @return {{fileId: string, url: string, pages: number, name: string, originals: Array<Object>}}
 */
function createMergedInvoicePdf(rows, month, options) {
  var folderId = getConfig().invoices_folder_id;
  if (!folderId) throw new Error('invoices_folder_id is empty');
  var folder = DriveApp.getFolderById(folderId);
  if (folder.getName() !== month) throw new Error('invoices folder is "' + folder.getName() + '"');
  var selected = selectMergeFiles(rowsForMonth(rows, month));
  var copies = [];
  var before = [];
  try {
    var pdfs = [];
    var names = [];
    var spans = [];
    var i;
    for (i = 0; i < selected.length; i++) {
      var original = DriveApp.getFileById(selected[i].id);
      before.push({
        id: original.getId(),
        name: original.getName(),
        size: original.getSize(),
        updated: original.getLastUpdated().getTime()
      });
      var copy = original.makeCopy('__merge_copy_' + original.getName(), folder);
      copies.push(copy);
      names.push(original.getName());
      try {
        var ready = bytesReadyForMerge_(bytesForMergeCopy_(copy), original.getName());
        pdfs.push(ready);
        var count = pdfPageCount(ready);
        var texts = [];
        try {
          texts = extractPdfPageTexts(ready);
        } catch (ignore) {
          texts = [];
        }
        spans.push({
          id: original.getId(),
          name: original.getName(),
          pages: count,
          keepLocal: texts.length === count ? keywordPages(texts, getConfig()) : null
        });
      } catch (error) {
        throw new Error(original.getName() + ': ' + (error && error.message ? error.message : error));
      }
    }
    var name = options && options.name ? String(options.name) : mergedPdfName(month);
    if (!pdfs.length) return { fileId: '', url: '', pages: 0, name: name, originals: before, notices: [] };
    var merged = mergePdfBytes(pdfs, names);
    var created = folder.createFile(Utilities.newBlob(toByteArray_(merged), 'application/pdf', name));
    var previous = folder.getFilesByName(name);
    while (previous.hasNext()) {
      var oldFile = previous.next();
      if (oldFile.getId() !== created.getId()) oldFile.setTrashed(true);
    }
    for (i = 0; i < before.length; i++) {
      var again = DriveApp.getFileById(before[i].id);
      if (again.getSize() !== before[i].size || again.getLastUpdated().getTime() !== before[i].updated) {
        throw new Error('Original changed: ' + again.getName());
      }
    }
    return {
      fileId: created.getId(),
      url: created.getUrl(),
      pages: pdfPageCount(merged),
      name: name,
      originals: before,
      notices: multipageNotes(spans)
    };
  } finally {
    for (var c = 0; c < copies.length; c++) {
      try {
        copies[c].setTrashed(true);
      } catch (ignore) {}
    }
  }
}

/**
 * Turns a PDF our merger cannot read into a plain PDF.
 * Uses a Drive copy with OCR off. The original file is not opened here.
 */
function normalizePdfForMerge_(bytes, name) {
  if (typeof Drive === 'undefined' || !Drive.Files || typeof Drive.Files.insert !== 'function') {
    throw new Error('pdf could not be normalized');
  }
  var created = null;
  try {
    created = Drive.Files.insert(
      { title: '__merge_norm__', mimeType: 'application/vnd.google-apps.document' },
      Utilities.newBlob(toByteArray_(bytes), 'application/pdf', name || 'invoice.pdf'),
      { convert: true, ocr: false }
    );
    return DriveApp.getFileById(created.id).getAs('application/pdf').getBytes();
  } finally {
    if (created && created.id) {
      try {
        DriveApp.getFileById(created.id).setTrashed(true);
      } catch (ignore) {}
    }
  }
}

function bytesReadyForMerge_(bytes, name) {
  try {
    parsePdf_(bytes);
    return toByteArray_(bytes);
  } catch (error) {
    var normalized = normalizePdfForMerge_(bytes, name);
    parsePdf_(normalized);
    return toByteArray_(normalized);
  }
}

function bytesForMergeCopy_(file) {
  var mime = String(file.getMimeType() || '').toLowerCase();
  var raw = file.getBlob().getBytes();
  if (mime === 'application/pdf' || isPdfHeader_(raw)) return raw;
  if (mime === 'image/jpeg' || mime === 'image/jpg' || (raw.length > 2 && (raw[0] & 255) === 0xff && (raw[1] & 255) === 0xd8)) {
    return jpegToPdfBytes(raw);
  }
  return file.getBlob().getAs('application/pdf').getBytes();
}

function comparisonSheet_() {
  var sheet = openCollectorSpreadsheet_().getSheetByName('Comparison');
  if (!sheet) throw new Error('Comparison tab is missing. Run setupCollectorSheet().');
  return sheet;
}

function readAnswerKeyRows() {
  var sheet = openCollectorSpreadsheet_().getSheetByName('AnswerKey');
  if (!sheet) throw new Error('AnswerKey tab is missing. Run setupCollectorSheet().');
  if (sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = {};
    var blank = true;
    for (var c = 0; c < headers.length; c++) {
      var key = String(headers[c] || '').trim();
      if (!key) continue;
      row[key] = values[r][c];
      if (values[r][c] !== '' && values[r][c] != null) blank = false;
    }
    if (!blank) rows.push(row);
  }
  return rows;
}

/**
 * Writes one Comparison row per field. Replaces the previous accuracy grid.
 * @return {{rows: Array<Object>, pairs: number, unmatched: number}}
 */
function writeAccuracyReport(invoices, answerKey) {
  var report = compareInvoicesToAnswerKey(invoices, answerKey);
  var grid = comparisonGrid(report.rows);
  var sheet = comparisonSheet_();
  sheet.clearContents();
  sheet.getRange(1, 1, grid.length, grid[0].length).setValues(grid);
  return report;
}

if (typeof module !== 'undefined') {
  module.exports = {
    ACCURACY_FIELDS: ACCURACY_FIELDS,
    fieldValuesEqual: fieldValuesEqual,
    matchPercentNumber: matchPercentNumber,
    matchPercentsEqual: matchPercentsEqual,
    compareInvoicesToAnswerKey: compareInvoicesToAnswerKey,
    comparisonGrid: comparisonGrid,
    rowFileStem_: rowFileStem_,
    summarizeMonth: summarizeMonth,
    rowsForMonth: rowsForMonth,
    summaryGrid: summaryGrid,
    withMonthlySummary: withMonthlySummary,
    driveIdFromLink: driveIdFromLink,
    selectMergeFiles: selectMergeFiles,
    multipageNote: multipageNote,
    multipageNotes: multipageNotes,
    noticeLines_: noticeLines_,
    mergedPdfName: mergedPdfName,
    mergePdfBytes: mergePdfBytes,
    jpegToPdfBytes: jpegToPdfBytes,
    pdfPageCount: pdfPageCount,
    inflateZlib_: inflateZlib_,
    pngUnpredict_: pngUnpredict_
  };
}
