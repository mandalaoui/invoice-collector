/**
 * Dev only. Copies the eight fixture messages into Invoices/2026-11.
 * A client push does not include src/dev (.claspignore).
 *
 * 1. Settings month = 2026-11. Clear invoices_folder_id unless it already
 *    points at a folder named 2026-11.
 * 2. npm run push:dev
 * 3. Run saveTestFixtureFiles in the Apps Script editor.
 *
 * The run reads Gmail only through listTestFixtureMessages.
 */

function saveTestFixtureFiles() {
  var listed = listTestFixtureMessages();
  if (listed.month !== '2026-11') {
    throw new Error(
      'Set Settings month to 2026-11. This run saves Invoices/2026-11 and found month ' +
        listed.month +
        '.'
    );
  }
  if (listed.count !== 8) {
    throw new Error(
      'Expected 8 fixture messages, found ' +
        listed.count +
        '. Run sendTestFixtures, keep month at 2026-11, and leave the invoices/processed label off these messages.'
    );
  }
  var folder = ensureMonthFolder(getConfig().invoices_folder_id, listed.month);
  var folderId = rememberInvoicesFolderId(folder.getId());
  var plans = planFixtureSaves(listed.messages, TEST_FIXTURE_MESSAGES);
  if (plans.length !== 8) throw new Error('Refusing to save because a fixture subject is missing');
  var files = savePlannedCopies(plans, folder, readFixtureSource_);
  Logger.log('saveTestFixtureFiles %s files in Invoices/%s (%s)', files.length, listed.month, folderId);
  return {
    path: 'Invoices/' + listed.month,
    folderId: folderId,
    count: files.length,
    files: files
  };
}

function readFixtureSource_(plan) {
  var message = GmailApp.getMessageById(plan.messageId);
  if (!message || message.getSubject() !== plan.subject) {
    throw new Error('Refusing to read a message that is not one of the 8 fixtures');
  }
  if (plan.source === 'body-pdf') {
    var fileName = buildInvoiceFileName(plan.date, plan.vendor, plan.originalName);
    return { pdfBytes: htmlBodyToPdfBlob(message.getBody(), fileName).getBytes() };
  }
  var attachments = message.getAttachments();
  var match = null;
  var i;
  for (i = 0; i < attachments.length; i++) {
    if (attachments[i].getName() === plan.attachmentName) {
      match = attachments[i];
      break;
    }
  }
  if (!match && attachments.length === 1) match = attachments[0];
  if (!match) throw new Error('Fixture file ' + plan.attachmentName + ' is not attached');
  return { bytes: match.getBytes(), mime: match.getContentType() };
}
