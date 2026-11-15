/**
 * Dev only. Reads the eight saved fixture files.
 * Text-layer PDFs are read directly. Scans and photos use Drive OCR (Hebrew).
 * npm run push:dev, then run testOcr. Ends with PASS or FAIL.
 */

function testOcr() {
  var detail = '';
  var pass = false;
  try {
    var folderId = getConfig().invoices_folder_id;
    if (!folderId) throw new Error('invoices_folder_id is empty. Run saveTestFixtureFiles first.');
    var folder = DriveApp.getFolderById(folderId);
    var pending = {};
    var i;
    for (i = 0; i < TEST_FIXTURE_MESSAGES.length; i++) {
      pending[TEST_FIXTURE_MESSAGES[i].file.replace(/\.[^.]+$/, '')] = TEST_FIXTURE_MESSAGES[i].file;
    }
    var rows = [];
    var files = folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      var stem = '';
      var keys = Object.keys(pending);
      for (i = 0; i < keys.length; i++) {
        if (file.getName().indexOf(keys[i]) >= 0) stem = keys[i];
      }
      if (!stem) continue;
      var read = readDriveBlobText(file.getBlob(), file.getName());
      var chars = String(read.text || '').replace(/\s/g, '').length;
      Logger.log('testOcr %s source=%s chars=%s', pending[stem], read.source, chars);
      rows.push(pending[stem] + ' ' + read.source + ' ' + chars);
      if (chars < 15) throw new Error(pending[stem] + ' returned ' + chars + ' characters');
      delete pending[stem];
    }
    var missing = Object.keys(pending);
    if (missing.length) throw new Error('missing files ' + missing.join(', '));
    pass = rows.length === 8;
    detail = rows.join('; ');
  } catch (error) {
    pass = false;
    detail = String(error && error.message ? error.message : error);
  }
  Logger.log('testOcr %s %s', pass ? 'PASS' : 'FAIL', detail);
  return { result: pass ? 'PASS' : 'FAIL', detail: detail };
}
