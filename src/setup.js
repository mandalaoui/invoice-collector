/**
 * Creates the Invoice Collector spreadsheet and fills any missing tabs.
 * Running it again keeps existing rows and adds Settings keys that are absent.
 * @return {string} Spreadsheet URL
 */
function setupCollectorSheet() {
  var ss = openOrCreateCollectorSpreadsheet_();
  writeCollectorTabs_(ss);
  Logger.log(ss.getUrl());
  return ss.getUrl();
}

function openOrCreateCollectorSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var existingId = props.getProperty(SPREADSHEET_ID_PROPERTY);
  if (existingId) return SpreadsheetApp.openById(existingId);

  var found = findCollectorFile_();
  if (found) {
    props.setProperty(SPREADSHEET_ID_PROPERTY, found.getId());
    return SpreadsheetApp.openById(found.getId());
  }

  var created = SpreadsheetApp.create(COLLECTOR_SPREADSHEET_NAME);
  props.setProperty(SPREADSHEET_ID_PROPERTY, created.getId());
  return created;
}

function writeCollectorTabs_(ss) {
  for (var i = 0; i < SHEET_NAMES.length; i++) {
    var name = SHEET_NAMES[i];
    var sheet = ensureCollectorSheet_(ss, name);
    var existing = sheet.getLastRow() === 0 ? [] : sheet.getDataRange().getValues();
    var grid = gridForSheet(name, existing);
    if (grid) {
      var rect = rectangular(grid);
      sheet.getRange(1, 1, rect.length, rect[0].length).setValues(rect);
    }
    formatCollectorSheet_(sheet, name);
  }

  var leftover = ss.getSheetByName('Sheet1');
  if (leftover && ss.getSheets().length > 1 && leftover.getLastRow() === 0) {
    ss.deleteSheet(leftover);
  }

  for (var n = 0; n < SHEET_NAMES.length; n++) {
    ss.setActiveSheet(ss.getSheetByName(SHEET_NAMES[n]));
    ss.moveActiveSheet(n + 1);
  }
  ss.setActiveSheet(ss.getSheetByName('Settings'));
}

function ensureCollectorSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  var only = ss.getSheets();
  if (
    only.length === 1 &&
    only[0].getLastRow() === 0 &&
    SHEET_NAMES.indexOf(only[0].getName()) === -1 &&
    name === SHEET_NAMES[0]
  ) {
    only[0].setName(name);
    return only[0];
  }
  return ss.insertSheet(name);
}

function formatCollectorSheet_(sheet, name) {
  var width = headersFor(name).length;
  var lastRow = Math.max(sheet.getLastRow(), 1);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, lastRow, width).setFontFamily('Arial').setVerticalAlignment('top');
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f4e79');
  sheet.setRowHeight(1, 28);

  if (name === 'Settings') {
    sheet.setColumnWidth(1, 220);
    sheet.setColumnWidth(2, 420);
    sheet.setColumnWidth(3, 380);
    sheet.getRange(1, 1, lastRow, 3).setWrap(true);
    if (lastRow > 1) {
      sheet.getRange(2, 2, lastRow - 1, 1).setFontColor('#0000ff');
      applySettingsFormats_(sheet);
    }
  } else {
    for (var col = 1; col <= width; col++) {
      sheet.setColumnWidth(col, 140);
    }
  }

  if (!sheet.getFilter() && lastRow >= 1) {
    sheet.getRange(1, 1, lastRow, width).createFilter();
  }
}

function applySettingsFormats_(sheet) {
  var lastRow = sheet.getLastRow();
  for (var row = 2; row <= lastRow; row++) {
    var key = String(sheet.getRange(row, 1).getValue() || '');
    var cell = sheet.getRange(row, 2);
    if (key === 'confidence_threshold' || key === 'vat_rate') {
      cell.setNumberFormat('0.0%');
    } else if (key === 'amount_tolerance' || key === 'allocation_threshold') {
      cell.setNumberFormat('#,##0');
    } else if (key === 'month' || key === 'company_id') {
      cell.setNumberFormat('@');
    }
    if (USER_INPUT_KEYS[key]) {
      cell.setBackground('#fff2cc');
    }
  }
}
