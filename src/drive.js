/**
 * Save original invoice files into Invoices/YYYY-MM.
 * Attachments are copied byte for byte. An invoice that exists only in the
 * email body is rendered to a new PDF. Originals are never overwritten.
 */

function sanitizeFilePart(value) {
  var text = String(value == null ? '' : value).trim();
  text = text.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  text = text.replace(/\s+/g, '_');
  text = text.replace(/_+/g, '_');
  text = text.replace(/^_+|_+$/g, '');
  if (!text || text === '.' || text === '..') throw new Error('File name part is empty');
  return text;
}

/**
 * @param {string} dateYmd YYYY-MM-DD
 * @param {string} vendor
 * @param {string} originalName
 * @return {string} YYYY-MM-DD_vendor_originalname
 */
function buildInvoiceFileName(dateYmd, vendor, originalName) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd || '')) {
    throw new Error('file date must be YYYY-MM-DD');
  }
  return (
    dateYmd +
    '_' +
    sanitizeFilePart(vendor) +
    '_' +
    sanitizeFilePart(originalName)
  );
}

function withPdfExtension_(fileName) {
  var name = String(fileName || '');
  return name.replace(/\.[^.]+$/, '') + '.pdf';
}

/**
 * Plans a copy for each listed fixture message. Any other subject is ignored.
 * @param {Array<Object>} messages id, subject, date
 * @param {Array<Object>} fixtures the eight TEST_FIXTURE_MESSAGES
 * @return {Array<Object>}
 */
function planFixtureSaves(messages, fixtures) {
  if (!fixtures || fixtures.length !== 8) throw new Error('Need the 8 fixture messages');
  var bySubject = {};
  var order = {};
  var i;
  for (i = 0; i < fixtures.length; i++) {
    bySubject[fixtures[i].subject] = fixtures[i];
    order[fixtures[i].subject] = i;
  }
  var seen = {};
  var plans = [];
  var rows = messages || [];
  for (i = 0; i < rows.length; i++) {
    var message = rows[i];
    if (!message || !message.id || seen[message.id]) continue;
    var fixture = bySubject[message.subject];
    if (!fixture) continue;
    seen[message.id] = true;
    var body = fixture.kind === 'html';
    plans.push({
      messageId: message.id,
      subject: message.subject,
      date: message.date,
      vendor: fixture.fromName,
      kind: fixture.kind,
      threadId: message.threadId || '',
      source: body ? 'body-pdf' : 'attachment',
      originalName: body ? withPdfExtension_(fixture.file) : fixture.file,
      attachmentName: body ? '' : fixture.file,
      order: order[message.subject]
    });
  }
  plans.sort(function (a, b) {
    return a.order - b.order;
  });
  return plans;
}

function bytesEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (var i = 0; i < left.length; i++) {
    if ((left[i] & 255) !== (right[i] & 255)) return false;
  }
  return true;
}

function isPdfBytes(bytes) {
  if (!bytes || bytes.length < 5) return false;
  return (
    (bytes[0] & 255) === 0x25 &&
    (bytes[1] & 255) === 0x50 &&
    (bytes[2] & 255) === 0x44 &&
    (bytes[3] & 255) === 0x46
  );
}

function mimeForFileName(name) {
  var lower = String(name || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  return 'application/octet-stream';
}

function copyMime(originalMime, fileName) {
  var mime = String(originalMime || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  if (
    mime === 'application/pdf' ||
    mime === 'image/jpeg' ||
    mime === 'image/png' ||
    mime === 'text/html'
  ) {
    return mime;
  }
  return mimeForFileName(fileName);
}

/**
 * @param {{id?: string, name?: string}|null} existing
 * @param {string} month YYYY-MM
 * @return {{action: string, id?: string, name?: string, parentName?: string, monthName?: string}}
 */
function chooseSaveFolder(existing, month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new Error('month must be YYYY-MM');
  if (!existing || !existing.id) {
    return { action: 'create', parentName: 'Invoices', monthName: month };
  }
  if (existing.name !== month) {
    return { action: 'reject', name: existing.name || '' };
  }
  return { action: 'use', id: existing.id };
}

/**
 * @param {Array<{name: string, bytes: number[], id?: string}>} existingFiles
 * @param {string} fileName
 * @param {{bytes?: number[], mustBePdf?: boolean}} source
 * @return {{action: string, id?: string}}
 */
function decideFileWrite(existingFiles, fileName, source) {
  var rows = existingFiles || [];
  var sourceBytes = source && source.bytes;
  var i;
  for (i = 0; i < rows.length; i++) {
    if (rows[i].name !== fileName) continue;
    if (sourceBytes) {
      if (bytesEqual(rows[i].bytes, sourceBytes)) return { action: 'keep', id: rows[i].id };
      return { action: 'conflict' };
    }
    if (source && source.mustBePdf && !isPdfBytes(rows[i].bytes)) return { action: 'conflict' };
    return { action: 'keep', id: rows[i].id };
  }
  return { action: 'create' };
}

function childFolder_(parent, name) {
  var found = parent.getFoldersByName(name);
  if (found.hasNext()) return found.next();
  return parent.createFolder(name);
}

/**
 * Uses invoices_folder_id when it already is the YYYY-MM folder.
 * Otherwise creates My Drive/Invoices/YYYY-MM.
 * @param {string} existingId
 * @param {string} month
 * @return {GoogleAppsScript.Drive.Folder}
 */
function ensureMonthFolder(existingId, month) {
  var choice = chooseSaveFolder(
    existingId ? { id: existingId, name: DriveApp.getFolderById(existingId).getName() } : null,
    month
  );
  if (choice.action === 'reject') {
    throw new Error(
      'Settings invoices_folder_id points at "' +
        choice.name +
        '". Clear that cell, or set it to the Invoices/' +
        month +
        ' folder.'
    );
  }
  if (choice.action === 'use') return DriveApp.getFolderById(choice.id);
  var invoices = childFolder_(DriveApp.getRootFolder(), choice.parentName);
  return childFolder_(invoices, choice.monthName);
}

function rememberInvoicesFolderId(folderId) {
  var sheet = openCollectorSpreadsheet_().getSheetByName('Settings');
  if (!sheet) throw new Error('Settings tab is missing. Run setupCollectorSheet().');
  var values = sheet.getDataRange().getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === 'invoices_folder_id') {
      if (String(values[i][1] || '') !== folderId) {
        sheet.getRange(i + 1, 2).setValue(folderId);
      }
      return folderId;
    }
  }
  throw new Error('Settings is missing invoices_folder_id. Run setupCollectorSheet().');
}

function filesNamed_(folder, name) {
  var found = [];
  var iter = folder.getFilesByName(name);
  while (iter.hasNext()) {
    var file = iter.next();
    found.push({
      id: file.getId(),
      name: name,
      bytes: file.getBlob().getBytes()
    });
  }
  return found;
}

/**
 * Renders an email body to a new PDF. This does not write the PDF to Drive.
 * @param {string} html
 * @param {string} fileName
 * @return {GoogleAppsScript.Base.Blob}
 */
function htmlBodyToPdfBlob(html, fileName) {
  if (!String(html || '').trim()) throw new Error('Email body is empty');
  var output = HtmlService.createHtmlOutput(String(html));
  var pdf = typeof output.getAs === 'function' ? output.getAs(MimeType.PDF) : output.getBlob().getAs(MimeType.PDF);
  var bytes = pdf.getBytes();
  if (!isPdfBytes(bytes)) throw new Error('Email body did not convert to a PDF');
  return Utilities.newBlob(bytes, MimeType.PDF, fileName);
}

/**
 * Copies planned files into the month folder. Attachment bytes must match
 * after the upload. A differing file with the same name is left as it is.
 * @param {Array<Object>} plans
 * @param {GoogleAppsScript.Drive.Folder} folder
 * @param {function(Object): {bytes?: number[], mime?: string, pdfBytes?: number[]}} readSource
 * @return {Array<Object>}
 */
function savePlannedCopies(plans, folder, readSource) {
  var saved = [];
  var rows = plans || [];
  for (var i = 0; i < rows.length; i++) {
    var plan = rows[i];
    var fileName = buildInvoiceFileName(plan.date, plan.vendor, plan.originalName);
    var source = readSource(plan);
    var sourceBytes = plan.source === 'body-pdf' ? source.pdfBytes : source.bytes;
    if (!sourceBytes || !sourceBytes.length) throw new Error('No bytes for ' + plan.subject);
    if (plan.source === 'body-pdf' && !isPdfBytes(sourceBytes)) {
      throw new Error('Email body PDF is invalid for ' + plan.subject);
    }
    var decision = decideFileWrite(filesNamed_(folder, fileName), fileName, {
      bytes: plan.source === 'attachment' ? sourceBytes : null,
      mustBePdf: plan.source === 'body-pdf'
    });
    if (decision.action === 'conflict') {
      throw new Error(
        fileName + ' already exists and is not the same file. It was left unchanged.'
      );
    }
    if (decision.action === 'keep') {
      saved.push({
        name: fileName,
        id: decision.id,
        bytes: sourceBytes.length,
        source: plan.source,
        byteIdentical: plan.source === 'attachment',
        created: false
      });
      continue;
    }
    var mime = plan.source === 'body-pdf' ? MimeType.PDF : copyMime(source.mime, plan.attachmentName);
    var blob = Utilities.newBlob(sourceBytes, mime, fileName);
    var created = folder.createFile(blob);
    var stored = created.getBlob().getBytes();
    if (plan.source === 'attachment' && !bytesEqual(stored, sourceBytes)) {
      throw new Error(fileName + ' changed when it was saved to Drive. The Gmail attachment was not modified.');
    }
    if (plan.source === 'body-pdf' && !isPdfBytes(stored)) {
      throw new Error(fileName + ' saved to Drive is not a PDF');
    }
    saved.push({
      name: fileName,
      id: created.getId(),
      bytes: stored.length,
      source: plan.source,
      byteIdentical: plan.source === 'attachment',
      created: true
    });
  }
  return saved;
}

if (typeof module !== 'undefined') {
  module.exports = {
    sanitizeFilePart: sanitizeFilePart,
    buildInvoiceFileName: buildInvoiceFileName,
    planFixtureSaves: planFixtureSaves,
    bytesEqual: bytesEqual,
    isPdfBytes: isPdfBytes,
    mimeForFileName: mimeForFileName,
    copyMime: copyMime,
    chooseSaveFolder: chooseSaveFolder,
    decideFileWrite: decideFileWrite,
    ensureMonthFolder: ensureMonthFolder,
    rememberInvoicesFolderId: rememberInvoicesFolderId,
    htmlBodyToPdfBlob: htmlBodyToPdfBlob,
    savePlannedCopies: savePlannedCopies
  };
}
