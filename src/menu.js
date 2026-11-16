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
    { label: 'Turn monthly trigger off', fn: 'turnMonthlyTriggerOff' },
    { label: 'Export OCR text', fn: 'exportOcrText' },
    { label: 'Reset month (re-run)', fn: 'resetMonth' }
  ];
}

function exportOcrFolderName(month) {
  return 'ocr-text-' + String(month || '');
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
    cursor: '',
    coverage: ''
  };
  try {
    writeInstallEmail_('accountant_email', me);
    var config = getConfig();
    var month = resolveCollectMonth(config.month, todayYmd_());
    logRow = beginRunLog_(entry);
    var collected = collectClientMonth(config, { documentLimit: testRunBatchSize() });
    entry.messages = collected.messages || 0;
    entry.coverage = collected.coverage || '';
    var limited = limitRows_(rowsForMonth(readInvoiceRows(), collected.month || month), testRunBatchSize());
    if (!limited.length) throw noInvoicesError_(collected.month || month, collected);
    var summary = summarizeMonth(limited);
    var pdf = createMergedInvoicePdf(limited, month, { name: testRunPdfName(month) });
    var folder = DriveApp.getFolderById(config.invoices_folder_id);
    var savedDraft = draftMonthlyPack(summary, month, {
      folderUrl: folder.getUrl(),
      sheetUrl: openCollectorSpreadsheet_().getUrl(),
      pdfUrl: pdf.url || ''
    }, {
      coverage: {
        scanned: collected.scanned || 0,
        documents: summary.documents
      },
      notices: noticeLines_(pdf.notices)
    });
    writeInvoiceNotes(pdf.notices);
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

/**
 * Writes the OCR text of the current month's documents into Drive/ocr-text-YYYY-MM.
 * Does not send mail. Download that folder to tests/real/ocr-text locally.
 * @return {{month: string, files: number, url: string}}
 */
function exportOcrText() {
  var config = getConfig();
  var month = resolveCollectMonth(config.month, todayYmd_());
  if (!config.invoices_folder_id) throw new Error('invoices_folder_id is empty');
  var monthFolder = DriveApp.getFolderById(config.invoices_folder_id);
  var parents = monthFolder.getParents();
  var parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var folder = childFolder_(parent, exportOcrFolderName(month));
  var rows = rowsForMonth(readInvoiceRows(), month);
  var written = 0;
  for (var i = 0; i < rows.length; i++) {
    var id = driveIdFromLink(rows[i].file_link);
    if (!id) continue;
    try {
      var file = DriveApp.getFileById(id);
      var read = readDriveFileText(file);
      var name = file.getName() + '.txt';
      var text = read && read.text ? String(read.text) : '';
      var existing = folder.getFilesByName(name);
      if (existing.hasNext()) existing.next().setContent(text);
      else folder.createFile(Utilities.newBlob(text, 'text/plain', name));
      written++;
    } catch (error) {
      Logger.log('exportOcrText skip %s %s', id, error && error.message ? error.message : error);
    }
  }
  Logger.log('exportOcrText %s files=%s %s', month, written, folder.getUrl());
  return { month: month, files: written, url: folder.getUrl() };
}

function resetMonthConfirmText(month, processedLabel, reviewLabel) {
  return (
    'Reset ' +
    month +
    '? This removes the ' +
    (processedLabel || 'invoices/processed') +
    ' and ' +
    (reviewLabel || 'invoices/review') +
    " labels and deletes this month's Invoices rows. Drive files and Gmail messages are not changed."
  );
}

function confirmResetMonth_(month, processedLabel, reviewLabel) {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert(
    'Reset month (re-run)',
    resetMonthConfirmText(month, processedLabel, reviewLabel),
    ui.ButtonSet.OK_CANCEL
  );
  return answer === ui.Button.OK;
}

function writeSearchQueriesDefault_() {
  var patch = { value: defaultSearchQueriesValue(), note: '' };
  var i;
  for (i = 0; i < SETTINGS_FIELDS.length; i++) {
    if (SETTINGS_FIELDS[i].key === 'search_queries') patch.note = SETTINGS_FIELDS[i].note;
  }
  var sheet = openCollectorSpreadsheet_().getSheetByName('Settings');
  if (!sheet) throw new Error('Settings tab is missing. Run setupCollectorSheet().');
  var values = sheet.getDataRange().getValues();
  for (i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() !== 'search_queries') continue;
    sheet.getRange(i + 1, 2).setValue(patch.value);
    sheet.getRange(i + 1, 3).setValue(patch.note);
    return patch.value;
  }
  throw new Error('Settings is missing search_queries.');
}

function clearMonthLabels_(config, month) {
  var source = config || {};
  var plan = buildResetLabelQueries({
    month: month,
    today: source.today || todayYmd_(),
    processed_label: source.processed_label,
    review_label: source.review_label
  });
  var seen = {};
  var threads = [];
  var q;
  for (q = 0; q < plan.queries.length; q++) {
    var found = searchClientThreads_(plan.queries[q]);
    var t;
    for (t = 0; t < found.length; t++) {
      var id = found[t].getId();
      if (seen[id]) continue;
      seen[id] = true;
      threads.push(found[t]);
    }
  }
  var names = [
    source.processed_label || 'invoices/processed',
    source.review_label || 'invoices/review'
  ];
  var removed = 0;
  var i;
  for (i = 0; i < threads.length; i++) {
    var labels = threads[i].getLabels();
    var n;
    for (n = 0; n < names.length; n++) {
      var label = null;
      var L;
      for (L = 0; L < labels.length; L++) {
        if (labels[L].getName() === names[n]) label = labels[L];
      }
      if (!label) continue;
      threads[i].removeLabel(label);
      removed++;
    }
  }
  return removed;
}

function deleteMonthInvoiceRows_(month) {
  return deleteInvoiceSources_(sourcesForMonthReset(readInvoiceRows(), month));
}

/**
 * Confirms, then clears this month's collector labels and Invoices rows
 * and restores the default search queries. Does not change Drive files
 * or Gmail message content.
 */
function resetMonth() {
  var config = getConfig();
  var month = resolveCollectMonth(config.month, todayYmd_());
  if (!confirmResetMonth_(month, config.processed_label, config.review_label)) {
    return { cancelled: true, month: month };
  }
  var unlabeled = clearMonthLabels_(config, month);
  var rows = deleteMonthInvoiceRows_(month);
  writeSearchQueriesDefault_();
  Logger.log('resetMonth %s labels=%s rows=%s', month, unlabeled, rows);
  return { cancelled: false, month: month, unlabeled: unlabeled, rows: rows };
}

if (typeof module !== 'undefined') {
  module.exports = {
    collectorMenuItems: collectorMenuItems,
    testRunBatchSize: testRunBatchSize,
    limitRows_: limitRows_,
    testRunPdfName: testRunPdfName,
    exportOcrFolderName: exportOcrFolderName,
    resetMonthConfirmText: resetMonthConfirmText
  };
}
