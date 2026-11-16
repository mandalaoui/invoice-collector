/**
 * Monthly publish: summary, merged PDF, and the accountant draft.
 * The draft is never sent. A failure mail goes to owner_email only.
 */

var MONTHLY_TRIGGER_HANDLER = 'runMonthlyJob';

function monthlyTriggerSpec() {
  return { handler: MONTHLY_TRIGGER_HANDLER, day: 2, hour: 8 };
}

function collectInvoices() {
  return runMonthlyJob();
}

function todayYmd_() {
  var zone = Session.getScriptTimeZone() || 'Asia/Jerusalem';
  return Utilities.formatDate(new Date(), zone, 'yyyy-MM-dd');
}

function noInvoicesError_(month, collected) {
  var text = 'no invoices for ' + month;
  var logs = collected && collected.queryLogs ? collected.queryLogs : [];
  if (logs.length) text += ' | ' + logs.join(' | ');
  return new Error(text);
}

function clientExtractConfig_(config, month) {
  var copy = {};
  var source = config || {};
  var keys = Object.keys(source);
  for (var i = 0; i < keys.length; i++) copy[keys[i]] = source[keys[i]];
  copy.month = month;
  return copy;
}

function clientSourceKey_(plan) {
  if (plan.source === 'body-pdf') return plan.messageId + '#body';
  return plan.messageId + '#' + String(plan.attachmentIndex);
}

function rowAlreadyStored_(rows, sourceKey) {
  var list = rows || [];
  for (var i = 0; i < list.length; i++) {
    if (invoiceSourceId(list[i] && list[i].source) === sourceKey) return true;
  }
  return false;
}

function clientAttachments_(message) {
  try {
    return message.getAttachments({ includeInlineImages: false, includeAttachments: true });
  } catch (ignore) {
    return message.getAttachments();
  }
}

function readClientSource_(plan) {
  var message = GmailApp.getMessageById(plan.messageId);
  if (!message) throw new Error('Gmail message was not found');
  if (plan.source === 'body-pdf') {
    var fileName = buildInvoiceFileName(plan.date, plan.vendor, plan.originalName);
    return { pdfBytes: htmlBodyToPdfBlob(message.getBody(), fileName).getBytes() };
  }
  var files = clientAttachments_(message);
  var match = null;
  if (plan.attachmentIndex >= 0 && plan.attachmentIndex < files.length) {
    if (files[plan.attachmentIndex].getName() === plan.attachmentName) match = files[plan.attachmentIndex];
  }
  if (!match) {
    for (var i = 0; i < files.length; i++) {
      if (files[i].getName() === plan.attachmentName) {
        match = files[i];
        break;
      }
    }
  }
  if (!match) throw new Error('Attachment ' + plan.attachmentName + ' is not on the message');
  return { bytes: match.getBytes(), mime: match.getContentType() };
}

function storeClientPlan_(plan, month, settings, existing, folder, config) {
  var target = folder;
  if (!target) {
    target = ensureMonthFolder(config.invoices_folder_id, month);
    rememberInvoicesFolderId(target.getId());
  }
  var saved = savePlannedCopies([plan], target, readClientSource_);
  if (!saved.length) throw new Error('file was not saved');
  var file = DriveApp.getFileById(saved[0].id);
  var read = readDriveFileText(file);
  var fields = extractInvoice(read.text, settings, {
    senderEmail: emailFromHeader(plan.from),
    senderName: plan.vendor
  });
  fields.status = classifyInvoice(fields, settings, existing).status;
  fields.source = clientSourceKey_(plan);
  fields.file_link = file.getUrl();
  appendInvoiceRows([fields]);
  return { folder: target, row: fields };
}

/**
 * Searches Gmail with Settings queries, the month window, and -label.
 * Does not filter by fixture subject. Saves new files and writes sheet rows.
 * @param {Object} config
 * @param {{messageLimit?: number, documentLimit?: number}=} limit
 * @return {{month: string, messages: number, rows: number, queryLogs: string[]}}
 */
function collectClientMonth(config, limit) {
  var source = config || {};
  var month = resolveCollectMonth(source.month, source.today || todayYmd_());
  var plan = buildCollectQueries({
    month: month,
    today: source.today || todayYmd_(),
    processed_label: source.processed_label,
    search_queries: source.search_queries,
    vendor_whitelist: source.vendor_whitelist
  });
  var zone = Session.getScriptTimeZone() || 'Asia/Jerusalem';
  var searched = readClientMessages(plan.queries, zone);
  var selected = selectCollectMessages(searched.messages, {
    month: plan.month,
    processedLabel: source.processed_label
  });
  var keptLine = 'gmail kept=' + selected.length + ' month=' + plan.month;
  searched.queryLogs.push(keptLine);
  if (typeof Logger !== 'undefined' && Logger.log) Logger.log(keptLine);
  var plans = planClientSaves(selected);
  var capped = limitCollectPlans(plans, limit || {});
  var existing = readInvoiceRows();
  var settings = clientExtractConfig_(source, plan.month);
  var startedAt = Date.now();
  var seen = {};
  var processed = 0;
  var written = 0;
  var folder = null;
  var finished = [];
  for (var i = 0; i < capped.length; i++) {
    var item = capped[i];
    if (!seen[item.messageId]) {
      if (runShouldStop(startedAt, Date.now(), RUN_TIME_BUDGET_MS, processed, 0) === 'time') break;
      seen[item.messageId] = true;
      processed++;
    }
    var key = clientSourceKey_(item);
    if (!rowAlreadyStored_(existing, key)) {
      var stored = storeClientPlan_(item, plan.month, settings, existing, folder, source);
      folder = stored.folder;
      existing.push(stored.row);
      written++;
    }
    finished.push(item);
  }
  var threadIds = clientThreadsToLabel(plans, finished);
  if (threadIds.length) labelClientThreads(threadIds, source.processed_label || 'invoices/processed');
  return {
    month: plan.month,
    messages: processed,
    rows: written,
    queryLogs: searched.queryLogs
  };
}

/**
 * Summary, merged PDF, and draft for the Settings month.
 * @return {Object}
 */
function runMonthlyJob() {
  var config = getConfig();
  var month = resolveCollectMonth(config.month, todayYmd_());
  var started = new Date();
  var entry = {
    startedAt: started,
    finishedAt: '',
    mode: config.mode,
    messages: 0,
    files: 0,
    rows: 0,
    errors: '',
    status: 'running',
    cursor: ''
  };
  var logRow = beginRunLog_(entry);
  try {
    var collected = collectClientMonth(config, {
      messageLimit: normalizeBatchSize(config.batch_size, 20)
    });
    entry.messages = collected.messages || 0;
    var result = publishMonth_(config, month, collected);
    entry.finishedAt = new Date();
    entry.files = result.pages || 0;
    entry.rows = result.documents || 0;
    entry.status = 'ok';
    updateRunLog_(logRow, entry);
    return result;
  } catch (error) {
    var message = error && error.message ? String(error.message) : String(error);
    entry.finishedAt = new Date();
    entry.errors = message.slice(0, 500);
    entry.status = 'error';
    try {
      updateRunLog_(logRow, entry);
    } catch (ignore) {}
    sendOwnerError_(error, month, config.owner_email);
    throw error;
  }
}

function publishMonth_(config, month, collected) {
  var invoices = rowsForMonth(readInvoiceRows(), month);
  if (!invoices.length) throw noInvoicesError_(month, collected);
  var answers = rowsForMonth(readAnswerKeyRows(), month);
  if (answers.length) writeAccuracyReport(invoices, answers);
  var summary = writeMonthlySummary(invoices, month);
  var pdf = createMergedInvoicePdf(invoices, month);
  var folder = DriveApp.getFolderById(config.invoices_folder_id);
  var saved = draftMonthlyPack(summary, month, {
    folderUrl: folder.getUrl(),
    sheetUrl: openCollectorSpreadsheet_().getUrl(),
    pdfUrl: pdf.url || ''
  });
  return {
    month: month,
    documents: summary.documents,
    included: summary.included.length,
    pages: pdf.pages,
    pdfUrl: pdf.url || '',
    draftId: saved.id,
    draftTo: saved.to,
    draftAction: saved.action
  };
}

function buildOwnerErrorMail(error, month) {
  var message = error && error.message ? String(error.message) : String(error || 'unknown error');
  return {
    subject: 'Invoice Collector failed' + (month ? ' ' + month : ''),
    body: 'The monthly run failed.\n\n' + message.slice(0, 500) + '\n'
  };
}

function ownerErrorRecipient(ownerEmail) {
  var owner = String(ownerEmail || '').trim();
  if (owner.indexOf('@') < 1) return '';
  return owner;
}

/** Sends the failure note to owner_email. No copy, no attachment. */
function sendOwnerError_(error, month, ownerEmail) {
  var to = ownerErrorRecipient(ownerEmail);
  if (!to) return { sent: false, to: '' };
  var mail = buildOwnerErrorMail(error, month);
  GmailApp.sendEmail(to, mail.subject, mail.body);
  return { sent: true, to: to };
}

function installMonthlyTrigger() {
  removeMonthlyTrigger();
  var spec = monthlyTriggerSpec();
  ScriptApp.newTrigger(spec.handler).timeBased().onMonthDay(spec.day).atHour(spec.hour).create();
  return spec;
}

function removeMonthlyTrigger() {
  var handler = monthlyTriggerSpec().handler;
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() !== handler) continue;
    ScriptApp.deleteTrigger(triggers[i]);
    removed++;
  }
  return removed;
}

function listMonthlyTriggers() {
  var handler = monthlyTriggerSpec().handler;
  var found = [];
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === handler) found.push(triggers[i].getUniqueId());
  }
  return found;
}

if (typeof module !== 'undefined') {
  module.exports = {
    monthlyTriggerSpec: monthlyTriggerSpec,
    buildOwnerErrorMail: buildOwnerErrorMail,
    ownerErrorRecipient: ownerErrorRecipient
  };
}
