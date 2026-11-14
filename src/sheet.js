/**
 * RunLog rows and the resume cursor.
 * One row per run. The cursor is the next fixture index to process.
 */

var COLLECT_CURSOR_PROPERTY = 'COLLECT_CURSOR';
var RUN_TIME_BUDGET_MS = 5 * 60 * 1000;

function parseCursor(value) {
  if (value == null || value === '') return 0;
  var number = Number(value);
  if (!isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function normalizeBatchSize(value, fallback) {
  var number = Number(value);
  if (!isFinite(number) || number < 1) return fallback;
  return Math.floor(number);
}

function hasUnprocessedFrom_(items, start) {
  for (var i = start; i < items.length; i++) {
    if (!items[i].processed) return true;
  }
  return false;
}

/**
 * Takes the next batch of unlabeled items. Cursor is an index into items.
 * An empty nextCursor means the queue is finished.
 * @param {Array<{processed?: boolean}>} items
 * @param {string|number} savedCursor
 * @param {number} batchSize
 * @return {{batch: Array<{index: number, item: Object}>, start: number, nextCursor: string, done: boolean}}
 */
function planBatch(items, savedCursor, batchSize) {
  var rows = items || [];
  var total = rows.length;
  var size = normalizeBatchSize(batchSize, total || 1);
  var start = parseCursor(savedCursor);
  if (start > total) start = 0;
  if (!hasUnprocessedFrom_(rows, start)) {
    if (start === 0 || !hasUnprocessedFrom_(rows, 0)) {
      return { batch: [], start: 0, nextCursor: '', done: true };
    }
    start = 0;
  }
  var batch = [];
  var index = start;
  while (index < total && batch.length < size) {
    if (!rows[index].processed) batch.push({ index: index, item: rows[index] });
    index++;
  }
  var done = !hasUnprocessedFrom_(rows, index);
  return {
    batch: batch,
    start: start,
    nextCursor: done ? '' : String(index),
    done: done
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

/**
 * @param {Object|null} entry last RunLog row
 * @return {number}
 */
function resumeCursor(entry) {
  if (!entry) return 0;
  var status = String(entry.status || '');
  if (status === 'partial' || status === 'running' || status === 'error') {
    return parseCursor(entry.cursor);
  }
  return 0;
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
  if (raw != null && raw !== '') return parseCursor(raw);
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

if (typeof module !== 'undefined') {
  module.exports = {
    COLLECT_CURSOR_PROPERTY: COLLECT_CURSOR_PROPERTY,
    RUN_TIME_BUDGET_MS: RUN_TIME_BUDGET_MS,
    parseCursor: parseCursor,
    normalizeBatchSize: normalizeBatchSize,
    planBatch: planBatch,
    runShouldStop: runShouldStop,
    resumeCursor: resumeCursor,
    buildRunLogRow: buildRunLogRow
  };
}
