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
    buildRunLogRow: buildRunLogRow
  };
}
