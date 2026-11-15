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
    var result = publishMonth_(config, month);
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

function publishMonth_(config, month) {
  var invoices = rowsForMonth(readInvoiceRows(), month);
  if (!invoices.length) throw new Error('no invoices for ' + month);
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
