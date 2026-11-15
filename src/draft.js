/**
 * Gmail draft for the accountant.
 * This file creates and updates drafts. It does not send mail.
 */

function summaryLines_(summary, month) {
  var source = summary || {};
  var lines = ['month: ' + (month || '')];
  lines.push('documents: ' + (source.documents || 0));
  lines.push('included: ' + (source.included ? source.included.length : 0));
  var currencies = Object.keys(source.byCurrency || {}).sort();
  var i;
  for (i = 0; i < currencies.length; i++) {
    var bucket = source.byCurrency[currencies[i]];
    lines.push('total_' + currencies[i] + ': ' + bucket.total);
    lines.push('vat_' + currencies[i] + ': ' + bucket.vat);
  }
  var statuses = Object.keys(source.byStatus || {}).sort();
  for (i = 0; i < statuses.length; i++) {
    lines.push('status_' + statuses[i] + ': ' + source.byStatus[statuses[i]]);
  }
  return lines;
}

/**
 * @param {{to: string, month: string, folderUrl?: string, sheetUrl?: string, pdfUrl?: string, summary?: Object}} input
 * @return {{to: string, subject: string, body: string}}
 */
function buildAccountantDraft(input) {
  var source = input || {};
  var to = String(source.to || '').trim();
  var month = String(source.month || '').trim();
  if (!to) throw new Error('accountant_email is empty');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must be YYYY-MM');
  var lines = [
    'Invoices ' + month,
    '',
    'Folder: ' + String(source.folderUrl || ''),
    'Sheet: ' + String(source.sheetUrl || ''),
    'PDF: ' + String(source.pdfUrl || ''),
    ''
  ];
  var summary = summaryLines_(source.summary, month);
  for (var i = 0; i < summary.length; i++) lines.push(summary[i]);
  return {
    to: to,
    subject: 'Invoices ' + month,
    body: lines.join('\n')
  };
}

function draftMatches(to, subject, candidateTo, candidateSubject) {
  var wanted = String(to || '').trim().toLowerCase();
  var actual = String(candidateTo || '').toLowerCase();
  if (!wanted || actual.indexOf(wanted) < 0) return false;
  return String(candidateSubject || '') === String(subject || '');
}

/**
 * @param {{to: string, subject: string}} draft
 * @param {Array<{to: string, subject: string}>} existing
 * @return {{action: string, index: number}}
 */
function chooseDraftAction(draft, existing) {
  var list = existing || [];
  for (var i = 0; i < list.length; i++) {
    if (draftMatches(draft.to, draft.subject, list[i].to, list[i].subject)) {
      return { action: 'update', index: i };
    }
  }
  return { action: 'create', index: -1 };
}

function accountantDraftHeaders_() {
  var drafts = GmailApp.getDrafts();
  var rows = [];
  for (var i = 0; i < drafts.length; i++) {
    var message = drafts[i].getMessage();
    rows.push({
      to: message.getTo(),
      subject: message.getSubject(),
      id: drafts[i].getId(),
      draft: drafts[i]
    });
  }
  return rows;
}

/**
 * Creates a draft, or updates the draft with the same recipient and subject.
 * @return {{action: string, id: string, to: string, subject: string}}
 */
function saveAccountantDraft(draft) {
  if (!draft || !draft.to) throw new Error('accountant_email is empty');
  var existing = accountantDraftHeaders_();
  var choice = chooseDraftAction(draft, existing);
  if (choice.action === 'update') {
    var updated = existing[choice.index].draft.update(draft.to, draft.subject, draft.body);
    return { action: 'update', id: updated.getId(), to: draft.to, subject: draft.subject };
  }
  var created = GmailApp.createDraft(draft.to, draft.subject, draft.body);
  return { action: 'create', id: created.getId(), to: draft.to, subject: draft.subject };
}

function draftMonthlyPack(summary, month, links) {
  var config = getConfig();
  var draft = buildAccountantDraft({
    to: config.accountant_email,
    month: month,
    folderUrl: links && links.folderUrl,
    sheetUrl: links && links.sheetUrl,
    pdfUrl: links && links.pdfUrl,
    summary: summary
  });
  return saveAccountantDraft(draft);
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildAccountantDraft: buildAccountantDraft,
    draftMatches: draftMatches,
    chooseDraftAction: chooseDraftAction
  };
}
