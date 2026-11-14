/**
 * Dev only. Copies unlabeled fixture messages into Invoices/2026-11,
 * then labels those threads invoices/processed.
 * A client push does not include src/dev (.claspignore).
 *
 * 1. Settings month = 2026-11. invoices_folder_id blank, or already the 2026-11 folder.
 * 2. npm run push:dev
 * 3. Run saveTestFixtureFiles. It saves the eight messages and labels them.
 * 4. Run saveTestFixtureFiles again. processed and created are both 0.
 *
 * To repeat the test, run clearTestFixtureLabels, then save again.
 * Gmail is read only through listTestFixtureMessages.
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
  var subjects = testFixtureSubjects_();
  if (!listed.count) {
    var all = listTestFixtureMessages({ includeProcessed: true });
    if (!all.count) {
      throw new Error('No fixture messages in 2026-11. Run sendTestFixtures first.');
    }
    var idle = collectRunTotals(0, []);
    Logger.log(
      'saveTestFixtureFiles processed=%s created=%s alreadyProcessed=%s',
      idle.processed,
      idle.created,
      all.count
    );
    return {
      path: 'Invoices/' + listed.month,
      folderId: getConfig().invoices_folder_id || '',
      processed: idle.processed,
      created: idle.created,
      labeled: 0,
      alreadyProcessed: all.count,
      files: []
    };
  }
  var config = getConfig();
  var folder = ensureMonthFolder(config.invoices_folder_id, listed.month);
  var folderId = rememberInvoicesFolderId(folder.getId());
  var plans = planFixtureSaves(listed.messages, TEST_FIXTURE_MESSAGES);
  if (plans.length !== listed.count) throw new Error('Refusing to save because a fixture subject is missing');
  var files = savePlannedCopies(plans, folder, readFixtureSource_);
  if (files.length !== plans.length) throw new Error('Refusing to label because a file was not saved');
  var totals = collectRunTotals(plans.length, files);
  var labeled = applyProcessedLabel(plans, subjects, config.processed_label);
  Logger.log(
    'saveTestFixtureFiles processed=%s created=%s labeled=%s folder=%s',
    totals.processed,
    totals.created,
    labeled,
    folderId
  );
  return {
    path: 'Invoices/' + listed.month,
    folderId: folderId,
    processed: totals.processed,
    created: totals.created,
    labeled: labeled,
    alreadyProcessed: 0,
    files: files
  };
}

function testFixtureSubjects_() {
  var subjects = [];
  for (var i = 0; i < TEST_FIXTURE_MESSAGES.length; i++) {
    subjects.push(TEST_FIXTURE_MESSAGES[i].subject);
  }
  return subjects;
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
