/**
 * Dev only. Reads each saved fixture once and logs JSON {fixture, text}.
 * Cached text is reused. OCR runs only when that fileId is missing from OcrCache.
 * npm run push:dev, then run exportFixtureTexts.
 */

function clearOcrCache() {
  var ss = openCollectorSpreadsheet_();
  var sheet = ss.getSheetByName('OcrCache');
  if (!sheet) {
    Logger.log('clearOcrCache no sheet');
    return { cleared: 0 };
  }
  var cleared = Math.max(sheet.getLastRow() - 1, 0);
  if (cleared) sheet.deleteRows(2, cleared);
  Logger.log('clearOcrCache cleared %s', cleared);
  return { cleared: cleared };
}

/**
 * Logs one JSON object per fixture: {"fixture":"...","text":"..."}.
 * Paste that log back to save tests/fixtures/ocr-text/*.txt.
 */
function exportFixtureTexts() {
  var folderId = getConfig().invoices_folder_id;
  if (!folderId) throw new Error('invoices_folder_id is empty. Run saveTestFixtureFiles first.');
  var folder = DriveApp.getFolderById(folderId);
  trashTempOcrFiles(folder);
  var driveFiles = [];
  var fileByName = {};
  var found = folder.getFiles();
  while (found.hasNext()) {
    var file = found.next();
    if (isTempOcrFile(file.getName())) {
      file.setTrashed(true);
      continue;
    }
    driveFiles.push({ name: file.getName(), mimeType: file.getMimeType() });
    fileByName[file.getName()] = file;
  }
  var docs = FIXTURE_EXPECTED.documents;
  var maps = mapFixturesToDriveFiles(docs, driveFiles);
  var logged = 0;
  var i;
  for (i = 0; i < docs.length; i++) {
    var fixture = docs[i].file;
    var matched = null;
    var m;
    for (m = 0; m < maps.length; m++) {
      if (maps[m].fixture === fixture) matched = maps[m];
    }
    var text = '';
    if (!matched || !fileByName[matched.name]) {
      Logger.log('exportFixtureTexts missing ' + fixture);
    } else {
      try {
        var read = readDriveFileText(fileByName[matched.name]);
        text = read && read.text ? read.text : '';
        Logger.log('exportFixtureTexts %s source=%s', fixture, read ? read.source : '');
      } catch (error) {
        Logger.log('exportFixtureTexts %s error=%s', fixture, String(error && error.message ? error.message : error));
      }
    }
    Logger.log(JSON.stringify({ fixture: fixture, text: text }));
    logged++;
  }
  Logger.log('exportFixtureTexts %s', logged);
  return { logged: logged };
}
