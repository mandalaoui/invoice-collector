/**
 * Dev only. Saves unlabeled fixture messages in batches and writes one RunLog row.
 * A client push does not include src/dev (.claspignore).
 *
 * 1. Settings month = 2026-11. Run setupCollectorSheet so batch_size exists.
 * 2. Set batch_size to 3 to test resume. Leave it at 20 to finish in one run.
 * 3. npm run push:dev
 * 4. Run clearTestFixtureLabels if these messages are already labeled.
 * 5. Run saveTestFixtureFiles three times. Counts are 3, then 3, then 2.
 *    The first two rows are partial. The third is ok and the cursor is empty.
 * 6. One more run processes 0 messages and creates 0 files.
 *
 * Gmail is read only through listTestFixtureMessages. Each run stops before
 * 6 minutes and leaves the cursor for the next run.
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
  var plan = planBatch(listed.messages, batchSize);
  var started = new Date();
  var entry = {
    startedAt: started,
    finishedAt: '',
    mode: config.mode || 'deterministic',
    messages: 0,
    files: 0,
    rows: 0,
    errors: '',
    status: plan.done ? 'ok' : 'running',
    cursor: ''
  };
  if (plan.done) {
    clearCollectCursor_();
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
  var cursor = '';
  var errors = '';
  var failedId = '';
  var stoppedEarly = false;
  try {
    var folder = ensureMonthFolder(folderId, listed.month);
    folderId = rememberInvoicesFolderId(folder.getId());
    for (var i = 0; i < plan.batch.length; i++) {
      failedId = String(plan.batch[i].item.id || '');
      if (runShouldStop(started.getTime(), Date.now(), RUN_TIME_BUDGET_MS, i, batchSize) === 'time') {
        stoppedEarly = true;
        break;
      }
      var plans = planFixtureSaves([plan.batch[i].item], TEST_FIXTURE_MESSAGES);
      if (plans.length !== 1) throw new Error('Refusing to save because a fixture subject is missing');
      var saved = savePlannedCopies(plans, folder, readFixtureSource_);
      if (saved.length !== 1) throw new Error('Refusing to label because a file was not saved');
      labeled += applyProcessedLabel(plans, subjects, config.processed_label);
      files.push(saved[0]);
      cursor = failedId;
      saveCollectCursor_(cursor);
      entry.messages = labeled;
      entry.files = collectRunTotals(labeled, files).created;
      entry.status = 'running';
      entry.cursor = cursor;
      updateRunLog_(logRow, entry);
    }
  } catch (error) {
    errors = String(error && error.message ? error.message : error).slice(0, 500);
    cursor = failedId;
    saveCollectCursor_(cursor);
  }
  var totals = collectRunTotals(labeled, files);
  var finished = !errors && !stoppedEarly && plan.done;
  entry.finishedAt = new Date();
  entry.messages = totals.processed;
  entry.files = totals.created;
  entry.rows = 0;
  entry.errors = errors;
  entry.status = errors ? 'error' : finished ? 'ok' : 'partial';
  entry.cursor = finished ? '' : cursor;
  if (finished) clearCollectCursor_();
  else saveCollectCursor_(entry.cursor);
  updateRunLog_(logRow, entry);
  Logger.log(
    'saveTestFixtureFiles processed=%s created=%s status=%s cursor=%s',
    totals.processed,
    totals.created,
    entry.status,
    entry.cursor
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
