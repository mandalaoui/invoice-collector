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

function emailFromHeader(from) {
  var text = String(from || '').trim();
  var match = text.match(/<([^<>]+)>/);
  return (match ? match[1] : text).trim();
}

function displayNameFromHeader(from) {
  var text = String(from || '').trim();
  var angle = text.lastIndexOf('<');
  var name = angle > 0 ? text.slice(0, angle) : '';
  name = name.replace(/^"+|"+$/g, '').trim();
  if (name) return name;
  var email = emailFromHeader(text);
  var at = email.indexOf('@');
  if (at > 0) return email.slice(0, at);
  return 'sender';
}

function bodyHasInvoiceText(text) {
  var folded = String(text || '')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/[״”“]/g, '"')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  var cues = ['חשבונית', 'קבלה', 'invoice', 'receipt', 'סה"כ לתשלום', 'total due', 'amount due'];
  for (var i = 0; i < cues.length; i++) {
    if (folded.indexOf(cues[i]) >= 0) return true;
  }
  return false;
}

function isBodyPdfSource_(source) {
  return source === 'body-pdf' || source === 'email_body';
}

function textUrlPath_(url) {
  var text = String(url || '').trim();
  var hash = text.indexOf('#');
  if (hash >= 0) text = text.slice(0, hash);
  var query = text.indexOf('?');
  if (query >= 0) text = text.slice(0, query);
  return text;
}

function isPdfUrl_(url) {
  return /\.pdf$/i.test(textUrlPath_(url));
}

function decodeUrlPart_(text) {
  try {
    return decodeURIComponent(String(text || ''));
  } catch (ignore) {
    return String(text || '');
  }
}

function extractHttpUrls_(text) {
  var found = [];
  var re = /https?:\/\/[^\s<>"'()]+/gi;
  var source = String(text || '');
  var match;
  while ((match = re.exec(source))) found.push(match[0].replace(/[.,;]+$/, ''));
  return found;
}

function isInvoiceLink_(url) {
  if (isPdfUrl_(url)) return true;
  var path = decodeUrlPart_(textUrlPath_(url)).toLowerCase();
  if (/invoice|receipt|billing|statement|subscription|payment|download/.test(path)) return true;
  return /חשבונית|קבלה|הזמנה|תשלום/.test(path);
}

function findInvoiceLinks(text) {
  var urls = extractHttpUrls_(text);
  var out = [];
  var seen = {};
  for (var i = 0; i < urls.length; i++) {
    if (!isInvoiceLink_(urls[i]) || seen[urls[i]]) continue;
    seen[urls[i]] = true;
    out.push(urls[i]);
  }
  return out;
}

function linkFileName_(url, index) {
  var path = decodeUrlPart_(textUrlPath_(url));
  var slash = path.lastIndexOf('/');
  var base = slash >= 0 ? path.slice(slash + 1) : '';
  if (!/\.pdf$/i.test(base)) base = 'link-' + (Number(index) + 1) + '.pdf';
  return base || 'link.pdf';
}

function linkNeedsLogin_(response) {
  if (!response) return true;
  var status = Number(response.status);
  if (status === 401 || status === 403) return true;
  var finalUrl = String(response.finalUrl || '');
  if (/login|signin|sign-in|oauth|accounts\.google/i.test(finalUrl)) return true;
  var type = String(response.contentType || '').toLowerCase();
  var body = String(response.bodyText || '');
  if (type.indexOf('html') >= 0 && /login|sign in|log in|password|התחבר|כניסה|סיסמה/i.test(body)) return true;
  return false;
}

/**
 * A direct PDF is saved. Login or any other response is a review note.
 * @return {{action: string, url: string, note?: string, bytes?: number[], fileName?: string}}
 */
function interpretLinkFetch(url, response, index) {
  var note = 'invoice behind link: ' + url;
  if (linkNeedsLogin_(response)) return { action: 'review', note: note, url: url };
  var type = String(response.contentType || '').toLowerCase();
  var pdfType = type.indexOf('application/pdf') >= 0;
  var pdfUrl = isPdfUrl_(url) || isPdfUrl_(response.finalUrl || '');
  var bytes = response.bytes || [];
  var status = response.status == null || response.status === '' ? 200 : Number(response.status);
  var ok = status >= 200 && status < 300;
  if (ok && isPdfBytes(bytes) && (pdfType || pdfUrl)) {
    return { action: 'save', url: url, bytes: bytes, fileName: linkFileName_(url, index || 0) };
  }
  return { action: 'review', note: note, url: url };
}

function linkSourceKey(plan) {
  var source = plan || {};
  return String(source.messageId || '') + '#' + String(source.linkIndex) + '#link';
}

function fetchInvoiceLink_(url) {
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  var headers = response.getHeaders() || {};
  var contentType = headers['Content-Type'] || headers['content-type'] || '';
  var bodyText = '';
  if (String(contentType).toLowerCase().indexOf('text/') === 0) {
    try {
      bodyText = String(response.getContentText() || '').slice(0, 4000);
    } catch (ignore) {
      bodyText = '';
    }
  }
  return {
    status: response.getResponseCode(),
    contentType: contentType,
    finalUrl: headers.Location || headers.location || '',
    bytes: response.getContent(),
    bodyText: bodyText
  };
}

function responsesForMessage_(message) {
  var links = findInvoiceLinks(message && (message.body || message.bodyText) || '');
  var out = {};
  for (var i = 0; i < links.length; i++) {
    try {
      out[links[i]] = fetchInvoiceLink_(links[i]);
    } catch (error) {
      out[links[i]] = {
        status: 0,
        contentType: '',
        finalUrl: '',
        bytes: [],
        bodyText: error && error.message ? String(error.message) : ''
      };
    }
  }
  return out;
}

function isCollectableAttachment_(name, mime) {
  var type = String(mime || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  if (type === 'image/jpg') type = 'image/jpeg';
  if (type === 'application/pdf' || type === 'image/jpeg' || type === 'image/png') return true;
  var lower = String(name || '').toLowerCase();
  return lower.endsWith('.pdf') || /\.(jpe?g|png)$/.test(lower);
}

/**
 * One file per PDF or image on the message. Any subject is kept.
 * A message with no invoice file is saved as a PDF of the body only when
 * the body itself contains invoice text. source is email_body.
 * @param {Array<Object>} messages
 * @return {Array<Object>}
 */
function planClientSaves(messages) {
  var plans = [];
  var seen = {};
  var rows = messages || [];
  for (var i = 0; i < rows.length; i++) {
    var message = rows[i];
    if (!message || !message.id || seen[message.id]) continue;
    seen[message.id] = true;
    var vendor = displayNameFromHeader(message.from);
    var date = message.dateYmd || message.date || '';
    var attachments = message.attachments || [];
    var added = 0;
    for (var a = 0; a < attachments.length; a++) {
      var file = attachments[a] || {};
      if (!isCollectableAttachment_(file.name, file.mime)) continue;
      plans.push({
        messageId: message.id,
        threadId: message.threadId || '',
        subject: message.subject || '',
        from: message.from || '',
        date: date,
        vendor: vendor,
        source: 'attachment',
        originalName: file.name,
        attachmentName: file.name,
        attachmentIndex: file.index,
        order: plans.length
      });
      added++;
    }
    if (added || !bodyHasInvoiceText(message.body || message.bodyText || '')) continue;
    plans.push({
      messageId: message.id,
      threadId: message.threadId || '',
      subject: message.subject || '',
      from: message.from || '',
      date: date,
      vendor: vendor,
      source: 'email_body',
      originalName: 'email.pdf',
      attachmentName: '',
      attachmentIndex: -1,
      order: plans.length
    });
  }
  return plans;
}

/**
 * File plans plus review rows and notice rows.
 * A saved PDF link replaces an email-body PDF for that message.
 * classifyNotice(text) returns {status, notes} or null.
 * @return {{plans: Array<Object>}}
 */
function buildCollectWork(messages, responsesByMessageId, classifyNotice) {
  var plans = planClientSaves(messages);
  var responses = responsesByMessageId || {};
  var classify = classifyNotice || function () { return null; };
  var extra = [];
  var rows = [];
  var dropBody = {};
  var list = messages || [];
  var i;
  for (i = 0; i < list.length; i++) {
    var message = list[i];
    if (!message || !message.id) continue;
    var map = responses[message.id] || {};
    var links = findInvoiceLinks(message.body || message.bodyText || '');
    var saved = false;
    var reviewed = false;
    var n;
    for (n = 0; n < links.length; n++) {
      var outcome = interpretLinkFetch(links[n], map[links[n]], n);
      if (outcome.action === 'save') {
        saved = true;
        extra.push({
          messageId: message.id,
          threadId: message.threadId || '',
          subject: message.subject || '',
          from: message.from || '',
          date: message.dateYmd || message.date || '',
          vendor: displayNameFromHeader(message.from),
          source: 'link',
          originalName: outcome.fileName,
          attachmentName: outcome.fileName,
          attachmentIndex: -1,
          linkIndex: n,
          bytes: outcome.bytes,
          order: extra.length
        });
      } else {
        reviewed = true;
        rows.push({
          rowOnly: true,
          messageId: message.id,
          threadId: message.threadId || '',
          source: 'link',
          linkIndex: n,
          sourceKey: message.id + '#' + n + '#link',
          fields: {
            vendor_name: displayNameFromHeader(message.from),
            doc_date: message.dateYmd || message.date || '',
            status: 'REVIEW',
            notes: outcome.note,
            source: message.id + '#' + n + '#link',
            confidence: 0
          }
        });
      }
    }
    if (saved) dropBody[message.id] = true;
    var hasFile = saved;
    for (n = 0; n < plans.length; n++) {
      if (plans[n].messageId === message.id && plans[n].source !== 'email_body' && plans[n].source !== 'body-pdf') {
        hasFile = true;
      }
    }
    if (!hasFile && !reviewed) {
      var sample = String(message.subject || '') + '\n' + String(message.body || message.bodyText || '');
      var notice = classify(sample);
      if (notice) {
        rows.push({
          rowOnly: true,
          messageId: message.id,
          threadId: message.threadId || '',
          source: 'notice',
          sourceKey: message.id + '#notice',
          fields: {
            vendor_name: displayNameFromHeader(message.from),
            doc_date: message.dateYmd || message.date || '',
            status: notice.status,
            notes: notice.notes,
            source: message.id + '#notice',
            confidence: 0
          }
        });
      }
    }
  }
  var kept = [];
  for (i = 0; i < plans.length; i++) {
    if (dropBody[plans[i].messageId] && isBodyPdfSource_(plans[i].source)) continue;
    kept.push(plans[i]);
  }
  return { plans: kept.concat(extra).concat(rows) };
}

/**
 * Caps a client run. messageLimit counts messages. documentLimit counts files.
 * A message already started is kept until the document cap cuts it.
 * @param {Array<Object>} plans
 * @param {{messageLimit?: number, documentLimit?: number}} options
 * @return {Array<Object>}
 */
function limitCollectPlans(plans, options) {
  var source = options || {};
  var messageCap = Number(source.messageLimit);
  var docCap = Number(source.documentLimit);
  var useMessages = messageCap > 0;
  var useDocs = docCap > 0;
  var rows = plans || [];
  var kept = [];
  var seen = {};
  var messages = 0;
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i].messageId || '');
    if (!seen[id]) {
      if (useMessages && messages >= messageCap) break;
      seen[id] = true;
      messages++;
    }
    if (useDocs && kept.length >= docCap) break;
    kept.push(rows[i]);
  }
  return kept;
}

/** Threads whose every planned file was included in this run. */
function clientThreadsToLabel(allPlans, finishedPlans) {
  var wanted = {};
  var done = {};
  var threadOf = {};
  var i;
  var rows = allPlans || [];
  for (i = 0; i < rows.length; i++) {
    var id = String(rows[i].messageId || '');
    if (!id) continue;
    wanted[id] = (wanted[id] || 0) + 1;
    threadOf[id] = rows[i].threadId || '';
  }
  var finished = finishedPlans || [];
  for (i = 0; i < finished.length; i++) {
    var fid = String(finished[i].messageId || '');
    done[fid] = (done[fid] || 0) + 1;
  }
  var out = [];
  var seen = {};
  var ids = Object.keys(wanted);
  for (i = 0; i < ids.length; i++) {
    var messageId = ids[i];
    if (done[messageId] !== wanted[messageId]) continue;
    var threadId = String(threadOf[messageId] || '');
    if (!threadId || seen[threadId]) continue;
    seen[threadId] = true;
    out.push(threadId);
  }
  return out;
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

/** Pack files are not fixture originals. */
function isPackMonthFile_(name) {
  var text = String(name || '');
  if (/_merged\.pdf$/i.test(text)) return true;
  if (/^__test_run_.*\.pdf$/i.test(text)) return true;
  return false;
}

/**
 * @param {string[]} names
 * @return {number}
 */
function countFixtureMonthFiles(names) {
  var count = 0;
  var list = names || [];
  for (var i = 0; i < list.length; i++) {
    if (!isPackMonthFile_(list[i])) count++;
  }
  return count;
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
    var bodyPdf = isBodyPdfSource_(plan.source);
    var sourceBytes = bodyPdf ? source.pdfBytes : source.bytes;
    if (!sourceBytes || !sourceBytes.length) throw new Error('No bytes for ' + plan.subject);
    if (bodyPdf && !isPdfBytes(sourceBytes)) {
      throw new Error('Email body PDF is invalid for ' + plan.subject);
    }
    var copiedBytes = plan.source === 'attachment' || plan.source === 'link';
    var decision = decideFileWrite(filesNamed_(folder, fileName), fileName, {
      bytes: copiedBytes ? sourceBytes : null,
      mustBePdf: bodyPdf || plan.source === 'link'
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
        byteIdentical: copiedBytes,
        created: false
      });
      continue;
    }
    var mime = bodyPdf ? MimeType.PDF : copyMime(source.mime, plan.attachmentName);
    var blob = Utilities.newBlob(sourceBytes, mime, fileName);
    var created = folder.createFile(blob);
    var stored = created.getBlob().getBytes();
    if (copiedBytes && !bytesEqual(stored, sourceBytes)) {
      throw new Error(fileName + ' changed when it was saved to Drive. The Gmail attachment was not modified.');
    }
    if (bodyPdf && !isPdfBytes(stored)) {
      throw new Error(fileName + ' saved to Drive is not a PDF');
    }
    saved.push({
      name: fileName,
      id: created.getId(),
      bytes: stored.length,
      source: plan.source,
      byteIdentical: copiedBytes,
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
    planClientSaves: planClientSaves,
    findInvoiceLinks: findInvoiceLinks,
    interpretLinkFetch: interpretLinkFetch,
    linkSourceKey: linkSourceKey,
    buildCollectWork: buildCollectWork,
    bodyHasInvoiceText: bodyHasInvoiceText,
    isBodyPdfSource_: isBodyPdfSource_,
    limitCollectPlans: limitCollectPlans,
    clientThreadsToLabel: clientThreadsToLabel,
    displayNameFromHeader: displayNameFromHeader,
    emailFromHeader: emailFromHeader,
    bytesEqual: bytesEqual,
    isPdfBytes: isPdfBytes,
    mimeForFileName: mimeForFileName,
    copyMime: copyMime,
    countFixtureMonthFiles: countFixtureMonthFiles,
    chooseSaveFolder: chooseSaveFolder,
    decideFileWrite: decideFileWrite,
    ensureMonthFolder: ensureMonthFolder,
    rememberInvoicesFolderId: rememberInvoicesFolderId,
    htmlBodyToPdfBlob: htmlBodyToPdfBlob,
    savePlannedCopies: savePlannedCopies
  };
}
