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
    compareInvoicesToAnswerKey: compareInvoicesToAnswerKey,
    comparisonGrid: comparisonGrid,
    rowFileStem_: rowFileStem_
  };
}
