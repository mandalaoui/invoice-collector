/**
 * Dev only. One run for the monthly pack.
 * Summary, merged PDF from copies, draft to the current user, then the
 * day-2 08:00 trigger installed and removed. Does not run OCR.
 * Restores accountant_email, owner_email, and month.
 */

function activeTestEmail_() {
  var active = Session.getActiveUser().getEmail();
  if (active) return String(active).trim();
  return String(Session.getEffectiveUser().getEmail() || '').trim();
}

function folderSnapshot_(folder) {
  var rows = [];
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    rows.push({
      id: file.getId(),
      name: file.getName(),
      size: file.getSize(),
      updated: file.getLastUpdated().getTime()
    });
  }
  return rows;
}

function snapshotById_(rows) {
  var map = {};
  for (var i = 0; i < rows.length; i++) map[rows[i].id] = rows[i];
  return map;
}

function phase4OriginalsHeld_(before, after) {
  var now = snapshotById_(after);
  var merged = mergedPdfName(FIXTURE_EXPECTED.month);
  for (var i = 0; i < before.length; i++) {
    var row = before[i];
    if (row.name === merged || row.name.indexOf('__merge_copy_') === 0) continue;
    var found = now[row.id];
    if (!found) return row.name + ' is missing';
    if (found.size !== row.size || found.updated !== row.updated) return row.name + ' changed';
  }
  var copies = 0;
  var mergedCount = 0;
  for (i = 0; i < after.length; i++) {
    if (after[i].name.indexOf('__merge_copy_') === 0) copies++;
    if (after[i].name === merged) mergedCount++;
  }
  if (copies) return 'merge copies left behind';
  if (mergedCount !== 1) return 'merged pdf count is ' + mergedCount;
  return '';
}

function phase4Exclusions_(invoices) {
  var selected = selectMergeFiles(invoices);
  var ids = {};
  var i;
  for (i = 0; i < selected.length; i++) ids[selected[i].id] = true;
  var quote = null;
  for (i = 0; i < invoices.length; i++) {
    var row = invoices[i];
    var id = driveIdFromLink(row.file_link);
    var status = String(row.status || '');
    if ((status === 'NOT_INVOICE' || status === 'DUPLICATE') && id && ids[id]) {
      return status + ' file was included';
    }
    if (String(row.source || '').indexOf('08-quote-not-invoice-he') >= 0) quote = row;
  }
  if (!quote) return 'quote row is missing';
  if (String(quote.status || '') !== 'NOT_INVOICE') return 'quote status is ' + quote.status;
  if (selected.length !== 7) return 'merge list has ' + selected.length;
  return '';
}

function sentCount_(subject) {
  return GmailApp.search('in:sent subject:"' + subject + '"', 0, 10).length;
}

/**
 * PASS when the pack, the self-addressed draft, and the trigger check all hold.
 * A second publish updates the same draft. Original files stay as they were.
 */
function testPhase4() {
  var saved = {
    accountant_email: readSettingValue_('accountant_email'),
    owner_email: readSettingValue_('owner_email'),
    month: readSettingValue_('month')
  };
  var month = FIXTURE_EXPECTED.month;
  var detail = '';
  var pass = false;
  var hadTrigger = 0;
  var installedDuringTest = false;
  var leaveTrigger = false;
  try {
    var me = activeTestEmail_();
    if (!me) throw new Error('no user email for the draft');
    Logger.log('testPhase4 step 1: draft and error mail stay on %s', me);
    writeSettingValue_('accountant_email', me);
    writeSettingValue_('owner_email', me);
    writeSettingValue_('month', month);
    if (ownerErrorRecipient('') !== '') throw new Error('blank owner was accepted');
    if (ownerErrorRecipient(me) !== me) throw new Error('owner recipient changed');
    var spec = monthlyTriggerSpec();
    if (spec.day !== 2 || spec.hour !== 8 || spec.handler !== 'runMonthlyJob') {
      throw new Error('trigger spec is ' + spec.day + ' ' + spec.hour);
    }

    var folder = DriveApp.getFolderById(getConfig().invoices_folder_id);
    Logger.log('testPhase4 step 2: snapshot %s', folder.getName());
    var before = folderSnapshot_(folder);
    var sentPack = sentCount_('Invoices ' + month);
    var sentError = sentCount_('Invoice Collector failed ' + month);

    Logger.log('testPhase4 step 3: first publish');
    var first = runMonthlyJob();
    Logger.log('testPhase4 step 4: second publish');
    var second = runMonthlyJob();
    if (first.draftTo !== me || second.draftTo !== me) {
      throw new Error('draft went to ' + second.draftTo);
    }
    if (second.draftAction !== 'update') throw new Error('second draft action is ' + second.draftAction);
    if (sentCount_('Invoices ' + month) !== sentPack) throw new Error('a pack mail was sent');
    if (sentCount_('Invoice Collector failed ' + month) !== sentError) throw new Error('an error mail was sent');

    var message = GmailApp.getDraft(second.draftId).getMessage();
    var to = String(message.getTo() || '').toLowerCase();
    if (to.indexOf(me.toLowerCase()) < 0) throw new Error('draft To is ' + message.getTo());
    var body = message.getPlainBody();
    var sheetUrl = openCollectorSpreadsheet_().getUrl();
    if (body.indexOf(folder.getUrl()) < 0) throw new Error('draft is missing the folder link');
    if (body.indexOf(sheetUrl) < 0) throw new Error('draft is missing the sheet link');
    if (!second.pdfUrl || body.indexOf(second.pdfUrl) < 0) throw new Error('draft is missing the pdf link');

    var invoices = rowsForMonth(readInvoiceRows(), month);
    var exclusion = phase4Exclusions_(invoices);
    if (exclusion) throw new Error(exclusion);
    if (second.pages !== 7) throw new Error('merged pages ' + second.pages);
    var after = folderSnapshot_(folder);
    var held = phase4OriginalsHeld_(before, after);
    if (held) throw new Error(held);
    var quoteLeft = false;
    for (var i = 0; i < after.length; i++) {
      if (after[i].name.indexOf('08-quote-not-invoice-he') >= 0) quoteLeft = true;
    }
    if (!quoteLeft) throw new Error('quote original is missing');

    Logger.log('testPhase4 step 5: install and remove the monthly trigger');
    hadTrigger = listMonthlyTriggers().length;
    installMonthlyTrigger();
    installedDuringTest = true;
    if (listMonthlyTriggers().length !== 1) throw new Error('trigger was not installed');
    removeMonthlyTrigger();
    installedDuringTest = false;
    if (listMonthlyTriggers().length !== 0) throw new Error('trigger was not removed');
    if (hadTrigger) {
      installMonthlyTrigger();
      installedDuringTest = true;
      leaveTrigger = true;
    }

    pass = true;
    detail = 'included=' + second.included + ' pages=' + second.pages + ' draft=' + second.draftAction + ' to=' + me;
  } catch (error) {
    pass = false;
    detail = String(error && error.message ? error.message : error);
  } finally {
    if (installedDuringTest && !leaveTrigger) {
      try {
        removeMonthlyTrigger();
      } catch (ignore) {}
    }
    if (saved.accountant_email) writeSettingValue_('accountant_email', saved.accountant_email.value);
    if (saved.owner_email) writeSettingValue_('owner_email', saved.owner_email.value);
    if (saved.month) writeSettingValue_('month', saved.month.value);
    Logger.log('testPhase4 restored accountant_email, owner_email, and month');
  }
  Logger.log('testPhase4 %s %s', pass ? 'PASS' : 'FAIL', detail);
  return { result: pass ? 'PASS' : 'FAIL', detail: detail };
}
