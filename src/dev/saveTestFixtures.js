/**
 * Dev only. Saves unlabeled fixture messages in batches and writes one RunLog row.
 * A client push does not include src/dev (.claspignore).
 *
 * 1. Settings month = 2026-11. Run setupCollectorSheet so batch_size exists.
 * 2. Set batch_size to 3 to test resume. Leave it at 20 to finish in one run.
 * 3. npm run push:dev
 * 4. Run clearTestFixtureLabels if these messages are already labeled.
 * 5. Run saveTestFixtureFiles three times. Counts are 3, then 3, then 2.
 *    The first two rows are partial. The third is ok.
 * 6. One more run processes 0 messages and creates 0 files.
 *
 * Gmail is read only through listTestFixtureMessages. Each run takes the
 * first batch_size unlabeled fixtures. Labels are the only progress state.
 * A short tail is still saved. A message id is not a resume point.
 */

function saveTestFixtureFiles() {
  var config = getConfig();
  var listed = listTestFixtureMessages({ includeProcessed: true });
  if (listed.month !== '2026-11') {
    throw new Error(
      'Set Settings month to 2026-11. This run saves Invoices/2026-11 and found month ' +
        listed.month +
        '.'
    );
  }
  if (listed.count !== 8) {
    throw new Error(
      'Expected 8 fixture messages in 2026-11, found ' +
        listed.count +
        '. Run sendTestFixtures.'
    );
  }
  var subjects = testFixtureSubjects_();
  var batchSize = normalizeBatchSize(config.batch_size, listed.count);
  var selection = fixtureRunSelection(listed.messages, batchSize);
  logFixtureSelection_(selection.rows);
  clearCollectCursor_();
  var started = new Date();
  var entry = {
    startedAt: started,
    finishedAt: '',
    mode: config.mode || 'deterministic',
    messages: 0,
    files: 0,
    rows: 0,
    errors: '',
    status: selection.idle ? 'ok' : 'running',
    cursor: ''
  };
  if (selection.idle) {
    entry.finishedAt = new Date();
    var idle = collectRunTotals(0, []);
    var idleRow = beginRunLog_(entry);
    Logger.log('saveTestFixtureFiles processed=%s created=%s status=ok', idle.processed, idle.created);
    return {
      path: 'Invoices/' + listed.month,
      folderId: config.invoices_folder_id || '',
      processed: idle.processed,
      created: idle.created,
      labeled: 0,
      status: 'ok',
      cursor: '',
      batchSize: batchSize,
      logRow: idleRow,
      files: []
    };
  }

  var logRow = beginRunLog_(entry);
  var folderId = config.invoices_folder_id || '';
  var files = [];
  var labeled = 0;
  var errors = '';
  var stoppedEarly = false;
  try {
    var folder = ensureMonthFolder(folderId, listed.month);
    folderId = rememberInvoicesFolderId(folder.getId());
    for (var i = 0; i < selection.batch.length; i++) {
      if (runShouldStop(started.getTime(), Date.now(), RUN_TIME_BUDGET_MS, i, batchSize) === 'time') {
        stoppedEarly = true;
        break;
      }
      var plans = planFixtureSaves([selection.batch[i].item], TEST_FIXTURE_MESSAGES);
      if (plans.length !== 1) throw new Error('Refusing to save because a fixture subject is missing');
      var saved = savePlannedCopies(plans, folder, readFixtureSource_);
      if (saved.length !== 1) throw new Error('Refusing to label because a file was not saved');
      labeled += applyProcessedLabel(plans, subjects, config.processed_label);
      files.push(saved[0]);
      entry.messages = labeled;
      entry.files = collectRunTotals(labeled, files).created;
      entry.status = 'running';
      entry.cursor = '';
      updateRunLog_(logRow, entry);
    }
  } catch (error) {
    errors = String(error && error.message ? error.message : error).slice(0, 500);
  }
  var totals = collectRunTotals(labeled, files);
  var finished = !errors && !stoppedEarly && selection.finishes;
  entry.finishedAt = new Date();
  entry.messages = totals.processed;
  entry.files = totals.created;
  entry.rows = 0;
  entry.errors = errors;
  entry.status = errors ? 'error' : finished ? 'ok' : 'partial';
  entry.cursor = '';
  clearCollectCursor_();
  updateRunLog_(logRow, entry);
  Logger.log(
    'saveTestFixtureFiles processed=%s created=%s status=%s cursor=unused',
    totals.processed,
    totals.created,
    entry.status
  );
  return {
    path: 'Invoices/' + listed.month,
    folderId: folderId,
    processed: totals.processed,
    created: totals.created,
    labeled: labeled,
    status: entry.status,
    cursor: entry.cursor,
    batchSize: batchSize,
    logRow: logRow,
    errors: errors,
    files: files
  };
}

function logFixtureSelection_(rows) {
  var list = rows || [];
  Logger.log('saveTestFixtureFiles progress=labels cursor=unused count=%s', list.length);
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    Logger.log(
      'saveTestFixtureFiles fixture subject=%s threadId=%s messageId=%s hasLabel=%s decision=%s reason=%s',
      row.subject,
      row.threadId,
      row.messageId,
      row.hasLabel,
      row.decision,
      row.reason
    );
  }
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
