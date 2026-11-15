/**
 * Sheet menu. Test run drafts to the current user and does not send mail.
 */

var TEST_RUN_BATCH = 3;

function collectorMenuItems() {
  return [
    { label: 'Install', fn: 'install' },
    { label: 'Run this month', fn: 'runThisMonth' },
    { label: 'Test run (draft to me)', fn: 'testRun' },
    { label: 'Turn monthly trigger on', fn: 'turnMonthlyTriggerOn' },
    { label: 'Turn monthly trigger off', fn: 'turnMonthlyTriggerOff' }
  ];
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  var menu = ui.createMenu('Invoice Collector');
  var items = collectorMenuItems();
  for (var i = 0; i < items.length; i++) menu.addItem(items[i].label, items[i].fn);
  menu.addToUi();
}

function runThisMonth() {
  return runMonthlyJob();
}

function turnMonthlyTriggerOn() {
  return installMonthlyTrigger();
}

function turnMonthlyTriggerOff() {
  return removeMonthlyTrigger();
}

function testRunBatchSize() {
  return TEST_RUN_BATCH;
}

function limitRows_(rows, limit) {
  var list = rows || [];
  var cap = Number(limit);
  if (!(cap > 0)) return list.slice();
  return list.slice(0, cap);
}

function testRunPdfName(month) {
  var name = '__test_run_' + String(month || '') + '.pdf';
  if (name === String(month || '') + '_merged.pdf') throw new Error('test pdf replaces the monthly file');
  return name;
}

function activeUserEmail_() {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail();
  } catch (error) {
    email = '';
  }
  return String(email || '').trim();
}

/**
 * Publishes at most 3 documents for the Settings month.
 * The draft goes to the current user. The monthly PDF is left as it is.
 * This function does not send mail.
 * @return {Object}
 */
function testRun() {
  var me = activeUserEmail_();
  if (!isInstallEmail_(me)) throw new Error('no user email for the draft');
  var saved = String(getConfig().accountant_email || '');
  var started = new Date();
  var logRow = 0;
  var entry = {
    startedAt: started,
    finishedAt: '',
    mode: 'test',
    messages: 0,
    files: 0,
    rows: 0,
    errors: '',
    status: 'running',
    cursor: ''
  };
  try {
    writeInstallEmail_('accountant_email', me);
    var config = getConfig();
    var month = resolveCollectMonth(config.month, todayYmd_());
    logRow = beginRunLog_(entry);
    var limited = limitRows_(rowsForMonth(readInvoiceRows(), month), testRunBatchSize());
    if (!limited.length) throw new Error('no invoices for ' + month);
    var summary = summarizeMonth(limited);
    var pdf = createMergedInvoicePdf(limited, month, { name: testRunPdfName(month) });
    var folder = DriveApp.getFolderById(config.invoices_folder_id);
    var savedDraft = draftMonthlyPack(summary, month, {
      folderUrl: folder.getUrl(),
      sheetUrl: openCollectorSpreadsheet_().getUrl(),
      pdfUrl: pdf.url || ''
    });
    if (String(savedDraft.to || '').toLowerCase().indexOf(me.toLowerCase()) < 0) {
      throw new Error('draft went to ' + savedDraft.to);
    }
    entry.finishedAt = new Date();
    entry.files = pdf.pages || 0;
    entry.rows = summary.documents;
    entry.status = 'ok';
    updateRunLog_(logRow, entry);
    return {
      month: month,
      documents: summary.documents,
      included: summary.included.length,
      pages: pdf.pages || 0,
      pdfName: pdf.name,
      pdfUrl: pdf.url || '',
      draftId: savedDraft.id,
      draftTo: savedDraft.to,
      draftAction: savedDraft.action
    };
  } catch (error) {
    var message = error && error.message ? String(error.message) : String(error);
    entry.finishedAt = new Date();
    entry.errors = message.slice(0, 500);
    entry.status = 'error';
    if (logRow) {
      try {
        updateRunLog_(logRow, entry);
      } catch (ignore) {}
    }
    throw error;
  } finally {
    try {
      writeInstallEmail_('accountant_email', saved);
    } catch (ignore) {}
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    collectorMenuItems: collectorMenuItems,
    testRunBatchSize: testRunBatchSize,
    limitRows_: limitRows_,
    testRunPdfName: testRunPdfName
  };
}
