/**
 * Dev only. Sends the eight fictional fixtures to the Gmail account that
 * runs this script. A client push does not include src/dev (.claspignore).
 *
 * 1. Upload the eight files from tests/fixtures/ into a Drive folder
 *    (keep the filenames; do not convert them to Google Docs).
 * 2. Script property TEST_FIXTURES_FOLDER_ID = that folder's id.
 * 3. npm run push:dev
 * 4. Run sendTestFixtures in the Apps Script editor and authorize.
 *
 * Mail goes only to the active user. A subject already in the mailbox is skipped.
 */

var TEST_FIXTURES_FOLDER_PROPERTY = 'TEST_FIXTURES_FOLDER_ID';

var TEST_FIXTURE_MESSAGES = [
  {
    file: '01-tax-invoice-receipt-he.pdf',
    kind: 'pdf_text',
    fromName: 'קפה הכרמל',
    replyTo: 'billing@cafe-carmel.example',
    subject: 'חשבונית מס קבלה מספר 10482',
    body: 'שלום,\nמצורפת חשבונית מס קבלה עבור ההזמנה מנובמבר.\nתודה,\nקפה הכרמל'
  },
  {
    file: '02-saas-invoice-en.pdf',
    kind: 'pdf_text',
    fromName: 'Northwind Ledger',
    replyTo: 'billing@northwind-ledger.example',
    subject: 'Invoice INV-44190 from Northwind Ledger',
    body: 'Hello,\nYour November invoice is attached.\nTotal due: USD 49.00.\nNorthwind Ledger'
  },
  {
    file: '03-tax-invoice-allocation-he.pdf',
    kind: 'pdf_text',
    fromName: 'אלון ריהוט משרדי',
    replyTo: 'accounts@alon-office.example',
    subject: 'חשבונית מס 88341',
    body: 'שלום,\nמצורפת חשבונית מס עבור הריהוט.\nאלון ריהוט משרדי'
  },
  {
    file: '04-scanned-receipt-he.pdf',
    kind: 'pdf_scan',
    fromName: 'מאפיית הגפן',
    replyTo: 'shop@gefen-bakery.example',
    subject: 'הקבלה שלך ממאפיית הגפן',
    body: 'תודה שקניתם אצלנו. הקבלה מצורפת.\nמאפיית הגפן'
  },
  {
    file: '05-photo-receipt.jpg',
    kind: 'image',
    fromName: 'כלי הבית דני',
    replyTo: 'shop@dani-home.example',
    subject: 'קבלה 3188 — כלי הבית דני',
    body: 'שלום,\nמצורפת הקבלה על הקומקום.\nכלי הבית דני'
  },
  {
    file: '06-email-body-invoice.html',
    kind: 'html',
    fromName: 'נט-גדר שירותי ענן',
    replyTo: 'billing@net-gader.example',
    subject: 'חשבונית מס 7712 לחודש נובמבר 2026',
    body: 'שלום,\nלהלן חשבונית מס 7712 עבור נובמבר 2026.\nסה"כ לתשלום: 1,770.00 ש"ח.\nנט-גדר שירותי ענן'
  },
  {
    file: '07-credit-note-he.pdf',
    kind: 'pdf_text',
    fromName: 'קפה הכרמל',
    replyTo: 'billing@cafe-carmel.example',
    subject: 'חשבונית זיכוי 2201',
    body: 'שלום,\nמצורפת חשבונית זיכוי עבור חשבונית 10482.\nקפה הכרמל'
  },
  {
    file: '08-quote-not-invoice-he.pdf',
    kind: 'pdf_text',
    fromName: 'ציוד דמה',
    replyTo: 'sales@dummy-supply.example',
    subject: 'הצעת מחיר Q-17 ומבצע נובמבר',
    body: 'שלום,\nמצורפת הצעת מחיר Q-17, כולל מבצע נובמבר.\nציוד דמה'
  }
];

function planTestFixtureSends(messages, fileNames, sentSubjects) {
  var present = {};
  var sent = {};
  var missing = [];
  var toSend = [];
  var skipped = [];
  var i;
  for (i = 0; i < fileNames.length; i++) present[fileNames[i]] = true;
  for (i = 0; i < sentSubjects.length; i++) sent[sentSubjects[i]] = true;
  for (i = 0; i < messages.length; i++) {
    var message = messages[i];
    if (!present[message.file]) missing.push(message.file);
    else if (sent[message.subject]) skipped.push(message.subject);
    else toSend.push(message);
  }
  return { missing: missing, toSend: toSend, skipped: skipped };
}

function fixtureSendOptions(message, blob) {
  var options = {
    name: message.fromName,
    replyTo: message.replyTo
  };
  if (message.kind === 'html') {
    options.htmlBody = blob.getDataAsString('UTF-8');
  } else {
    blob.setName(message.file);
    options.attachments = [blob];
  }
  return options;
}

function gmailSubjectQuery(subject) {
  return 'in:anywhere subject:"' + String(subject).replace(/"/g, '') + '"';
}

function sendTestFixtures() {
  var recipient = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  if (!recipient || recipient.indexOf('@') === -1) {
    throw new Error('No Gmail address for the active user. Run sendTestFixtures from the test account.');
  }
  var folderId = PropertiesService.getScriptProperties().getProperty(TEST_FIXTURES_FOLDER_PROPERTY);
  if (!folderId) {
    throw new Error(
      'Set Script Property ' + TEST_FIXTURES_FOLDER_PROPERTY +
      ' to the Drive folder that contains the 8 fixture files.'
    );
  }
  var folder = DriveApp.getFolderById(folderId);
  var names = [];
  var byName = {};
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    names.push(file.getName());
    byName[file.getName()] = file;
  }
  var sentSubjects = subjectsAlreadySent_(TEST_FIXTURE_MESSAGES);
  var plan = planTestFixtureSends(TEST_FIXTURE_MESSAGES, names, sentSubjects);
  if (plan.missing.length) {
    throw new Error('Upload these files to the fixtures folder: ' + plan.missing.join(', '));
  }
  var sent = [];
  for (var i = 0; i < plan.toSend.length; i++) {
    var message = plan.toSend[i];
    assertOriginalFixtureFile_(byName[message.file]);
    var options = fixtureSendOptions(message, byName[message.file].getBlob());
    try {
      GmailApp.sendEmail(recipient, message.subject, message.body, options);
    } catch (error) {
      throw new Error(
        'Sent ' + sent.length + ' message(s) before ' + message.subject + ' failed: ' + error.message
      );
    }
    sent.push(message.subject);
  }
  Logger.log('sendTestFixtures to %s: sent %s; skipped %s', recipient, sent.length, plan.skipped.length);
  return { to: recipient, sent: sent, skipped: plan.skipped };
}

function subjectsAlreadySent_(messages) {
  var found = [];
  for (var i = 0; i < messages.length; i++) {
    var subject = messages[i].subject;
    if (mailboxHasSubject_(subject)) found.push(subject);
  }
  return found;
}

function mailboxHasSubject_(subject) {
  var threads = GmailApp.search(gmailSubjectQuery(subject), 0, 10);
  for (var i = 0; i < threads.length; i++) {
    var threadMessages = threads[i].getMessages();
    for (var j = 0; j < threadMessages.length; j++) {
      if (threadMessages[j].getSubject() === subject) return true;
    }
  }
  return false;
}

function assertOriginalFixtureFile_(file) {
  var mime = file.getMimeType();
  if (mime.indexOf('application/vnd.google-apps.') === 0) {
    throw new Error(file.getName() + ' was converted in Drive. Upload the original PDF, JPG, or HTML file.');
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    TEST_FIXTURES_FOLDER_PROPERTY: TEST_FIXTURES_FOLDER_PROPERTY,
    TEST_FIXTURE_MESSAGES: TEST_FIXTURE_MESSAGES,
    planTestFixtureSends: planTestFixtureSends,
    fixtureSendOptions: fixtureSendOptions,
    gmailSubjectQuery: gmailSubjectQuery
  };
}
