/**
 * RunLog rows and the resume cursor.
 * One row per run. Progress is the processed label, not a list index.
 * The cursor stored on the row is the last message id handled in that run.
 */

var COLLECT_CURSOR_PROPERTY = 'COLLECT_CURSOR';
var RUN_TIME_BUDGET_MS = 5 * 60 * 1000;

function normalizeBatchSize(value, fallback) {
  var number = Number(value);
  if (!isFinite(number) || number < 1) return fallback;
  return Math.floor(number);
}

/**
 * Next unlabeled messages, in list order. Labels are the progress marker,
 * so a saved index is not applied to this list.
 * @param {Array<{id?: string, processed?: boolean}>} items
 * @param {number} batchSize
 * @return {{batch: Array<{index: number, item: Object}>, nextCursor: string, done: boolean}}
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
  var last = batch.length ? batch[batch.length - 1].item : null;
  return {
    batch: batch,
    nextCursor: more && last && last.id ? String(last.id) : '',
    done: !more
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

if (typeof module !== 'undefined') {
  module.exports = {
    COLLECT_CURSOR_PROPERTY: COLLECT_CURSOR_PROPERTY,
    RUN_TIME_BUDGET_MS: RUN_TIME_BUDGET_MS,
    normalizeBatchSize: normalizeBatchSize,
    planBatch: planBatch,
    runShouldStop: runShouldStop,
    resumeCursor: resumeCursor,
    buildRunLogRow: buildRunLogRow
  };
}
