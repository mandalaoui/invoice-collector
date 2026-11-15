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
