/**
 * Dev only. Removes invoices/processed from the eight fixture threads.
 * A client push does not include src/dev (.claspignore).
 *
 * Settings month must be 2026-11. This also clears the resume cursor.
 * Run clearTestFixtureLabels, then saveTestFixtureFiles again.
 * Other mail is not searched or changed.
 */

function clearTestFixtureLabels() {
  var listed = listTestFixtureMessages({ includeProcessed: true });
  if (listed.month !== '2026-11') {
    throw new Error('Set Settings month to 2026-11 before clearing fixture labels. Found ' + listed.month + '.');
  }
  var subjects = [];
  for (var i = 0; i < TEST_FIXTURE_MESSAGES.length; i++) {
    subjects.push(TEST_FIXTURE_MESSAGES[i].subject);
  }
  var cleared = listed.count
    ? removeProcessedLabel(listed.messages, subjects, getConfig().processed_label)
    : 0;
  clearCollectCursor_();
  Logger.log('clearTestFixtureLabels found=%s cleared=%s', listed.count, cleared);
  return { month: listed.month, found: listed.count, cleared: cleared };
}
