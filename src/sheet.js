/**
 * RunLog rows.
 * One row per run. The processed label is the only progress state.
 * A run takes the first batch of unlabeled messages. It does not resume
 * from a message id or a list index.
 */

var COLLECT_CURSOR_PROPERTY = 'COLLECT_CURSOR';
var RUN_TIME_BUDGET_MS = 5 * 60 * 1000;

function normalizeBatchSize(value, fallback) {
  var number = Number(value);
  if (!isFinite(number) || number < 1) return fallback;
  return Math.floor(number);
}

/**
 * First unlabeled messages, in list order, up to batchSize.
 * `done` means there is nothing to process. `finishes` means this batch
 * includes every unlabeled message, including a short tail.
 * A message id is not an input. Sharing a threadId does not skip a message.
 * @param {Array<{id?: string, processed?: boolean}>} items
 * @param {number} batchSize
 * @return {{batch: Array<{index: number, item: Object}>, nextCursor: string, done: boolean, finishes: boolean}}
 */
function planBatch(items, batchSize) {
  var rows = items || [];
  var size = normalizeBatchSize(batchSize, rows.length || 1);
  var batch = [];
  var i;
  for (i = 0; i < rows.length && batch.length < size; i++) {
    if (rows[i].processed) continue;
    batch.push({ index: i, item: rows[i] });
  }
  var taken = {};
  for (i = 0; i < batch.length; i++) taken[batch[i].item.id] = true;
  var more = false;
  for (i = 0; i < rows.length; i++) {
    if (rows[i].processed || taken[rows[i].id]) continue;
    more = true;
    break;
  }
  return {
    batch: batch,
    nextCursor: '',
    done: batch.length === 0,
    finishes: !more
  };
}

/**
 * Why each fixture is in this run or not. Labels decide. No cursor.
 * @param {Array<{id?: string, threadId?: string, subject?: string, processed?: boolean}>} items
 * @param {number} batchSize
 * @return {{rows: Array<Object>, batch: Array<Object>, idle: boolean, finishes: boolean, selectedIds: string[]}}
 */
function describeFixtureBatch(items, batchSize) {
  var plan = planBatch(items, batchSize);
  var selected = {};
  var i;
  for (i = 0; i < plan.batch.length; i++) selected[String(plan.batch[i].item.id)] = true;
  var rows = [];
  var list = items || [];
  for (i = 0; i < list.length; i++) {
    var item = list[i] || {};
    var hasLabel = !!item.processed;
    var id = item.id == null ? '' : String(item.id);
    var decision = 'skipped';
    var reason;
    if (hasLabel) reason = 'has processed label';
    else if (selected[id]) {
      decision = 'selected';
      reason = 'unlabeled, within first batch_size';
    } else reason = 'unlabeled, after the first batch_size';
    rows.push({
      subject: item.subject == null ? '' : String(item.subject),
      threadId: item.threadId == null ? '' : String(item.threadId),
      messageId: id,
      hasLabel: hasLabel,
      decision: decision,
      reason: reason
    });
  }
  var selectedIds = [];
  for (i = 0; i < plan.batch.length; i++) selectedIds.push(String(plan.batch[i].item.id));
  return {
    rows: rows,
    batch: plan.batch,
    idle: plan.done,
    finishes: plan.finishes,
    selectedIds: selectedIds
  };
}

/**
 * One run with no time limit: the first unlabeled batch, or nothing.
 * A short tail is processed. `finishes` does not mean the run is idle.
 * @return {{processed: number, status: string, idle: boolean, finishes: boolean, rows: Array<Object>, batch: Array<Object>}}
 */
function fixtureRunSelection(items, batchSize) {
  var described = describeFixtureBatch(items, batchSize);
  if (described.idle) {
    return {
      processed: 0,
      status: 'ok',
      idle: true,
      finishes: true,
      rows: described.rows,
      batch: []
    };
  }
  return {
    processed: described.batch.length,
    status: described.finishes ? 'ok' : 'partial',
    idle: false,
    finishes: described.finishes,
    rows: described.rows,
    batch: described.batch
  };
}

/**
 * Stop before the next message when the batch is full or the time budget is spent.
 * @return {string} 'time', 'batch', or ''
 */
function runShouldStop(startedMs, nowMs, budgetMs, processedCount, batchSize) {
  if (budgetMs != null && nowMs - startedMs >= budgetMs) return 'time';
  if (batchSize && processedCount >= batchSize) return 'batch';
  return '';
}

/** A bare number is the old list index. It is not a message id. */
function messageIdCursor_(value) {
  var text = value == null ? '' : String(value).trim();
  if (!text || /^\d+$/.test(text)) return '';
  return text;
}

/**
 * Last message id on an unfinished run. Index cursors are ignored.
 * @param {Object|null} entry last RunLog row
 * @return {string}
 */
function resumeCursor(entry) {
  if (!entry) return '';
  var status = String(entry.status || '');
  if (status === 'partial' || status === 'running' || status === 'error') {
    return messageIdCursor_(entry.cursor);
  }
  return '';
}

/**
 * @param {Object} entry
 * @return {Array<*>} cells in RUN_LOG_HEADERS order
 */
function buildRunLogRow(entry) {
  var source = entry || {};
  return [
    source.startedAt == null ? '' : source.startedAt,
    source.finishedAt == null ? '' : source.finishedAt,
    source.mode == null ? '' : source.mode,
    source.messages || 0,
    source.files || 0,
    source.rows || 0,
    source.errors == null ? '' : source.errors,
    source.status == null ? '' : source.status,
    source.cursor == null ? '' : source.cursor
  ];
}

function runLogSheet_() {
  var sheet = openCollectorSpreadsheet_().getSheetByName('RunLog');
  if (!sheet) throw new Error('RunLog tab is missing. Run setupCollectorSheet().');
  if (sheet.getLastRow() === 0) sheet.appendRow(RUN_LOG_HEADERS.slice());
  return sheet;
}

function beginRunLog_(entry) {
  var sheet = runLogSheet_();
  sheet.appendRow(buildRunLogRow(entry));
  return sheet.getLastRow();
}

function updateRunLog_(rowNumber, entry) {
  var sheet = runLogSheet_();
  var row = buildRunLogRow(entry);
  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  return rowNumber;
}

function readLastRunLogEntry_() {
  var sheet = runLogSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var values = sheet.getRange(last, 1, 1, RUN_LOG_HEADERS.length).getValues()[0];
  var entry = {};
  for (var i = 0; i < RUN_LOG_HEADERS.length; i++) entry[RUN_LOG_HEADERS[i]] = values[i];
  return entry;
}

function loadCollectCursor_() {
  var raw = PropertiesService.getScriptProperties().getProperty(COLLECT_CURSOR_PROPERTY);
  if (raw != null && raw !== '') return messageIdCursor_(raw);
  return resumeCursor(readLastRunLogEntry_());
}

function saveCollectCursor_(cursor) {
  var value = cursor == null || cursor === '' ? '' : String(cursor);
  var props = PropertiesService.getScriptProperties();
  if (!value) props.deleteProperty(COLLECT_CURSOR_PROPERTY);
  else props.setProperty(COLLECT_CURSOR_PROPERTY, value);
  return value;
}

function clearCollectCursor_() {
  PropertiesService.getScriptProperties().deleteProperty(COLLECT_CURSOR_PROPERTY);
}

function invoiceSourceId(source) {
  var text = String(source || '').trim();
  if (!text) return '';
  return text.split(/\s+/)[0];
}

function invoiceDocKey(row) {
  var vendor = row && row.vendor_id != null ? String(row.vendor_id).trim() : '';
  var number = row && row.doc_number != null ? String(row.doc_number).trim() : '';
  if (!vendor || !number) return '';
  return vendor + '|' + number;
}

/**
 * Skip a source already stored. A new source with the same vendor id and
 * document number is kept once and marked DUPLICATE.
 * @return {Array<Object>}
 */
function planInvoiceRows(existing, incoming) {
  var seenSource = {};
  var seenDoc = {};
  var rows = existing || [];
  var i;
  for (i = 0; i < rows.length; i++) {
    var sourceId = invoiceSourceId(rows[i] && rows[i].source);
    if (sourceId) seenSource[sourceId] = true;
    var docKey = invoiceDocKey(rows[i]);
    if (docKey) seenDoc[docKey] = true;
  }
  var writes = [];
  var batch = incoming || [];
  for (i = 0; i < batch.length; i++) {
    var row = batch[i] || {};
    var id = invoiceSourceId(row.source);
    if (id && seenSource[id]) continue;
    var key = invoiceDocKey(row);
    var copy = {};
    var fields = Object.keys(row);
    for (var k = 0; k < fields.length; k++) copy[fields[k]] = row[fields[k]];
    if (key && seenDoc[key]) copy.status = 'DUPLICATE';
    writes.push(copy);
    if (id) seenSource[id] = true;
    if (key) seenDoc[key] = true;
  }
  return writes;
}

var SHEET_DATE_FORMAT = 'yyyy-mm-dd';

/**
 * One calendar date for DD/MM/YYYY and YYYY-MM-DD. Blank stays blank.
 * @return {Date|string}
 */
function sheetDateValue(value) {
  if (value == null || value === '') return '';
  var year;
  var month;
  var day;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    year = value.getFullYear();
    month = value.getMonth() + 1;
    day = value.getDate();
  } else {
    var text = String(value).trim();
    var iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    var dmy = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (iso) {
      year = Number(iso[1]);
      month = Number(iso[2]);
      day = Number(iso[3]);
    } else if (dmy) {
      year = Number(dmy[3]);
      month = Number(dmy[2]);
      day = Number(dmy[1]);
    } else {
      return '';
    }
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return new Date(year, month - 1, day);
}

function invoiceNumberFormat(key) {
  if (key === 'doc_date') return SHEET_DATE_FORMAT;
  if (key === 'vendor_id' || key === 'doc_number' || key === 'allocation_number' || key === 'source') {
    return '@';
  }
  return 'General';
}

function buildInvoiceRow(entry) {
  var source = entry || {};
  return INVOICE_HEADERS.map(function (key) {
    var value = source[key];
    if (value == null || value === '') return '';
    if (key === 'doc_date') return sheetDateValue(value);
    return value;
  });
}

function invoiceSheet_() {
  var sheet = openCollectorSpreadsheet_().getSheetByName('Invoices');
  if (!sheet) throw new Error('Invoices tab is missing. Run setupCollectorSheet().');
  if (sheet.getLastRow() === 0) sheet.appendRow(INVOICE_HEADERS.slice());
  return sheet;
}

function readInvoiceRows() {
  var sheet = invoiceSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = {};
    var blank = true;
    for (var c = 0; c < INVOICE_HEADERS.length; c++) {
      row[INVOICE_HEADERS[c]] = values[r][c];
      if (values[r][c] !== '' && values[r][c] != null) blank = false;
    }
    if (!blank) rows.push(row);
  }
  return rows;
}

/**
 * Appends rows that are not already on the sheet. A second call adds nothing.
 * @return {{added: number, skipped: number}}
 */
function appendInvoiceRows(rows) {
  var incoming = rows || [];
  var writes = planInvoiceRows(readInvoiceRows(), incoming);
  if (!writes.length) return { added: 0, skipped: incoming.length };
  var sheet = invoiceSheet_();
  var grid = writes.map(buildInvoiceRow);
  var formats = grid.map(function () {
    return INVOICE_HEADERS.map(invoiceNumberFormat);
  });
  var range = sheet.getRange(sheet.getLastRow() + 1, 1, grid.length, INVOICE_HEADERS.length);
  range.setNumberFormats(formats);
  range.setValues(grid);
  return { added: writes.length, skipped: incoming.length - writes.length };
}

if (typeof module !== 'undefined') {
  module.exports = {
    COLLECT_CURSOR_PROPERTY: COLLECT_CURSOR_PROPERTY,
    RUN_TIME_BUDGET_MS: RUN_TIME_BUDGET_MS,
    normalizeBatchSize: normalizeBatchSize,
    planBatch: planBatch,
    describeFixtureBatch: describeFixtureBatch,
    fixtureRunSelection: fixtureRunSelection,
    runShouldStop: runShouldStop,
    resumeCursor: resumeCursor,
    buildRunLogRow: buildRunLogRow,
    invoiceSourceId: invoiceSourceId,
    planInvoiceRows: planInvoiceRows,
    buildInvoiceRow: buildInvoiceRow,
    sheetDateValue: sheetDateValue,
    invoiceNumberFormat: invoiceNumberFormat,
    SHEET_DATE_FORMAT: SHEET_DATE_FORMAT
  };
}
